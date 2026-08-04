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
  savedAt: string;
}

let subs: PushSub[] = [];

function toPushSub(row: typeof pushSubscriptionsTable.$inferSelect): PushSub {
  return {
    subscription: { endpoint: row.endpoint, keys: { p256dh: row.p256dhKey, auth: row.authKey } },
    type: row.type as "manager" | "crew",
    vehicleId: row.vehicleId ?? undefined,
    officerId: row.officerId ?? undefined,
    savedAt: (row.savedAt ?? new Date()).toISOString(),
  };
}

async function refreshSubsCache(): Promise<void> {
  const rows = await db.select().from(pushSubscriptionsTable);
  subs = rows.map(toPushSub);
}

const subsReady = refreshSubsCache();

// ── Send helpers (exported for use in other routes) ───────────────────────────
interface PushPayload { title: string; body: string; tag?: string; url?: string; }

async function sendTo(targets: PushSub[], payload: PushPayload) {
  await vapidReady;
  const json = JSON.stringify(payload);
  const dead: string[] = [];

  await Promise.allSettled(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, json);
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

// ── Routes ────────────────────────────────────────────────────────────────────

// Public: crew + manager both need the key
router.get("/push/vapid-key", async (_req, res) => {
  await vapidReady;
  if (!vapid) { res.status(503).json({ error: "Push notifications unavailable" }); return; }
  res.json({ publicKey: vapid.publicKey });
});

// Save a subscription (crew: no auth needed; manager: auth required is enforced by type)
router.post("/push/subscribe", async (req, res) => {
  const { subscription, type, vehicleId, officerId } = req.body as {
    subscription: webpush.PushSubscription;
    type: "manager" | "crew";
    vehicleId?: string;
    officerId?: string;
  };

  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    res.status(400).json({ error: "Missing subscription" }); return;
  }

  // Enforce manager auth for manager subscriptions
  if (type === "manager" && !req.session?.managerId) {
    res.status(401).json({ error: "Auth required for manager subscriptions" }); return;
  }

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
