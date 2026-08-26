import { pgTable, text, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Free-text "Roster Requirements" notice shown on the roster dashboard —
// the shift-pattern/regulatory-compliance writeup a manager can edit in
// place. Singleton row (id is always 1), same pattern as app_config/
// roster_config. Ported from Replit's roster-requirements.json.
export const rosterRequirementsTable = pgTable(
  "roster_requirements",
  {
    id: integer("id").primaryKey().default(1),
    text: text("text").notNull(),
  },
  (table) => [check("roster_requirements_singleton_check", sql`${table.id} = 1`)],
);

export const insertRosterRequirementsSchema = createInsertSchema(rosterRequirementsTable);
export type InsertRosterRequirements = z.infer<typeof insertRosterRequirementsSchema>;
export type RosterRequirements = typeof rosterRequirementsTable.$inferSelect;
