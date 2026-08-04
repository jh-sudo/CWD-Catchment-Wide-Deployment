import { pgTable, text, integer, smallint, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Preserves existing ids from roster-officers.json (e.g. "bu1a") — already
// meaningful, and every other roster/leave table references officers by them.
export const officersTable = pgTable(
  "officers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    unitCode: text("unit_code").notNull(),
    vehicle: text("vehicle").notNull().default(""),
    catchment: text("catchment").notNull().default(""),
    teamSlot: integer("team_slot").notNull(),
    crewPosition: smallint("crew_position").notNull(),
    // Soft-delete flag. Officer deletion always goes through this instead of a
    // hard DELETE — officers.id is a RESTRICT-FK target from 8 other tables
    // (leave/override/swap/duty history), so a hard delete would either be
    // blocked outright or destroy that history. Deactivated officers are
    // excluded from future roster/PH-rotation generation but keep all past
    // records intact and remain visible (and reactivatable) on the officer
    // admin page.
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    check("officers_crew_position_check", sql`${table.crewPosition} IN (1, 2)`),
  ],
);

export const insertOfficerSchema = createInsertSchema(officersTable);
export type InsertOfficer = z.infer<typeof insertOfficerSchema>;
export type Officer = typeof officersTable.$inferSelect;
