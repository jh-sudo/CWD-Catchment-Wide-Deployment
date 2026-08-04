import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces in-memory activeAlert (AlertRecord), expanded to full history —
// today a new broadcast silently discards the previous alert, which cut
// against the accountability reasoning used to justify persisting this
// domain at all.
export const deploymentAlertsTable = pgTable("deployment_alerts", {
  id: text("id").primaryKey(),
  extracted: text("extracted").notNull(),
  broadcastAt: timestamp("broadcast_at", { withTimezone: true }).notNull(),
});

export const insertDeploymentAlertSchema = createInsertSchema(deploymentAlertsTable);
export type InsertDeploymentAlert = z.infer<typeof insertDeploymentAlertSchema>;
export type DeploymentAlert = typeof deploymentAlertsTable.$inferSelect;

// Child of deployment_alerts. acknowledged_at is a new column — today
// acknowledgments are just a bare list of unit codes with no timestamp.
export const deploymentAlertAcknowledgmentsTable = pgTable(
  "deployment_alert_acknowledgments",
  {
    alertId: text("alert_id")
      .notNull()
      .references(() => deploymentAlertsTable.id),
    unitCode: text("unit_code").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.alertId, table.unitCode] })],
);

export const insertDeploymentAlertAcknowledgmentSchema = createInsertSchema(
  deploymentAlertAcknowledgmentsTable,
);
export type InsertDeploymentAlertAcknowledgment = z.infer<
  typeof insertDeploymentAlertAcknowledgmentSchema
>;
export type DeploymentAlertAcknowledgment = typeof deploymentAlertAcknowledgmentsTable.$inferSelect;
