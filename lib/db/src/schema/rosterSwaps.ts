import { pgTable, text, date, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officersTable } from "./officers";

// Replaces roster-swaps.json (RosterSwap). requesterName/targetName are a
// deliberate snapshot alongside the FK — point-in-time audit history, not
// something to normalize away (a later name change shouldn't rewrite past
// swap records).
export const rosterSwapsTable = pgTable(
  "roster_swaps",
  {
    id: text("id").primaryKey(),
    requesterId: text("requester_id")
      .notNull()
      .references(() => officersTable.id),
    requesterName: text("requester_name").notNull(),
    targetId: text("target_id")
      .notNull()
      .references(() => officersTable.id),
    targetName: text("target_name").notNull(),
    date: date("date").notNull(),
    requesterDuty: text("requester_duty").notNull(),
    targetDuty: text("target_duty").notNull(),
    reason: text("reason"),
    status: text("status").notNull(),
    reviewerName: text("reviewer_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    // Distinguishes a PH-roster-import-generated swap from a regular
    // officer-initiated swap. The frontend (ApplicationsManage.tsx) branches
    // its badge/label on this — restored after being dropped when this
    // table was ported from roster-swaps.json, which had it as `type`.
    type: text("type"),
    phName: text("ph_name"),
  },
  (table) => [
    check("roster_swaps_status_check", sql`${table.status} IN ('PENDING', 'APPROVED', 'REJECTED')`),
    check("roster_swaps_type_check", sql`${table.type} IS NULL OR ${table.type} IN ('PH')`),
  ],
);

export const insertRosterSwapSchema = createInsertSchema(rosterSwapsTable);
export type InsertRosterSwap = z.infer<typeof insertRosterSwapSchema>;
export type RosterSwap = typeof rosterSwapsTable.$inferSelect;
