import { pgTable, text, date, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officersTable } from "./officers";

// Replaces roster-day-overrides.json (DayOverrideEvent).
export const rosterDayOverridesTable = pgTable("roster_day_overrides", {
  id: text("id").primaryKey(),
  date: date("date").notNull(),
  text: text("text").notNull(),
  submittedBy: text("submitted_by").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
});

export const insertRosterDayOverrideSchema = createInsertSchema(rosterDayOverridesTable);
export type InsertRosterDayOverride = z.infer<typeof insertRosterDayOverrideSchema>;
export type RosterDayOverride = typeof rosterDayOverridesTable.$inferSelect;

// Child table — DayOverrideEvent.applied[] is one-to-many. One row per
// officer per event (the write path in rosterPlan.ts's POST
// /roster-plan/day-overrides already dedupes to this via a Set before
// insert) — the primary key backstops that at the DB level too, so a
// retried request or UI double-submit can't silently duplicate a row.
export const rosterDayOverrideApplicationsTable = pgTable(
  "roster_day_override_applications",
  {
    dayOverrideId: text("day_override_id")
      .notNull()
      .references(() => rosterDayOverridesTable.id),
    officerId: text("officer_id")
      .notNull()
      .references(() => officersTable.id),
    officerName: text("officer_name").notNull(),
    duty: text("duty").notNull(),
  },
  (table) => [primaryKey({ columns: [table.dayOverrideId, table.officerId] })],
);

export const insertRosterDayOverrideApplicationSchema = createInsertSchema(
  rosterDayOverrideApplicationsTable,
);
export type InsertRosterDayOverrideApplication = z.infer<
  typeof insertRosterDayOverrideApplicationSchema
>;
export type RosterDayOverrideApplication = typeof rosterDayOverrideApplicationsTable.$inferSelect;
