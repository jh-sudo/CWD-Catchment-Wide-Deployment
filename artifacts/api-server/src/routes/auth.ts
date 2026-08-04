import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, managersTable, appConfigTable, officersTable, type Manager } from "@workspace/db";

declare module "express-session" {
  interface SessionData {
    managerId?: string;
  }
}

const router = Router();

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
  // Allow mobile API callers that send X-Manager-Pin header
  const pinHeader = req.headers["x-manager-pin"] as string | undefined;
  if (pinHeader && pinHeader === appConfig.managerPin) { next(); return; }

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
router.post("/manager/auth/login", async (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  const m = managers.find(a => a.username === username);
  if (!m || !(await bcrypt.compare(password, m.passwordHash))) {
    res.status(401).json({ error: "Invalid username or password" }); return;
  }
  if (!m.approved) {
    res.status(403).json({ error: "Account pending approval", pending: true }); return;
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

// ── Manager PIN (for mobile app) ──────────────────────────────────────────────
router.post("/api/manager-pin/check", (req, res) => {
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

// ── Crew PIN (for mobile app) ──────────────────────────────────────────────────
router.post("/api/crew-pin/check", (req, res) => {
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
    window.location.href = '/manager';
  } catch(e) { err.textContent = 'Network error — please try again.'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Sign In'; }
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
document.addEventListener('keydown', e => { if (e.key === 'Enter') { const pane = document.querySelector('.pane.active').id; if (pane === 'pane-login') doLogin(); else doRegister(); } });
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
