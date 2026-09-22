import { pgTable, text, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Manual, admin/manager-triggered point-in-time snapshot of the four
// committed roster/leave datasets (roster_leaves, roster_overrides,
// roster_swaps, leave_requests), restorable via
// POST /roster-plan/history/restore. Each dataset is stored as one jsonb
// column rather than normalized — a snapshot is always read/written as one
// unit, matching this schema's established convention for that shape of
// data (see roster_patterns.data's own comment for the same argument).
// Replaces reference's GCS-backed backups/<ts>/*.json files.
//
// Unlike reference, there's no more "always snapshot automatically before a
// full wipe" trigger to hook this into — the wipe itself (history/clear's
// old mode=all) was removed entirely, not hardened, per
// .scratch/replit-resync-2026-09-21/issues/19. So snapshots here are
// created on demand by an admin/manager, not as a side effect of another
// action. .scratch/replit-resync-2026-09-21/issues/35.
export const rosterPlanBackupsTable = pgTable("roster_plan_backups", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by"),
  leaveCount: integer("leave_count").notNull(),
  swapCount: integer("swap_count").notNull(),
  leaves: jsonb("leaves").notNull(),
  overrides: jsonb("overrides").notNull(),
  swaps: jsonb("swaps").notNull(),
  leaveRequests: jsonb("leave_requests").notNull(),
});

export const insertRosterPlanBackupSchema = createInsertSchema(rosterPlanBackupsTable);
export type InsertRosterPlanBackup = z.infer<typeof insertRosterPlanBackupSchema>;
export type RosterPlanBackupRow = typeof rosterPlanBackupsTable.$inferSelect;
