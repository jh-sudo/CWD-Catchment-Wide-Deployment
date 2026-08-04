import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces state.json's roster (RosterTeam) — the live deployment-tracker's
// vehicle/partner/shift pairing, distinct from the roster & leave domain's
// officers/roster-cycle. partner is free-text (not FK'd to officers),
// matching current behavior.
export const deploymentTeamsTable = pgTable("deployment_teams", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  unitCode: text("unit_code").notNull(),
  vehicleNumber: text("vehicle_number").notNull(),
  partner: text("partner").notNull(),
  shift: text("shift").notNull(),
});

export const insertDeploymentTeamSchema = createInsertSchema(deploymentTeamsTable);
export type InsertDeploymentTeam = z.infer<typeof insertDeploymentTeamSchema>;
export type DeploymentTeam = typeof deploymentTeamsTable.$inferSelect;
