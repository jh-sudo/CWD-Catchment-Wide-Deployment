import { pgTable, text, integer, date, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces state.json's activeShifts/activeTeams + in-memory deploymentDate.
// Singleton row (id is always 1).
export const deploymentSettingsTable = pgTable(
  "deployment_settings",
  {
    id: integer("id").primaryKey().default(1),
    activeShifts: text("active_shifts").array().notNull(),
    activeTeams: text("active_teams").array().notNull(),
    deploymentDate: date("deployment_date").notNull(),
  },
  (table) => [check("deployment_settings_singleton_check", sql`${table.id} = 1`)],
);

export const insertDeploymentSettingsSchema = createInsertSchema(deploymentSettingsTable);
export type InsertDeploymentSettings = z.infer<typeof insertDeploymentSettingsSchema>;
export type DeploymentSettings = typeof deploymentSettingsTable.$inferSelect;
