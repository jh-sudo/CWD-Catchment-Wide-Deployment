import { pgTable, integer, text, boolean, smallint, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton row (id is always 1) — the "PH Builder" tab's current working
// config: the reorderable unit rotation pattern, the two rule toggles, an
// officer exclusion list, and the next year to generate from.
// .scratch/replit-resync-2026-09-21/issues/31.
export const phBuilderConfigTable = pgTable(
  "ph_builder_config",
  {
    id: integer("id").primaryKey().default(1),
    // Each active unit exactly once (validated in phRoster.ts, not here) —
    // unlike the underlying PH_ROTATION_SEQUENCE constant it replaces, this
    // pattern has no intentional duplicates: making the sequence
    // user-reorderable only makes sense if every unit is a single, unique
    // slot in it.
    pattern: text("pattern").array().notNull(),
    consecutivePH: boolean("consecutive_ph").notNull().default(true),
    sameHolidayPreviousYear: boolean("same_holiday_previous_year").notNull().default(true),
    excludedOfficers: text("excluded_officers").array().notNull(),
    startYear: smallint("start_year").notNull().default(2027),
  },
  (table) => [check("ph_builder_config_singleton_check", sql`${table.id} = 1`)],
);

export const insertPhBuilderConfigSchema = createInsertSchema(phBuilderConfigTable);
export type InsertPhBuilderConfig = z.infer<typeof insertPhBuilderConfigSchema>;
export type PhBuilderConfig = typeof phBuilderConfigTable.$inferSelect;

// Named, saved snapshots of the above config, reusable from the PH Builder
// tab's preset dropdown.
export const phBuilderPresetsTable = pgTable("ph_builder_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  config: jsonb("config").notNull(), // PHBuilderConfig shape — see phRoster.ts
  updatedAt: text("updated_at").notNull(),
});

export const insertPhBuilderPresetSchema = createInsertSchema(phBuilderPresetsTable);
export type InsertPhBuilderPreset = z.infer<typeof insertPhBuilderPresetSchema>;
export type PhBuilderPreset = typeof phBuilderPresetsTable.$inferSelect;
