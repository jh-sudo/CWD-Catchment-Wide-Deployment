import { pgTable, text, smallint, date, boolean, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces roster-patterns.json. A pattern is the authoring-time definition
// of a duty cycle (RosterBuilder's save target) — "implementing" one atomically
// rewrites roster_cycle_duties/officers/roster_config to make it live (see
// rosterPatterns.ts's POST /roster-patterns/:id/implement). Only
// name/teamCount/createdAt/isBuiltIn are ever queried outside the full
// blob (GET /roster-patterns' summary list), so the rest — weekday/weekend
// PD/DAY counts, the shift-pattern strings, the base_weeks grid, teams (with
// nested officers), and subcatchments — stays one jsonb column rather than
// a dozen normalized tables, matching how the app actually reads/writes it
// (always as one unit).
export const rosterPatternsTable = pgTable(
  "roster_patterns",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    teamCount: smallint("team_count").notNull(),
    createdAt: date("created_at").notNull(),
    isBuiltIn: boolean("is_built_in").notNull().default(false),
    data: jsonb("data").notNull(),
  },
  (table) => [
    check("roster_patterns_team_count_check", sql`${table.teamCount} IN (20, 24, 28)`),
  ],
);

export const insertRosterPatternSchema = createInsertSchema(rosterPatternsTable);
export type InsertRosterPattern = z.infer<typeof insertRosterPatternSchema>;
export type RosterPatternRow = typeof rosterPatternsTable.$inferSelect;
