import { pgTable, text, date, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officersTable } from "./officers";

// Replaces roster-overrides.json (DutyOverride). PK matches how the app
// already looks these up — no separate id in the source shape.
export const rosterOverridesTable = pgTable(
  "roster_overrides",
  {
    officerId: text("officer_id")
      .notNull()
      .references(() => officersTable.id),
    date: date("date").notNull(),
    duty: text("duty").notNull(),
    coveredByOfficerName: text("covered_by_officer_name"),
    targetDuty: text("target_duty"),
    crossPostedToUnit: text("cross_posted_to_unit"),
    vehicle: text("vehicle"),
    overtimeHours: text("overtime_hours"),
    swappedWithOfficerName: text("swapped_with_officer_name"),
    // Free-text note attached to an override, entered via the Master grid
    // editor's long-press comment modal. Shown elsewhere via NoteIndicator.
    comment: text("comment"),
    madeBy: text("made_by"),
    madeByName: text("made_by_name"),
    madeAt: timestamp("made_at", { withTimezone: true }),
    // The _coverFor auto-cover linkage: set only on overrides the app
    // generated to cover an absent officer, never on manual UploadBrief
    // overrides. See leave-override-interaction.md (ported from
    // .agents/memory) — UploadBrief overrides (this column null) must be
    // cleared when a leave is applied for the same officer+date, or the
    // override silently outranks the leave in duty resolution.
    coverForOfficerId: text("cover_for_officer_id").references(() => officersTable.id),
  },
  (table) => [primaryKey({ columns: [table.officerId, table.date] })],
);

export const insertRosterOverrideSchema = createInsertSchema(rosterOverridesTable);
export type InsertRosterOverride = z.infer<typeof insertRosterOverrideSchema>;
export type RosterOverride = typeof rosterOverridesTable.$inferSelect;
