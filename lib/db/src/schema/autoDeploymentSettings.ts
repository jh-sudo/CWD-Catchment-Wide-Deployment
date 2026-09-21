import { pgTable, integer, boolean, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton row (id is always 1) — whether the "auto-deploy on Heavy Rain
// Warning" pipeline is enabled, its recent-event dedup window, and its last
// run's outcome. Default OFF per the user's explicit approval condition for
// this feature; admin AND manager can toggle it (see requireAdminOrManager
// on the route). .scratch/replit-resync-2026-09-21/issues/32.
export const autoDeploymentSettingsTable = pgTable(
  "auto_deployment_settings",
  {
    id: integer("id").primaryKey().default(1),
    enabled: boolean("enabled").notNull().default(false),
    // { key: string (sha256 of normalized text), receivedAt: string (ISO) }[]
    // — a rolling 24h dedup window so the same forwarded/re-pasted warning
    // text doesn't retrigger the pipeline; pruned on every read.
    recentEventKeys: jsonb("recent_event_keys").notNull(),
    // { status, receivedAt, completedAt?, message?, error? } | null
    lastRun: jsonb("last_run"),
  },
  (table) => [check("auto_deployment_settings_singleton_check", sql`${table.id} = 1`)],
);

export const insertAutoDeploymentSettingsSchema = createInsertSchema(autoDeploymentSettingsTable);
export type InsertAutoDeploymentSettings = z.infer<typeof insertAutoDeploymentSettingsSchema>;
export type AutoDeploymentSettings = typeof autoDeploymentSettingsTable.$inferSelect;
