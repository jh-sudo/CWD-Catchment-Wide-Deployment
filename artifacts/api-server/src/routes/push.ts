import { Router } from "express";
import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db, vapidKeysTable, pushSubscriptionsTable } from "@workspace/db";
import { requireManager } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

// ── VAPID keys ────────────────────────────────────────────────────────────────
interface VapidKeys { publicKey: string; privateKey: string; }

let vapid: VapidKeys | null = null;

async function initVapid(): Promise<VapidKeys> {
  const [row] = await db.select().from(vapidKeysTable).where(eq(vapidKeysTable.id, 1));
  let keys: VapidKeys;
  if (row) {
    keys = { publicKey: row.publicKey, privateKey: row.privateKey };
  } else {
    // Two instances can both find no row and race to create the id=1
    // singleton on boot. onConflictDoNothing + re-select (instead of a
    // plain insert) means the loser reads back the winner's keys instead
    // of throwing a unique-constraint violation.
    const generated = webpush.generateVAPIDKeys();
    const [inserted] = await db
      .insert(vapidKeysTable)
      .values({ id: 1, publicKey: generated.publicKey, privateKey: generated.privateKey })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      keys = { publicKey: inserted.publicKey, privateKey: inserted.privateKey };
    } else {
      const [winner] = await db.select().from(vapidKeysTable).where(eq(vapidKeysTable.id, 1));
      keys = { publicKey: winner.publicKey, privateKey: winner.privateKey };
    }
  }
  webpush.setVapidDetails("mailto:admin@deploymenttracker.app", keys.publicKey, keys.privateKey);
  vapid = keys;
  return keys;
}

// Caught here (not left to reject silently) so a transient DB error during
// boot logs cleanly instead of surfacing as a process-crashing unhandled
// rejection before any request has even arrived. `vapid` stays null on
// failure; consumers below check for that rather than assuming it succeeded.
const vapidReady = initVapid().catch((err) => {
  logger.error({ err }, "[push] initVapid failed");
});

// ── Subscriptions cache ──────────────────────────────────────────────────────
// sendTo()/sendToManagers()/etc. are called synchronously from other routes
// (crms.ts, deployments.ts, ...) — this cache preserves that contract while
// Postgres is the source of truth. Refreshed after every mutation below.
interface PushSub {
  subscription: webpush.PushSubscription;
  type: "manager" | "crew";
  vehicleId?: string;
  officerId?: string;
  /** CAT1 sector codes selected on the public /lightning page. Missing/empty
   *  means all sectors (backward compatible with subscriptions saved before
   *  this existed). .scratch/replit-resync-2026-09-21/issues/24. */
  lightningSectors?: string[];
  /** Set from the caller's own session at subscribe-time for manager-type
   *  subscriptions — lets sendToAccount() target one specific manager (the
   *  meeting scheduler's invitations/reminders/progress notifications).
   *  .scratch/replit-resync-2026-09-21/issues/33. */
  accountId?: string;
  savedAt: string;
}

export const LIGHTNING_SECTOR_CODES = new Set([
  "1N", "1S", "L1", "L2", "L3", "L4", "02", "3S", "3N", "04", "05",
  "06", "07", "8N", "8S", "09", "10N", "10S", "11W", "11E", "12",
  "13N", "13S", "14", "15", "16N", "16S", "17", "18W", "18E", "19N", "19S",
]);

let subs: PushSub[] = [];

function toPushSub(row: typeof pushSubscriptionsTable.$inferSelect): PushSub {
  return {
    subscription: { endpoint: row.endpoint, keys: { p256dh: row.p256dhKey, auth: row.authKey } },
    type: row.type as "manager" | "crew",
    vehicleId: row.vehicleId ?? undefined,
    officerId: row.officerId ?? undefined,
    lightningSectors: row.lightningSectors?.length ? row.lightningSectors : undefined,
    accountId: row.accountId ?? undefined,
    savedAt: (row.savedAt ?? new Date()).toISOString(),
  };
}

async function refreshSubsCache(): Promise<void> {
  const rows = await db.select().from(pushSubscriptionsTable);
  subs = rows.map(toPushSub);
}

// Caught here for the same reason as vapidReady above — a schema-drift or
// transient DB error during boot must not become a process-crashing
// unhandled rejection before any request has even arrived. `subs` stays []
// on failure; push notifications silently no-op until the next successful
// refresh instead of taking the whole server down.
const subsReady = refreshSubsCache().catch((err) => {
  logger.error({ err }, "[push] refreshSubsCache failed");
});

// ── Send helpers (exported for use in other routes) ───────────────────────────
interface PushPayload { title: string; body: string; tag?: string; url?: string; }

// payload may be a function so a caller (sendLightningToCrew) can send a
// different, personalized payload per subscriber (or skip one entirely by
// returning null) instead of one fixed message to everyone.
async function sendTo(targets: PushSub[], payload: PushPayload | ((sub: PushSub) => PushPayload | null)) {
  await vapidReady;
  const dead: string[] = [];

  await Promise.allSettled(
    targets.map(async (sub) => {
      try {
        const resolved = typeof payload === "function" ? payload(sub) : payload;
        if (!resolved) return;
        await webpush.sendNotification(sub.subscription, JSON.stringify(resolved));
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(sub.subscription.endpoint);
        }
      }
    })
  );

  if (dead.length) {
    await db.delete(pushSubscriptionsTable).where(inArray(pushSubscriptionsTable.endpoint, dead));
    await refreshSubsCache();
  }
}

export async function sendToManagers(payload: PushPayload) {
  await subsReady;
  await sendTo(subs.filter(s => s.type === "manager"), payload);
}

export async function broadcastToCrew(payload: PushPayload) {
  await subsReady;
  await sendTo(subs.filter(s => s.type === "crew"), payload);
}

export async function sendToCrewVehicle(vehicleId: string, payload: PushPayload) {
  await subsReady;
  await sendTo(subs.filter(s => s.type === "crew" && s.vehicleId === vehicleId), payload);
}

export async function sendToCrewOfficer(officerId: string, payload: PushPayload) {
  await subsReady;
  await sendTo(subs.filter(s => s.type === "crew" && s.officerId === officerId), payload);
}

/** Send to one specific manager account, across every device they've
 *  subscribed on. Used by the meeting scheduler (invitations, reminders,
 *  organizer progress/ready notices) — every notification there targets one
 *  named recipient, never a role-wide broadcast.
 *  .scratch/replit-resync-2026-09-21/issues/33. */
export async function sendToAccount(accountId: string, payload: PushPayload) {
  await subsReady;
  await sendTo(subs.filter(s => s.type === "manager" && s.accountId === accountId), payload);
}

/**
 * Send a personalized lightning notification to matching crew subscribers
 * only — a subscriber with no saved sector preference matches every active
 * sector (backward compatible); one with a preference only gets notified
 * when at least one of their selected sectors is currently active.
 * .scratch/replit-resync-2026-09-21/issues/24.
 */
export async function sendLightningToCrew(
  sectorCodes: string[],
  createPayload: (matchingSectorCodes: string[]) => PushPayload,
) {
  await subsReady;
  const activeCodes = sectorCodes.map(code => code.toUpperCase());
  await sendTo(subs.filter(s => s.type === "crew"), sub => {
    const matchingCodes = !sub.lightningSectors?.length
      ? activeCodes
      : activeCodes.filter(code => sub.lightningSectors!.includes(code));
    return matchingCodes.length ? createPayload(matchingCodes) : null;
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Public: crew + manager both need the key
router.get("/push/vapid-key", async (_req, res) => {
  await vapidReady;
  if (!vapid) { res.status(503).json({ error: "Push notifications unavailable" }); return; }
  res.json({ publicKey: vapid.publicKey });
});

// Save a subscription (crew: no auth needed; manager: auth required is enforced by type)
router.post("/push/subscribe", async (req, res) => {
  const { subscription, type, vehicleId, officerId, lightningSectors } = req.body as {
    subscription: webpush.PushSubscription;
    type: "manager" | "crew";
    vehicleId?: string;
    officerId?: string;
    lightningSectors?: unknown;
  };

  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    res.status(400).json({ error: "Missing subscription" }); return;
  }

  // Enforce manager auth for manager subscriptions
  if (type === "manager" && !req.session?.managerId) {
    res.status(401).json({ error: "Auth required for manager subscriptions" }); return;
  }

  let normalizedLightningSectors: string[] | null = null;
  if (lightningSectors !== undefined) {
    if (!Array.isArray(lightningSectors) || !lightningSectors.every(code => typeof code === "string")) {
      res.status(400).json({ error: "lightningSectors must be an array of sector codes" }); return;
    }
    const normalized = [...new Set(
      lightningSectors.map(code => code.trim().toUpperCase()).filter(Boolean)
    )];
    const invalid = normalized.filter(code => !LIGHTNING_SECTOR_CODES.has(code));
    if (invalid.length) {
      res.status(400).json({ error: `Unknown lightning sector: ${invalid.join(", ")}` }); return;
    }
    // An empty selection intentionally means all sectors for backward compatibility.
    if (normalized.length) normalizedLightningSectors = normalized;
  }

  // Never trusts a client-supplied account id — a manager subscription is
  // always tagged with whoever the session actually says is logged in, so
  // one account can never subscribe on another's behalf.
  // .scratch/replit-resync-2026-09-21/issues/33.
  const accountId = type === "manager" ? (req.session!.managerId ?? null) : null;

  const savedAt = new Date();
  await db
    .insert(pushSubscriptionsTable)
    .values({
      endpoint: subscription.endpoint,
      authKey: subscription.keys.auth,
      p256dhKey: subscription.keys.p256dh,
      type: type ?? "crew",
      vehicleId: vehicleId ?? null,
      officerId: officerId ?? null,
      lightningSectors: normalizedLightningSectors,
      accountId,
      savedAt,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: {
        authKey: subscription.keys.auth,
        p256dhKey: subscription.keys.p256dh,
        type: type ?? "crew",
        vehicleId: vehicleId ?? null,
        officerId: officerId ?? null,
        lightningSectors: normalizedLightningSectors,
        accountId,
        savedAt,
      },
    });
  await refreshSubsCache();

  res.json({ success: true });
});

// Remove a subscription on unsubscribe
router.post("/push/unsubscribe", async (req, res) => {
  const { endpoint } = req.body as { endpoint: string };
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  await refreshSubsCache();
  res.json({ success: true });
});

// Test endpoint (admin only — useful for debugging)
router.post("/push/test", requireManager, async (req, res) => {
  const { type } = req.body as { type?: string };
  const payload: PushPayload = {
    title: "Test Notification",
    body: "Push notifications are working!",
    tag: "test",
  };
  if (type === "crew") await broadcastToCrew(payload);
  else await sendToManagers(payload);
  res.json({ success: true });
});

export default router;
