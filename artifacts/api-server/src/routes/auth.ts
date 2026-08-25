import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db, managersTable, appConfigTable, officersTable, type Manager } from "@workspace/db";
import {
  encryptMfaSecret,
  decryptMfaSecret,
  generateMfaSecret,
  mfaKeyUri,
  mfaQrCodeDataUrl,
  verifyMfaCode,
} from "../lib/mfa";

// ── Rate limiting ────────────────────────────────────────────────────────────
// Applies to every credential-check endpoint below (manager login, manager PIN,
// crew PIN, per-officer crew login) — none of them had any limit before, so a
// password/PIN could be brute-forced with unlimited attempts. 10 tries per
// 15 minutes per IP is generous enough for a mistyped password, tight enough
// to make guessing a 4-6 digit PIN impractical.
//
// One limiter *instance* per endpoint, not one shared across all of them —
// office networks / mobile carriers often NAT many users behind one public IP,
// so a shared counter would let unrelated legitimate manager-login traffic eat
// into the crew-login quota (and vice versa) for everyone behind that IP.
function makeAuthRateLimit() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts — try again later" },
  });
}

// Rate limiter for the X-Manager-Pin header bypass built into requireManager
// itself (see below) — as opposed to makeAuthRateLimit(), which only guards
// the dedicated /api/manager-pin/check endpoint. Without this, the PIN could
// be brute-forced through any requireManager-gated route by varying the
// header on each request. Tighter than makeAuthRateLimit()'s 10/15min —
// this bypass has no username/officerId to pair with the PIN, so 3 wrong
// guesses is as far as an attacker gets before the window locks them out.
//
// skipSuccessfulRequests is essential here, unlike the endpoint-specific
// limiters above: a legitimate mobile caller sends this header on *every*
// manager-gated request, not just once to "log in" — if correct-PIN requests
// counted against the limit the same as wrong ones, normal API traffic would
// exhaust it and lock the caller out. Only responses that end up failing
// (wrong PIN and no valid session cookie either) count toward the 3-per-
// 15-min budget.
const managerPinBypassRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts — try again later" },
});

// Per-account TOTP verify limiter — makeAuthRateLimit() above is per-IP only,
// so a distributed attacker (many source IPs) gets a fresh 10-attempt budget
// on every IP and could still brute-force a 6-digit code across enough of
// them. Keyed on the account being verified against instead of the caller's
// IP, so the budget is shared no matter how many IPs an attacker spreads
// across. Low priority on its own (the 30s code-validity window already
// narrows this a lot) — this is a backstop alongside the per-IP limiter, not
// a replacement for it. skipSuccessfulRequests for the same reason as the
// PIN bypass limiter above: a correct code is the expected outcome and
// shouldn't eat into the budget, only wrong ones should.
function makeAccountRateLimit(accountIdOf: (req: Request) => string | undefined) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: req => accountIdOf(req) ?? req.ip ?? "unknown",
    message: { error: "Too many attempts — try again later" },
  });
}

declare module "express-session" {
  interface SessionData {
    managerId?: string;
    // Set after password verifies for an account with mfa_enabled=true, in
    // place of managerId, until /manager/auth/mfa/challenge confirms a TOTP
    // code. A session carrying this is *not* authenticated — requireManager
    // etc. only look at managerId.
    pendingMfaManagerId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Set by requireCrew — the officer behind the current crew session. */
      officer?: { id: string; name: string };
    }
  }
}

const router = Router();

// Regenerates the session ID in place (promisified — express-session's
// regenerate() is callback-only). Call this at every trust-boundary crossing
// (pre-auth → pending-MFA, pending-MFA → authenticated, pre-auth →
// authenticated) so a session ID established before login can never carry
// forward into a privileged state — the standard session-fixation defense.
// regenerate() replaces req.session with a fresh object/ID, so any pending
// state the caller needs (e.g. pendingMfaManagerId) must be re-set *after*
// awaiting this, not before.
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => (err ? reject(err) : resolve()));
  });
}

export type AccountRole = "admin" | "manager" | "ic" | "crew";

export interface ManagerAccount {
  id: string;
  username: string;
  passwordHash: string;
  role: AccountRole;
  approved: boolean;
  createdAt: string;
  // crew: link to roster officer
  officerId?: string;
  officerName?: string;
  // ic: which catchments they can approve for
  catchments?: string[];
  pendingReset?: { passwordHash: string; requestedAt: string };
  // MFA (admin/manager/ic only — see
  // .scratch/flood-commander-web/issues/09-manager-mfa-totp.md).
  // mfaSecret is encrypted (see lib/mfa.ts), never sent to clients.
  mfaSecret?: string;
  mfaEnabled: boolean;
}

/** admin/manager/ic can enroll in MFA; crew's PIN flow is deliberately low-friction and out of scope. */
function isMfaEligibleRole(role: AccountRole): boolean {
  return role !== "crew";
}

function toManagerAccount(row: Manager): ManagerAccount {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    role: row.role as AccountRole,
    approved: row.approved,
    createdAt: row.createdAt.toISOString(),
    officerId: row.officerId ?? undefined,
    officerName: row.officerName ?? undefined,
    catchments: row.catchments ?? undefined,
    pendingReset: row.pendingResetPasswordHash
      ? {
          passwordHash: row.pendingResetPasswordHash,
          requestedAt: (row.pendingResetRequestedAt ?? new Date()).toISOString(),
        }
      : undefined,
    mfaSecret: row.mfaSecret ?? undefined,
    mfaEnabled: row.mfaEnabled,
  };
}

// ── In-memory cache ──────────────────────────────────────────────────────────
// getManager()/requireManager()/requireAdmin() are called synchronously
// throughout the rest of the app (rosterPlan.ts, leaveRequests.ts,
// manager.ts, ...) — this cache preserves that contract while Postgres is
// the actual source of truth. Refreshed after every mutation below.
let managers: ManagerAccount[] = [];
let appConfig: { managerPin: string; crewPin: string } = { managerPin: "123456", crewPin: "1234" };

async function refreshManagersCache(): Promise<void> {
  const rows = await db.select().from(managersTable);
  managers = rows.map(toManagerAccount);
}

async function refreshAppConfigCache(): Promise<void> {
  const [row] = await db.select().from(appConfigTable).where(eq(appConfigTable.id, 1));
  appConfig = row ? { managerPin: row.managerPin, crewPin: row.crewPin } : { managerPin: "123456", crewPin: "1234" };
}

export function getManager(id: string): ManagerAccount | undefined {
  return managers.find(m => m.id === id);
}

async function updateManager(id: string, patch: Partial<typeof managersTable.$inferInsert>) {
  const [row] = await db.update(managersTable).set(patch).where(eq(managersTable.id, id)).returning();
  await refreshManagersCache();
  return row;
}

async function seedAdmin() {
  await refreshManagersCache();

  const [configRow] = await db.select().from(appConfigTable).where(eq(appConfigTable.id, 1));
  if (!configRow) {
    // Seed the default PIN row — matches the hardcoded defaults the old
    // JSON-backed appConfig started with when config.json didn't exist yet.
    await db.insert(appConfigTable).values({ id: 1, managerPin: "123456", crewPin: "1234" });
  }
  await refreshAppConfigCache();

  if (!managers.find(m => m.role === "admin")) {
    const passwordHash = await bcrypt.hash("Admin@1234", 10);
    await db.insert(managersTable).values({
      id: "admin",
      username: "admin",
      passwordHash,
      role: "admin",
      approved: true,
      createdAt: new Date(),
    });
    await refreshManagersCache();
    console.log("[auth] Admin seeded — username: admin  password: Admin@1234");
  }
}

seedAdmin();

// ── Middleware ─────────────────────────────────────────────────────────────────
export function requireManager(req: Request, res: Response, next: NextFunction) {
  // Allow mobile API callers that send X-Manager-Pin header — rate-limited
  // (see managerPinBypassRateLimit above) so the PIN can't be brute-forced
  // through this bypass. A wrong/missing pin header still falls through to
  // the session check below, same as before.
  const pinHeader = req.headers["x-manager-pin"] as string | undefined;
  if (pinHeader) {
    managerPinBypassRateLimit(req, res, () => {
      if (pinHeader === appConfig.managerPin) { next(); return; }
      requireManagerSession(req, res, next);
    });
    return;
  }

  requireManagerSession(req, res, next);
}

function requireManagerSession(req: Request, res: Response, next: NextFunction) {
  const mid = req.session?.managerId;
  if (!mid) {
    // Redirect browser GET requests to login page; return JSON for API calls
    if (req.method === "GET" && (req.headers.accept ?? "").includes("text/html")) {
      res.redirect(302, "/manager/login"); return;
    }
    res.status(401).json({ error: "Authentication required" }); return;
  }
  const m = managers.find(a => a.id === mid);
  if (!m || !m.approved) {
    if (req.method === "GET" && (req.headers.accept ?? "").includes("text/html")) {
      res.redirect(302, "/manager/login"); return;
    }
    res.status(403).json({ error: "Account pending approval" }); return;
  }
  next();
}

// Requires a real per-officer crew session (see /api/crew/auth/login). Unlike
// requireManager, there's no PIN-header bypass here — the whole point of this
// middleware is that the caller is one specific, verified officer, not "anyone
// who knows a shared secret." Attaches req.officer so handlers can log/use who
// actually performed the action, even though the deployment-tracking data
// itself (vehicleId/unitCode) is keyed separately — see
// .scratch/flood-commander-web/issues/02-crew-web-page.md for why.
export function requireCrew(req: Request, res: Response, next: NextFunction) {
  const mid = req.session?.managerId;
  if (!mid) { res.status(401).json({ error: "Authentication required" }); return; }
  const m = managers.find(a => a.id === mid);
  if (!m || !m.approved || m.role !== "crew" || !m.officerId) {
    res.status(403).json({ error: "Crew access required" }); return;
  }
  req.officer = { id: m.officerId, name: m.officerName ?? m.officerId };
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const mid = req.session?.managerId;
  if (!mid) { res.status(401).json({ error: "Authentication required" }); return; }
  const m = managers.find(a => a.id === mid);
  if (!m || m.role !== "admin") { res.status(403).json({ error: "Admin access required" }); return; }
  next();
}

// Middleware: require admin OR manager (not crew/ic only)
export function requireAdminOrManager(req: Request, res: Response, next: NextFunction) {
  const mid = req.session?.managerId;
  if (!mid) { res.status(401).json({ error: "Authentication required" }); return; }
  const m = managers.find(a => a.id === mid);
  if (!m || !m.approved) { res.status(403).json({ error: "Account pending approval" }); return; }
  if (m.role !== "admin" && m.role !== "manager") {
    res.status(403).json({ error: "Manager access required" }); return;
  }
  next();
}

// ── Auth API ───────────────────────────────────────────────────────────────────
router.post("/manager/auth/login", makeAuthRateLimit(), async (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  const m = managers.find(a => a.username === username);
  if (!m || !(await bcrypt.compare(password, m.passwordHash))) {
    res.status(401).json({ error: "Invalid username or password" }); return;
  }
  if (!m.approved) {
    res.status(403).json({ error: "Account pending approval", pending: true }); return;
  }
  // Credentials just verified — regenerate before granting any session state
  // (pending-MFA or fully authenticated) so a pre-existing session ID can't
  // ride along into a privileged one.
  await regenerateSession(req);
  if (m.mfaEnabled) {
    // Password alone isn't enough — hold the session in a pending state
    // (not authenticated: requireManager etc. only ever look at
    // session.managerId) until /manager/auth/mfa/challenge confirms a TOTP
    // code from the same login attempt.
    req.session.pendingMfaManagerId = m.id;
    res.json({ success: true, mfaStep: "challenge" }); return;
  }
  if (isMfaEligibleRole(m.role)) {
    // Mandatory enrollment (SSP ac-2) — admin/manager/ic accounts that
    // haven't set up MFA yet don't get a session until they do. Same
    // pending mechanism as the challenge branch above; which second step a
    // pending session needs is derived from the account's own mfaEnabled at
    // resolve-time (see resolveMfaEnrollmentSubject below), not tracked as
    // a separate flag here.
    req.session.pendingMfaManagerId = m.id;
    res.json({ success: true, mfaStep: "enroll", username: m.username }); return;
  }
  req.session.managerId = m.id;
  res.json({
    success: true,
    role: m.role,
    username: m.username,
    officerId: m.officerId,
    officerName: m.officerName,
    catchments: m.catchments,
  });
});

// Second step of login when the account has MFA enabled — completes what
// /manager/auth/login started (see pendingMfaManagerId above). Rate-limited
// the same as every other credential check: a 6-digit code is a much
// smaller brute-force space than a password, so unlimited attempts would be
// a real hole even with the 30s-per-step validity window.
router.post(
  "/manager/auth/mfa/challenge",
  makeAuthRateLimit(),
  makeAccountRateLimit(req => req.session.pendingMfaManagerId),
  async (req, res) => {
  const pendingId = req.session.pendingMfaManagerId;
  if (!pendingId) {
    res.status(400).json({ error: "No pending MFA challenge — sign in again" }); return;
  }
  const { code } = req.body as { code?: string };
  const m = managers.find(a => a.id === pendingId);
  if (!m || !m.mfaEnabled || !m.mfaSecret) {
    // Account state changed out from under this pending session (e.g. an
    // admin disabled MFA for them mid-login) — fail closed, not open.
    delete req.session.pendingMfaManagerId;
    res.status(400).json({ error: "MFA is no longer enabled for this account — sign in again" }); return;
  }
  if (!code || !(await verifyMfaCode(code, decryptMfaSecret(m.mfaSecret)))) {
    res.status(401).json({ error: "Incorrect code" }); return;
  }
  // Crossing the pending-MFA → authenticated boundary — regenerate first.
  // The fresh session has no pendingMfaManagerId, so there's nothing left to
  // delete.
  await regenerateSession(req);
  req.session.managerId = m.id;
  res.json({
    success: true,
    role: m.role,
    username: m.username,
    officerId: m.officerId,
    officerName: m.officerName,
    catchments: m.catchments,
  });
});

router.post("/manager/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.post("/manager/auth/register", async (req, res) => {
  const { username, password, role, officerId, catchments } = req.body as {
    username: string;
    password: string;
    role?: AccountRole;
    officerId?: string;
    catchments?: string[];
  };
  if (!username || !password || password.length < 8) {
    res.status(400).json({ error: "Username and password (min 8 chars) required" }); return;
  }
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    res.status(400).json({ error: "Username: 3-32 chars, letters/numbers/._- only" }); return;
  }
  if (managers.find(a => a.username.toLowerCase() === username.toLowerCase())) {
    res.status(409).json({ error: "Username already taken" }); return;
  }

  const accountRole: AccountRole = (role === "crew" || role === "ic") ? role : "manager";

  // Validate crew: must specify officerId not already claimed
  if (accountRole === "crew") {
    if (!officerId) {
      res.status(400).json({ error: "Crew accounts must link to an officer" }); return;
    }
    const alreadyClaimed = managers.find(a => a.officerId === officerId && a.approved);
    if (alreadyClaimed) {
      res.status(409).json({ error: "That officer already has an account linked" }); return;
    }
  }

  // Validate IC: must specify at least one catchment
  if (accountRole === "ic") {
    if (!catchments || catchments.length === 0) {
      res.status(400).json({ error: "IC accounts must specify at least one catchment" }); return;
    }
  }

  // Fetch officer name if linking
  let officerName: string | undefined;
  if (officerId) {
    const [officer] = await db.select().from(officersTable).where(eq(officersTable.id, officerId));
    officerName = officer?.name;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert(managersTable).values({
    id: `acc_${Date.now()}`,
    username,
    passwordHash,
    role: accountRole,
    approved: false,
    createdAt: new Date(),
    officerId: officerId ?? null,
    officerName: officerName ?? null,
    catchments: catchments?.length ? catchments : null,
  });
  await refreshManagersCache();
  res.json({ success: true, message: "Request submitted — pending admin approval" });
});

router.get("/manager/auth/me", requireManager, (req, res) => {
  const m = managers.find(a => a.id === req.session.managerId)!;
  res.json({
    id: m.id,
    username: m.username,
    role: m.role,
    officerId: m.officerId,
    officerName: m.officerName,
    catchments: m.catchments,
    mfaEnabled: m.mfaEnabled,
  });
});

router.get("/manager/auth/managers", requireAdmin, (_req, res) => {
  res.json(managers.map(m => ({
    id: m.id,
    username: m.username,
    role: m.role,
    approved: m.approved,
    createdAt: m.createdAt,
    officerId: m.officerId,
    officerName: m.officerName,
    mfaEnabled: m.mfaEnabled,
    catchments: m.catchments,
    hasPendingReset: !!m.pendingReset,
    resetRequestedAt: m.pendingReset?.requestedAt,
  })));
});

router.post("/manager/auth/managers/:id/approve", requireAdmin, async (req, res) => {
  const m = managers.find(a => a.id === req.params.id);
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  await updateManager(m.id, { approved: true });
  res.json({ success: true });
});

router.post("/manager/auth/managers/:id/revoke", requireAdmin, async (req, res) => {
  const m = managers.find(a => a.id === req.params.id && a.role !== "admin");
  if (!m) { res.status(404).json({ error: "Not found or cannot revoke admin" }); return; }
  await updateManager(m.id, { approved: false });
  res.json({ success: true });
});

router.delete("/manager/auth/managers/:id", requireAdmin, async (req, res) => {
  const m = managers.find(a => a.id === req.params.id && a.role !== "admin");
  if (!m) { res.status(404).json({ error: "Not found or cannot delete admin" }); return; }
  await db.delete(managersTable).where(eq(managersTable.id, m.id));
  await refreshManagersCache();
  res.json({ success: true });
});

// Admin: update role / catchments for an account
router.put("/manager/auth/managers/:id", requireAdmin, async (req, res) => {
  const m = managers.find(a => a.id === req.params.id);
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  const { role, catchments, officerId } = req.body as { role?: AccountRole; catchments?: string[]; officerId?: string };
  const patch: Partial<typeof managersTable.$inferInsert> = {};
  if (role && m.role !== "admin") patch.role = role;
  if (catchments !== undefined) patch.catchments = catchments;
  if (officerId !== undefined) patch.officerId = officerId;
  if (Object.keys(patch).length > 0) await updateManager(m.id, patch);
  res.json({ success: true });
});

router.post("/manager/auth/forgot-password", async (req, res) => {
  const { username, newPassword } = req.body as { username: string; newPassword: string };
  if (!username || !newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "Username and new password (min 8 chars) required" }); return;
  }
  const m = managers.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!m) {
    res.json({ success: true, message: "If that username exists, a reset request has been submitted." }); return;
  }
  const pendingResetPasswordHash = await bcrypt.hash(newPassword, 10);
  await updateManager(m.id, { pendingResetPasswordHash, pendingResetRequestedAt: new Date() });
  res.json({ success: true, message: "Reset request submitted — pending admin approval." });
});

router.post("/manager/auth/managers/:id/approve-reset", requireAdmin, async (req, res) => {
  const m = managers.find(a => a.id === req.params.id);
  if (!m) { res.status(404).json({ error: "Manager not found" }); return; }
  if (!m.pendingReset) { res.status(400).json({ error: "No pending reset request" }); return; }
  await updateManager(m.id, {
    passwordHash: m.pendingReset.passwordHash,
    pendingResetPasswordHash: null,
    pendingResetRequestedAt: null,
  });
  res.json({ success: true, username: m.username });
});

router.post("/manager/auth/managers/:id/decline-reset", requireAdmin, async (req, res) => {
  const m = managers.find(a => a.id === req.params.id);
  if (!m) { res.status(404).json({ error: "Manager not found" }); return; }
  await updateManager(m.id, { pendingResetPasswordHash: null, pendingResetRequestedAt: null });
  res.json({ success: true });
});

router.post("/manager/auth/managers/:id/reset-password", requireAdmin, async (req, res) => {
  const { newPassword } = req.body as { newPassword: string };
  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" }); return;
  }
  const m = managers.find(a => a.id === req.params.id);
  if (!m) { res.status(404).json({ error: "Manager not found" }); return; }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updateManager(m.id, { passwordHash });
  res.json({ success: true, username: m.username });
});

router.post("/manager/auth/change-password", requireManager, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Both current and new password are required" }); return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" }); return;
  }
  const m = managers.find(a => a.id === req.session.managerId);
  if (!m) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!(await bcrypt.compare(currentPassword, m.passwordHash))) {
    res.status(401).json({ error: "Current password is incorrect" }); return;
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updateManager(m.id, { passwordHash });
  res.json({ success: true });
});

// ── MFA (TOTP) — admin/manager/ic only ──────────────────────────────────────
// See .scratch/flood-commander-web/issues/09-manager-mfa-totp.md. Mandatory
// for admin/manager/ic (SSP ac-2): /manager/auth/login forces an unenrolled
// account through setup/verify-setup below before granting a real session
// (see the "enroll" branch there); the dashboard's 🛡️ button reaches the
// same two endpoints afterwards for voluntary re-enrollment/relinking.
//
// Who's allowed to call setup/verify-setup for themselves:
//  - A full, already-authenticated session (self-service re-enroll).
//  - A *pending* session from /manager/auth/login — but ONLY while that
//    account's mfaEnabled is still false. A pending session for an
//    already-enrolled account (the "challenge" case, not "enroll") must
//    NOT be allowed here — otherwise anyone who knows the password could
//    mint a brand-new secret instead of proving they hold the device
//    already enrolled, silently bypassing the real second factor entirely.
function resolveMfaEnrollmentSubject(req: Request): ManagerAccount | undefined {
  if (req.session.managerId) {
    const m = managers.find(a => a.id === req.session.managerId);
    return m && m.approved ? m : undefined;
  }
  if (req.session.pendingMfaManagerId) {
    const m = managers.find(a => a.id === req.session.pendingMfaManagerId);
    if (m && m.approved && !m.mfaEnabled) return m;
  }
  return undefined;
}

// Rate-limited like every other credential-adjacent endpoint: since this is
// now reachable off a pending (not-yet-fully-authenticated) session too —
// not just an established one — it's guessable-target-shaped in a way the
// old purely-self-service version wasn't.
router.post("/manager/auth/mfa/setup", makeAuthRateLimit(), async (req, res) => {
  const m = resolveMfaEnrollmentSubject(req);
  if (!m) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!isMfaEligibleRole(m.role)) {
    res.status(403).json({ error: "MFA is not available for crew accounts" }); return;
  }
  if (m.mfaEnabled) {
    res.status(400).json({ error: "MFA is already enabled — disable it before re-enrolling" }); return;
  }
  // Stored un-enabled until verify-setup confirms the phone actually scanned
  // it and can generate matching codes — otherwise a bad scan (or a secret
  // that never got scanned at all) would flip mfa_enabled and lock the
  // account out on next login with no way back in.
  const secret = generateMfaSecret();
  await updateManager(m.id, { mfaSecret: encryptMfaSecret(secret) });
  const otpauthUrl = mfaKeyUri(m.username, secret);
  res.json({ success: true, secret, otpauthUrl, qrCodeDataUrl: await mfaQrCodeDataUrl(otpauthUrl) });
});

router.post(
  "/manager/auth/mfa/verify-setup",
  makeAuthRateLimit(),
  makeAccountRateLimit(req => resolveMfaEnrollmentSubject(req)?.id),
  async (req, res) => {
  const m = resolveMfaEnrollmentSubject(req);
  if (!m) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { code } = req.body as { code?: string };
  if (!m.mfaSecret) {
    res.status(400).json({ error: "No MFA setup in progress — call setup first" }); return;
  }
  if (!code || !(await verifyMfaCode(code, decryptMfaSecret(m.mfaSecret)))) {
    res.status(401).json({ error: "Incorrect code" }); return;
  }
  await updateManager(m.id, { mfaEnabled: true });

  // A pending (not-yet-authenticated) enrollment is now confirmed — promote
  // it to a real session, the same way /mfa/challenge does for accounts
  // that were already enrolled. Already-authenticated self-service
  // re-enrollment (session.managerId already set) has nothing to promote.
  if (!req.session.managerId && req.session.pendingMfaManagerId === m.id) {
    // Crossing the pending-enrollment → authenticated boundary — regenerate
    // first, same as the challenge (already-enrolled) path above.
    await regenerateSession(req);
    req.session.managerId = m.id;
    res.json({
      success: true,
      role: m.role,
      username: m.username,
      officerId: m.officerId,
      officerName: m.officerName,
      catchments: m.catchments,
    });
    return;
  }
  res.json({ success: true });
});

// Self-service disable — re-verifies a current code first so a hijacked
// but still-open session can't silently turn MFA off. For lost-device
// recovery (no code to give), see the admin-initiated route below.
router.post("/manager/auth/mfa/disable", requireManager, async (req, res) => {
  const m = managers.find(a => a.id === req.session.managerId);
  if (!m) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!m.mfaEnabled || !m.mfaSecret) {
    res.status(400).json({ error: "MFA is not enabled" }); return;
  }
  const { code } = req.body as { code?: string };
  if (!code || !(await verifyMfaCode(code, decryptMfaSecret(m.mfaSecret)))) {
    res.status(401).json({ error: "Incorrect code" }); return;
  }
  await updateManager(m.id, { mfaSecret: null, mfaEnabled: false });
  res.json({ success: true });
});

// Admin-initiated MFA reset — the lockout-recovery path when someone loses
// their phone/authenticator app, mirroring the existing
// forgot-password-with-admin-approval pattern above. No code required (the
// admin's own session is the trust boundary here, same as reset-password);
// forces the account to re-enroll from scratch on next login.
//
// Bootstrapping risk (see ticket 09): if there's ever only one admin and
// *they* lose their device, there's no other admin left to call this for
// them — keep 2+ admin accounts with MFA enabled, or fall back to direct DB
// access (the pod-shell pattern already used for account seeding) to clear
// the columns by hand.
router.post("/manager/auth/managers/:id/disable-mfa", requireAdmin, async (req, res) => {
  const m = managers.find(a => a.id === req.params.id);
  if (!m) { res.status(404).json({ error: "Manager not found" }); return; }
  if (!m.mfaEnabled && !m.mfaSecret) {
    res.status(400).json({ error: "MFA is not enabled for this account" }); return;
  }
  await updateManager(m.id, { mfaSecret: null, mfaEnabled: false });
  res.json({ success: true, username: m.username });
});

// ── Manager PIN (for mobile app) ──────────────────────────────────────────────
router.post("/api/manager-pin/check", makeAuthRateLimit(), (req, res) => {
  const { pin } = req.body as { pin: string };
  if (!pin || pin !== appConfig.managerPin) {
    res.status(401).json({ error: "Incorrect PIN" }); return;
  }
  res.json({ success: true });
});

router.get("/manager/auth/pin", requireAdmin, (_req, res) => {
  res.json({ pin: appConfig.managerPin });
});
router.put("/manager/auth/pin", requireAdmin, async (req, res) => {
  const { pin } = req.body as { pin: string };
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be 4-8 digits" }); return;
  }
  await db
    .insert(appConfigTable)
    .values({ id: 1, managerPin: pin, crewPin: appConfig.crewPin })
    .onConflictDoUpdate({ target: appConfigTable.id, set: { managerPin: pin } });
  await refreshAppConfigCache();
  res.json({ success: true });
});

// ── Crew PIN (legacy — shared PIN, no individual identity) ────────────────────
// Superseded by /api/crew/auth/login below, which ties a PIN to one specific
// officer instead of the whole crew sharing one secret. Left in place only for
// backward compat with the native deployment-tracker app (never distributed —
// see .scratch/flood-commander-web/issues/08-retire-native-app.md); new crew
// UI should not use this.
router.post("/api/crew-pin/check", makeAuthRateLimit(), (req, res) => {
  const { pin } = req.body as { pin: string };
  if (!pin || pin !== appConfig.crewPin) {
    res.status(401).json({ error: "Incorrect PIN" }); return;
  }
  res.json({ success: true });
});

router.get("/manager/auth/crew-pin", requireAdmin, (_req, res) => {
  res.json({ pin: appConfig.crewPin });
});
router.put("/manager/auth/crew-pin", requireAdmin, async (req, res) => {
  const { pin } = req.body as { pin: string };
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be 4-8 digits" }); return;
  }
  await db
    .insert(appConfigTable)
    .values({ id: 1, managerPin: appConfig.managerPin, crewPin: pin })
    .onConflictDoUpdate({ target: appConfigTable.id, set: { crewPin: pin } });
  await refreshAppConfigCache();
  res.json({ success: true });
});

// ── Per-officer crew login ──────────────────────────────────────────────────
// Real replacement for the shared crew PIN above: each officer gets their own
// short PIN, bcrypt-hashed, stored as a `role: "crew"` managers row linked via
// officerId (this table/pattern already existed — see /manager/auth/register —
// it just wasn't wired into any crew-facing UI). A successful check issues a
// real session (same req.session.managerId used by manager/admin/ic logins),
// so a location update or CRMS action is attributable to one specific officer
// instead of "whoever knew the shared PIN."
//
// UX stays close to the old shared-PIN flow — pick your name, enter a short
// PIN — the difference is invisible to the officer but the PIN is now theirs
// alone, not shared across the whole crew.
router.post("/api/crew/auth/login", makeAuthRateLimit(), async (req, res) => {
  const { officerId, pin } = req.body as { officerId?: string; pin?: string };
  if (!officerId || !pin) {
    res.status(400).json({ error: "officerId and pin are required" }); return;
  }
  const m = managers.find(a => a.role === "crew" && a.officerId === officerId);
  if (!m || !(await bcrypt.compare(pin, m.passwordHash))) {
    res.status(401).json({ error: "Incorrect PIN" }); return;
  }
  if (!m.approved) {
    res.status(403).json({ error: "Crew access not yet set up for this officer — ask an admin" }); return;
  }
  // Same pre-auth → authenticated boundary as /manager/auth/login — regenerate
  // before granting the session.
  await regenerateSession(req);
  req.session.managerId = m.id;
  res.json({ success: true, officerId: m.officerId, officerName: m.officerName });
});

// Admin: directly set (create or replace) an officer's individual crew PIN —
// auto-approved since an admin is the one setting it, unlike the self-register
// + pending-approval flow at /manager/auth/register. This is the practical way
// to onboard a crew member without asking them to register themselves first.
router.put("/manager/auth/officers/:officerId/crew-pin", requireAdmin, async (req, res) => {
  const officerId = req.params.officerId as string;
  const { pin } = req.body as { pin?: string };
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be 4-8 digits" }); return;
  }
  const [officer] = await db.select().from(officersTable).where(eq(officersTable.id, officerId));
  if (!officer) { res.status(404).json({ error: "Officer not found" }); return; }

  const passwordHash = await bcrypt.hash(pin, 10);
  const existing = managers.find(a => a.role === "crew" && a.officerId === officerId);
  if (existing) {
    await updateManager(existing.id, { passwordHash, approved: true });
  } else {
    await db.insert(managersTable).values({
      id: `crew_${officerId}`,
      username: `crew_${officerId}`,
      passwordHash,
      role: "crew",
      approved: true,
      createdAt: new Date(),
      officerId,
      officerName: officer.name,
    });
    await refreshManagersCache();
  }
  res.json({ success: true, officerId, officerName: officer.name });
});

// Admin: list which officers currently have a crew login set up (no PIN values
// returned — same write-only-credential pattern as manager password resets).
router.get("/manager/auth/officers/crew-pins", requireAdmin, async (_req, res) => {
  const linked = managers.filter(a => a.role === "crew" && a.officerId);
  res.json(linked.map(m => ({ officerId: m.officerId, officerName: m.officerName, approved: m.approved })));
});

// ── Manager login / register HTML pages ───────────────────────────────────────
const LOGIN_HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Manager Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f1117; color: #f0f2f8;
      min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 12px;
      padding: 36px 32px; width: 100%; max-width: 380px;
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 13px; color: #7a7f9a; margin-bottom: 28px; }
    label { display: block; font-size: 13px; color: #7a7f9a; margin-bottom: 5px; }
    input {
      width: 100%; padding: 10px 12px; border-radius: 7px;
      border: 1px solid #2a2d3a; background: #0f1117; color: #f0f2f8;
      font-size: 15px; outline: none; margin-bottom: 16px;
    }
    input:focus { border-color: #4f6ef7; }
    button {
      width: 100%; padding: 11px; border-radius: 7px; border: none;
      background: #4f6ef7; color: #fff; font-size: 15px; font-weight: 600;
      cursor: pointer; transition: opacity .15s;
    }
    button:hover { opacity: .88; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .err { color: #ef4444; font-size: 13px; margin-bottom: 14px; display: none; }
    .ok  { color: #10b981; font-size: 13px; margin-bottom: 14px; display: none; }
    .link { text-align: center; margin-top: 18px; font-size: 13px; color: #7a7f9a; }
    .link a { color: #4f6ef7; text-decoration: none; }
    .link a:hover { text-decoration: underline; }
    .tabs { display: flex; gap: 0; margin-bottom: 24px; border-bottom: 1px solid #2a2d3a; }
    .tab {
      flex: 1; text-align: center; padding: 9px 0; font-size: 14px; font-weight: 600;
      cursor: pointer; color: #7a7f9a; border-bottom: 2px solid transparent; margin-bottom: -1px;
    }
    .tab.active { color: #4f6ef7; border-bottom-color: #4f6ef7; }
    .pane { display: none; }
    .pane.active { display: block; }
  </style>
</head>
<body>
<div class="card">
  <h1>Deployment Manager</h1>
  <p class="sub">Sign in to access the dashboard</p>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('login')">Sign In</div>
    <div class="tab" onclick="switchTab('register')">Request Access</div>
  </div>

  <!-- Login pane -->
  <div class="pane active" id="pane-login">
    <div class="err" id="login-err"></div>
    <label for="l-user">Username</label>
    <input id="l-user" type="text" autocomplete="username" placeholder="username" />
    <label for="l-pass">Password</label>
    <input id="l-pass" type="password" autocomplete="current-password" placeholder="••••••••" />
    <button id="login-btn" onclick="doLogin()">Sign In</button>
  </div>

  <!-- Register pane -->
  <div class="pane" id="pane-register">
    <div class="err" id="reg-err"></div>
    <div class="ok"  id="reg-ok"></div>
    <label for="r-user">Username</label>
    <input id="r-user" type="text" autocomplete="off" placeholder="username" />
    <label for="r-pass">Password</label>
    <input id="r-pass" type="password" autocomplete="new-password" placeholder="min 8 characters" />
    <button id="reg-btn" onclick="doRegister()">Request Access</button>
  </div>

  <!-- MFA challenge pane — second step after password verifies for accounts with MFA enabled -->
  <div class="pane" id="pane-mfa">
    <div class="err" id="mfa-err"></div>
    <p class="sub" style="margin-bottom:16px;">Enter the 6-digit code from your authenticator app.</p>
    <label for="mfa-code">Authentication code</label>
    <input id="mfa-code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
    <button id="mfa-btn" onclick="doMfaChallenge()">Verify</button>
  </div>

  <!-- MFA enrollment pane — shown instead of the dashboard when this account doesn't have MFA set up yet (mandatory for admin/manager/ic) -->
  <div class="pane" id="pane-mfa-enroll">
    <div class="err" id="mfa-enroll-err"></div>
    <p class="sub" style="margin-bottom:14px;">Two-factor authentication is required for this account. Scan this with an authenticator app (Microsoft/Google Authenticator, etc.), or choose "enter a setup key" and type the code below.</p>
    <div style="text-align:center;margin-bottom:12px;">
      <img id="mfa-enroll-qr" alt="MFA setup QR code" style="width:180px;height:180px;border-radius:8px;background:#fff;padding:8px;" />
    </div>
    <label style="margin-bottom:4px;">Setup key</label>
    <div id="mfa-enroll-secret" style="font-family:monospace;font-size:13px;letter-spacing:1px;word-break:break-all;background:#0f1117;border:1px solid #2a2d3a;border-radius:7px;padding:9px 11px;margin-bottom:16px;"></div>
    <label for="mfa-enroll-code">Enter the 6-digit code it shows</label>
    <input id="mfa-enroll-code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
    <button id="mfa-enroll-btn" onclick="doMfaEnrollVerify()">Confirm &amp; Continue</button>
  </div>
</div>

<script>
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', (i===0&&name==='login')||(i===1&&name==='register')));
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  document.getElementById('pane-' + name).classList.add('active');
}
async function doLogin() {
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-err');
  const user = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value;
  err.style.display = 'none';
  if (!user || !pass) { err.textContent = 'Please enter username and password.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/manager/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: user, password: pass }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Login failed.'; err.style.display = 'block'; return; }
    if (d.mfaStep === 'challenge') {
      document.querySelector('.tabs').style.display = 'none';
      document.getElementById('pane-login').classList.remove('active');
      document.getElementById('pane-mfa').classList.add('active');
      document.getElementById('mfa-code').focus();
      return;
    }
    if (d.mfaStep === 'enroll') {
      document.querySelector('.tabs').style.display = 'none';
      document.getElementById('pane-login').classList.remove('active');
      document.getElementById('pane-mfa-enroll').classList.add('active');
      await startMfaEnrollment();
      return;
    }
    window.location.href = '/manager';
  } catch(e) { err.textContent = 'Network error — please try again.'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Sign In'; }
}
async function startMfaEnrollment() {
  const err = document.getElementById('mfa-enroll-err');
  err.style.display = 'none';
  try {
    const r = await fetch('/manager/auth/mfa/setup', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Could not start MFA setup.'; err.style.display = 'block'; return; }
    document.getElementById('mfa-enroll-qr').src = d.qrCodeDataUrl;
    document.getElementById('mfa-enroll-secret').textContent = d.secret;
  } catch(e) { err.textContent = 'Network error — please try again.'; err.style.display = 'block'; }
}
async function doMfaEnrollVerify() {
  const btn = document.getElementById('mfa-enroll-btn');
  const err = document.getElementById('mfa-enroll-err');
  const code = document.getElementById('mfa-enroll-code').value.trim();
  err.style.display = 'none';
  if (!/^[0-9]{6}$/.test(code)) { err.textContent = 'Enter the 6-digit code it shows.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const r = await fetch('/manager/auth/mfa/verify-setup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Incorrect code.'; err.style.display = 'block'; return; }
    window.location.href = '/manager';
  } catch(e) { err.textContent = 'Network error — please try again.'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Confirm & Continue'; }
}
async function doMfaChallenge() {
  const btn = document.getElementById('mfa-btn');
  const err = document.getElementById('mfa-err');
  const code = document.getElementById('mfa-code').value.trim();
  err.style.display = 'none';
  if (!/^[0-9]{6}$/.test(code)) { err.textContent = 'Enter the 6-digit code from your authenticator app.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const r = await fetch('/manager/auth/mfa/challenge', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Verification failed.'; err.style.display = 'block'; return; }
    window.location.href = '/manager';
  } catch(e) { err.textContent = 'Network error — please try again.'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Verify'; }
}
async function doRegister() {
  const btn = document.getElementById('reg-btn');
  const err = document.getElementById('reg-err');
  const ok  = document.getElementById('reg-ok');
  const user = document.getElementById('r-user').value.trim();
  const pass = document.getElementById('r-pass').value;
  err.style.display = 'none'; ok.style.display = 'none';
  if (!user || !pass) { err.textContent = 'Username and password required.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Requesting…';
  try {
    const r = await fetch('/manager/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: user, password: pass }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Registration failed.'; err.style.display = 'block'; return; }
    ok.textContent = 'Request submitted — an admin will approve your account.'; ok.style.display = 'block';
    document.getElementById('r-user').value = ''; document.getElementById('r-pass').value = '';
  } catch(e) { err.textContent = 'Network error — please try again.'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Request Access'; }
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const pane = document.querySelector('.pane.active').id;
  if (pane === 'pane-login') doLogin();
  else if (pane === 'pane-mfa') doMfaChallenge();
  else if (pane === 'pane-mfa-enroll') doMfaEnrollVerify();
  else doRegister();
});
</script>
</body>
</html>`;

router.get("/manager/login", (req, res) => {
  // Already logged in → go straight to dashboard
  if (req.session?.managerId && managers.find(m => m.id === req.session.managerId && m.approved)) {
    res.redirect(302, "/manager"); return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(LOGIN_HTML);
});

// Alias /manager/register → same page, register tab pre-selected (handled client-side via tab)
router.get("/manager/register", (req, res) => {
  if (req.session?.managerId && managers.find(m => m.id === req.session.managerId && m.approved)) {
    res.redirect(302, "/manager"); return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(LOGIN_HTML.replace("switchTab('login')", "switchTab('register')").replace("tab active", "tab").replace("tab\"", "tab active\"").replace("pane active", "pane").replace("pane\"", "pane active\""));
});

export default router;
