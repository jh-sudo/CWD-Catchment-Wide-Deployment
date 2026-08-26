import { pgTable, text, date, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces vehicle-defaults.json (plate → unit). Permanent ownership: which
// subcatchment (or "home" / "maintenance") a vehicle belongs to when nothing
// has borrowed it. A plate with no row here falls back to a hardcoded
// 17-plate seed set (HARDCODED_VEHICLE_DEFAULTS in vehicleArrangement.ts),
// mirroring Replit's loadVehicleDefaults() merge-over-hardcoded pattern.
export const rosterVehicleDefaultsTable = pgTable("roster_vehicle_defaults", {
  plate: text("plate").primaryKey(),
  location: text("location").notNull(),
});

export const insertRosterVehicleDefaultSchema = createInsertSchema(rosterVehicleDefaultsTable);
export type InsertRosterVehicleDefault = z.infer<typeof insertRosterVehicleDefaultSchema>;
export type RosterVehicleDefault = typeof rosterVehicleDefaultsTable.$inferSelect;

// Replaces vehicle-arrangement.json ({date: [{plate, location}]}) — one row
// per (date, plate) that a manager has explicitly saved. A date with zero
// rows has no saved arrangement; the read route falls back to computing
// placements (carry-forward-if-still-working, else reset to ownership
// default) rather than treating "no rows" as "all vehicles unplaced".
export const rosterVehicleArrangementsTable = pgTable(
  "roster_vehicle_arrangements",
  {
    date: date("date").notNull(),
    plate: text("plate").notNull(),
    location: text("location").notNull(),
  },
  (table) => [primaryKey({ columns: [table.date, table.plate] })],
);

export const insertRosterVehicleArrangementSchema = createInsertSchema(rosterVehicleArrangementsTable);
export type InsertRosterVehicleArrangement = z.infer<typeof insertRosterVehicleArrangementSchema>;
export type RosterVehicleArrangement = typeof rosterVehicleArrangementsTable.$inferSelect;
