import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces in-memory swapRequests (SwapRequest) — pending-only, deleted on
// resolution (matches current behavior; no status field in the source shape).
export const deploymentSwapRequestsTable = pgTable("deployment_swap_requests", {
  id: text("id").primaryKey(),
  fromVehicleId: text("from_vehicle_id").notNull(),
  fromUnitCode: text("from_unit_code").notNull(),
  fromVehicleNumber: text("from_vehicle_number").notNull(),
  fromLocationId: text("from_location_id").notNull(),
  fromLocationName: text("from_location_name").notNull(),
  toVehicleId: text("to_vehicle_id").notNull(),
  toUnitCode: text("to_unit_code").notNull(),
  toVehicleNumber: text("to_vehicle_number").notNull(),
  toLocationId: text("to_location_id").notNull(),
  toLocationName: text("to_location_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const insertDeploymentSwapRequestSchema = createInsertSchema(deploymentSwapRequestsTable);
export type InsertDeploymentSwapRequest = z.infer<typeof insertDeploymentSwapRequestSchema>;
export type DeploymentSwapRequest = typeof deploymentSwapRequestsTable.$inferSelect;
