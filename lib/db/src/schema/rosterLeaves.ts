import { pgTable, text, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officersTable } from "./officers";
import { leaveTypesTable } from "./leaveTypes";

// Replaces roster-leaves.json (LeaveEntry) — committed leave. Sits between
// roster_overrides and roster_cycle_duties in duty-resolution precedence
// (Override > Committed leave > Cycle > Generator fallback — see the
// roster & leave schema ticket's amendment, ported from .agents/memory).
export const rosterLeavesTable = pgTable(
  "roster_leaves",
  {
    id: text("id").primaryKey(),
    officerId: text("officer_id")
      .notNull()
      .references(() => officersTable.id),
    officerName: text("officer_name").notNull(),
    date: date("date").notNull(),
    leaveType: text("leave_type")
      .notNull()
      .references(() => leaveTypesTable.code),
    source: text("source"),
    coveringOfficerId: text("covering_officer_id").references(() => officersTable.id),
    coveringOfficerName: text("covering_officer_name"),
  },
  (table) => [
    // The app has always treated (officer_id, date) as unique — POST /leave
    // looks up an existing entry by this pair, not by id, before deciding
    // whether to update or insert. Made explicit here (found while porting
    // rosterPlan.ts to Postgres) so upserts can rely on a real constraint
    // instead of a select-then-branch race.
    unique("roster_leaves_officer_date_unique").on(table.officerId, table.date),
  ],
);

export const insertRosterLeaveSchema = createInsertSchema(rosterLeavesTable);
export type InsertRosterLeave = z.infer<typeof insertRosterLeaveSchema>;
export type RosterLeave = typeof rosterLeavesTable.$inferSelect;
