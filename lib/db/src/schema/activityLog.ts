import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// In-app notification feed — replaces Replit's activity-log.json. Currently
// only "leave-applied" is emitted (see rosterPlan.ts's POST /roster-plan/leave).
// "roster-implement" is reserved for when RosterBuilder (Phase C) lands —
// GET /activity-log's role-filtering already treats it as always-visible to
// crew, matching Replit, so no route change will be needed when that day comes.
export const activityLogTable = pgTable("activity_log", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "roster-implement" | "leave-applied"
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  // roster-implement fields
  patternName: text("pattern_name"),
  implementDate: text("implement_date"),
  implementerName: text("implementer_name"),
  // leave-applied fields
  officerId: text("officer_id"),
  officerName: text("officer_name"),
  leaveDate: text("leave_date"),
  leaveType: text("leave_type"),
  appliedByName: text("applied_by_name"),
});

export const insertActivityLogSchema = createInsertSchema(activityLogTable);
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLogEntry = typeof activityLogTable.$inferSelect;
