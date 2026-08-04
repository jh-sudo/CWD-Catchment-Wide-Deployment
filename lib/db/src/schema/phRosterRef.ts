import { pgTable, text, integer, date, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces ph-roster-ref.json (PHRosterRef) — real data, 62KB today.
export const phRosterRefTable = pgTable(
  "ph_roster_ref",
  {
    date: date("date").notNull(),
    rowIndex: integer("row_index").notNull(),
    subCatchment: text("sub_catchment"),
    shift: text("shift"),
    scheduledName: text("scheduled_name"),
    actualName: text("actual_name"),
    remarks: text("remarks"),
  },
  (table) => [primaryKey({ columns: [table.date, table.rowIndex] })],
);

export const insertPhRosterRefSchema = createInsertSchema(phRosterRefTable);
export type InsertPhRosterRef = z.infer<typeof insertPhRosterRefSchema>;
export type PhRosterRef = typeof phRosterRefTable.$inferSelect;
