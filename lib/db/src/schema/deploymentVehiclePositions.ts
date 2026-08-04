import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces in-memory vehiclePositions (VehiclePosition). Latest-only per
// vehicle, upserted — not a full ping history. Avoids the current
// "vehicles vanish from the map after every restart" bug without the
// write volume of logging every ping.
export const deploymentVehiclePositionsTable = pgTable("deployment_vehicle_positions", {
  vehicleId: text("vehicle_id").primaryKey(),
  vehicleNumber: text("vehicle_number").notNull(),
  unitCode: text("unit_code").notNull(),
  partner: text("partner"),
  shift: text("shift"),
  lat: numeric("lat", { mode: "number" as const }).notNull(),
  lng: numeric("lng", { mode: "number" as const }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  acceptedLocationId: text("accepted_location_id"),
});

export const insertDeploymentVehiclePositionSchema = createInsertSchema(
  deploymentVehiclePositionsTable,
);
export type InsertDeploymentVehiclePosition = z.infer<
  typeof insertDeploymentVehiclePositionSchema
>;
export type DeploymentVehiclePosition = typeof deploymentVehiclePositionsTable.$inferSelect;
