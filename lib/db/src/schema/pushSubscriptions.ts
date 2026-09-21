import { pgTable, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officersTable } from "./officers";

// Replaces push-subscriptions.json — the newly-found gap (push.ts never
// called uploadToCloud at all). endpoint is the natural key, matching how
// the existing code already dedupes/removes dead subscriptions.
export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    authKey: text("auth_key").notNull(),
    p256dhKey: text("p256dh_key").notNull(),
    type: text("type").notNull(),
    vehicleId: text("vehicle_id"),
    officerId: text("officer_id").references(() => officersTable.id),
    // CAT1 sector codes selected on the public /lightning page. Null/empty
    // means all sectors (backward compatible with subscriptions saved
    // before this column existed). .scratch/replit-resync-2026-09-21/issues/24.
    lightningSectors: text("lightning_sectors").array(),
    savedAt: timestamp("saved_at", { withTimezone: true }),
  },
  (table) => [
    check("push_subscriptions_type_check", sql`${table.type} IN ('manager', 'crew')`),
  ],
);

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptionsTable);
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
