import { pgTable, text, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces state.json's customLocations — user-added locations only.
// Preset locations stay CSV-seeded at boot (locations.csv), unchanged.
export const deploymentLocationsTable = pgTable("deployment_locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  lat: numeric("lat", { mode: "number" as const }).notNull(),
  lng: numeric("lng", { mode: "number" as const }).notNull(),
  region: text("region"),
  priority: integer("priority"),
});

export const insertDeploymentLocationSchema = createInsertSchema(deploymentLocationsTable);
export type InsertDeploymentLocation = z.infer<typeof insertDeploymentLocationSchema>;
export type DeploymentLocation = typeof deploymentLocationsTable.$inferSelect;
