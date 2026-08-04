import { sql } from "drizzle-orm";
import { db, vapidKeysTable, pushSubscriptionsTable } from "@workspace/db";
import { readJson } from "./lib/read";
import type { DomainReport, TableReport } from "./lib/report";

interface VapidKeysJson {
  publicKey: string;
  privateKey: string;
}

interface PushSubscriptionJson {
  subscription: { endpoint: string; keys: { auth: string; p256dh: string } };
  type: string;
  vehicleId?: string;
  officerId?: string;
  savedAt: string;
}

export async function backfillInspectionsAndPush(dryRun: boolean): Promise<DomainReport> {
  const tables: TableReport[] = [];
  const warnings: string[] = [];

  // ── vapid_keys (singleton) ───────────────────────────────────────────────
  // Carried forward as-is (per the secrets & config migration ticket) so
  // existing browser push subscriptions don't need to re-subscribe.
  const vapid = readJson<VapidKeysJson | null>("vapid.json", null);
  if (vapid && !dryRun) {
    await db
      .insert(vapidKeysTable)
      .values({ id: 1, publicKey: vapid.publicKey, privateKey: vapid.privateKey })
      .onConflictDoUpdate({ target: vapidKeysTable.id, set: { publicKey: sql`excluded.public_key`, privateKey: sql`excluded.private_key` } });
  }
  tables.push({ table: "vapid_keys", sourceCount: vapid ? 1 : 0, upserted: dryRun || !vapid ? 0 : 1 });

  // ── push_subscriptions ───────────────────────────────────────────────────
  const subs = readJson<PushSubscriptionJson[]>("push-subscriptions.json", []);
  if (subs.some((s) => s.officerId)) {
    warnings.push("push-subscriptions.json has officer-linked subscriptions — verify roster & leave domain ran first (officers FK)");
  }
  if (!dryRun && subs.length > 0) {
    await db
      .insert(pushSubscriptionsTable)
      .values(subs.map((s) => ({
        endpoint: s.subscription.endpoint,
        authKey: s.subscription.keys.auth,
        p256dhKey: s.subscription.keys.p256dh,
        type: s.type,
        vehicleId: s.vehicleId ?? null,
        officerId: s.officerId ?? null,
        savedAt: new Date(s.savedAt),
      })))
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: { authKey: sql`excluded.auth_key`, p256dhKey: sql`excluded.p256dh_key`, type: sql`excluded.type` },
      });
  }
  tables.push({ table: "push_subscriptions", sourceCount: subs.length, upserted: dryRun ? 0 : subs.length });

  // ── inspections / inspection_photos / inspection_lines ──────────────────
  // Fresh start — no durable source data exists for this domain (confirmed
  // by the inspections & push schema ticket). Nothing to migrate.
  tables.push({ table: "inspections", sourceCount: 0, upserted: 0 });
  tables.push({ table: "inspection_photos", sourceCount: 0, upserted: 0 });
  tables.push({ table: "inspection_lines", sourceCount: 0, upserted: 0 });

  return { domain: "05 inspections & push", tables, warnings };
}
