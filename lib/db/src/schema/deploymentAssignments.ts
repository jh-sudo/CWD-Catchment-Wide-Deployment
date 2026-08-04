import { pgTable, text, numeric, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces state.json's assignments (Assignment). PK confirmed via
// assignments.set(vehicleId, ...) — current-state, one row per vehicle.
export const deploymentAssignmentsTable = pgTable(
  "deployment_assignments",
  {
    vehicleId: text("vehicle_id").primaryKey(),
    vehicleNumber: text("vehicle_number").notNull(),
    unitCode: text("unit_code").notNull(),
    locationId: text("location_id").notNull(),
    locationName: text("location_name").notNull(),
    lat: numeric("lat", { mode: "number" as const }).notNull(),
    lng: numeric("lng", { mode: "number" as const }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    assignedBy: text("assigned_by"),
    previousLocationId: text("previous_location_id"),
    previousLocationName: text("previous_location_name"),
  },
  (table) => [
    check(
      "deployment_assignments_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined')`,
    ),
  ],
);

export const insertDeploymentAssignmentSchema = createInsertSchema(deploymentAssignmentsTable);
export type InsertDeploymentAssignment = z.infer<typeof insertDeploymentAssignmentSchema>;
export type DeploymentAssignment = typeof deploymentAssignmentsTable.$inferSelect;
