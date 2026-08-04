import { pgTable, text, date, boolean, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officersTable } from "./officers";

// Replaces ph-roster.json (PHRosterOverrides), currently empty. slot_key is
// the inner Record key from the source shape — exact semantics (whether it
// matches ph_roster_ref.row_index or a unit code) aren't fully pinned down
// by the code alone; confirm against real usage during backfill.
export const phRosterOverridesTable = pgTable(
  "ph_roster_overrides",
  {
    date: date("date").notNull(),
    slotKey: text("slot_key").notNull(),
    actualOfficerName: text("actual_officer_name"),
    actualOfficerId: text("actual_officer_id").references(() => officersTable.id),
    swapDone: boolean("swap_done"),
    remarks: text("remarks"),
  },
  (table) => [primaryKey({ columns: [table.date, table.slotKey] })],
);

export const insertPhRosterOverrideSchema = createInsertSchema(phRosterOverridesTable);
export type InsertPhRosterOverride = z.infer<typeof insertPhRosterOverrideSchema>;
export type PhRosterOverride = typeof phRosterOverridesTable.$inferSelect;
