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
