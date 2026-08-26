import { pgTable, text, integer, smallint, date, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton row (id is always 1) — replaces roster-config.json.
export const rosterConfigTable = pgTable(
  "roster_config",
  {
    id: integer("id").primaryKey().default(1),
    teamCount: smallint("team_count").notNull(),
    cycleStartDate: date("cycle_start_date").notNull(),
    // Minimum on-duty strength inputs for the FIRB Deployment summary
    // (rosterPlan.ts's buildSummary): weekend/PH minimum = (weekendPD +
    // weekendDAY) × 2; weekday minimum = weekdayMinStrength directly.
    // Nullable — application code falls back to 3 / 3 / 40 respectively
    // when unset, matching the Replit source these were ported from.
    weekendPD: smallint("weekend_pd"),
    weekendDay: smallint("weekend_day"),
    weekdayMinStrength: smallint("weekday_min_strength"),
  },
  (table) => [
    check("roster_config_singleton_check", sql`${table.id} = 1`),
    check("roster_config_team_count_check", sql`${table.teamCount} IN (20, 24, 28)`),
  ],
);

export const insertRosterConfigSchema = createInsertSchema(rosterConfigTable);
export type InsertRosterConfig = z.infer<typeof insertRosterConfigSchema>;
export type RosterConfig = typeof rosterConfigTable.$inferSelect;

// Replaces roster-config.json's maintenanceVehicles[].
export const rosterMaintenanceVehiclesTable = pgTable("roster_maintenance_vehicles", {
  vehicle: text("vehicle").primaryKey(),
});

export const insertRosterMaintenanceVehicleSchema = createInsertSchema(rosterMaintenanceVehiclesTable);
export type InsertRosterMaintenanceVehicle = z.infer<typeof insertRosterMaintenanceVehicleSchema>;
export type RosterMaintenanceVehicle = typeof rosterMaintenanceVehiclesTable.$inferSelect;
