import { pgTable, text, integer, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces in-memory deploymentEntries (DeploymentEntry) — current-state
// table matching today's delete-on-move behavior (removeVehicleEntries).
export const deploymentEntriesTable = pgTable(
  "deployment_entries",
  {
    locationId: text("location_id").notNull(),
    vehicleId: text("vehicle_id").notNull(),
    vehicleNumber: text("vehicle_number").notNull(),
    unitCode: text("unit_code").notNull(),
    partner: text("partner").notNull(),
    shift: text("shift").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    eta: text("eta").notNull(),
    etaMinutes: integer("eta_minutes").notNull(),
    arrived: boolean("arrived").notNull(),
    // Text, not a timestamp — the app stores a 4-digit "HHMM" clock string
    // (e.g. "1340", always SGT), not an ISO datetime. Found while porting
    // deployments.ts: `entry.arrivedAt = `${hrs}${mins}``.
    arrivedAt: text("arrived_at"),
    weather: text("weather"),
    fromRoad: text("from_road"),
    assignedBy: text("assigned_by"),
    previousLocationId: text("previous_location_id"),
    previousLocationName: text("previous_location_name"),
    reassignedAt: timestamp("reassigned_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.locationId, table.vehicleId] })],
);

export const insertDeploymentEntrySchema = createInsertSchema(deploymentEntriesTable);
export type InsertDeploymentEntry = z.infer<typeof insertDeploymentEntrySchema>;
export type DeploymentEntry = typeof deploymentEntriesTable.$inferSelect;
