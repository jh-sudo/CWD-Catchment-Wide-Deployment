import { pgTable, text, integer, date, check, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton row (id is always 1) — replaces roster-cycle.json's top-level fields.
export const rosterCycleMetaTable = pgTable(
  "roster_cycle_meta",
  {
    id: integer("id").primaryKey().default(1),
    cycleStartDate: date("cycle_start_date").notNull(),
    cycleLengthDays: integer("cycle_length_days").notNull(),
    excelStartDate: date("excel_start_date").notNull(),
  },
  (table) => [check("roster_cycle_meta_singleton_check", sql`${table.id} = 1`)],
);

export const insertRosterCycleMetaSchema = createInsertSchema(rosterCycleMetaTable);
export type InsertRosterCycleMeta = z.infer<typeof insertRosterCycleMetaSchema>;
export type RosterCycleMeta = typeof rosterCycleMetaTable.$inferSelect;

// Replaces roster-cycle.json's officers[].duties[]. Keyed by unit_code (not
// officer_id) — getDutyFromCycle(unitCode, date) confirms both crew positions
// on a unit share the same duty; see the roster & leave schema ticket.
export const rosterCycleDutiesTable = pgTable(
  "roster_cycle_duties",
  {
    unitCode: text("unit_code").notNull(),
    date: date("date").notNull(),
    targetDuty: text("target_duty").notNull(),
    actualDuty: text("actual_duty").notNull(),
  },
  (table) => [primaryKey({ columns: [table.unitCode, table.date] })],
);

export const insertRosterCycleDutySchema = createInsertSchema(rosterCycleDutiesTable);
export type InsertRosterCycleDuty = z.infer<typeof insertRosterCycleDutySchema>;
export type RosterCycleDuty = typeof rosterCycleDutiesTable.$inferSelect;
