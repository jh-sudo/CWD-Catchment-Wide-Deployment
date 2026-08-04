import { pgTable, text, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces config.json (the persistence gap — never cloud-synced on Replit).
// Singleton row (id is always 1). Manager/crew PINs are mutable app data,
// not a deploy-time secret — see the secrets & config migration ticket.
export const appConfigTable = pgTable(
  "app_config",
  {
    id: integer("id").primaryKey().default(1),
    managerPin: text("manager_pin").notNull(),
    crewPin: text("crew_pin").notNull(),
  },
  (table) => [check("app_config_singleton_check", sql`${table.id} = 1`)],
);

export const insertAppConfigSchema = createInsertSchema(appConfigTable);
export type InsertAppConfig = z.infer<typeof insertAppConfigSchema>;
export type AppConfig = typeof appConfigTable.$inferSelect;
