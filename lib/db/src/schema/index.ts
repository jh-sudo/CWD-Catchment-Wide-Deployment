// Export your models here. Add one export per file
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

// ── Roster & leave domain ────────────────────────────────────────────────────
// See .scratch/govpaas-migration/issues/03-schema-roster-leave.md
export * from "./officers";
export * from "./rosterConfig";
export * from "./rosterCycle";
export * from "./rosterOverrides";
export * from "./rosterSwaps";
export * from "./leaveTypes";
export * from "./rosterLeaves";
export * from "./leaveRequests";
export * from "./rosterDayOverrides";

// ── Core ops state domain ────────────────────────────────────────────────────
// See .scratch/govpaas-migration/issues/02-schema-core-ops-state.md
export * from "./crmsCases";
export * from "./wlsReadings";
export * from "./managers";
export * from "./appConfig";
export * from "./deploymentTeams";
export * from "./deploymentSettings";
export * from "./deploymentLocations";
export * from "./deploymentAssignments";
export * from "./deploymentEntries";
export * from "./deploymentReassignmentHistory";
export * from "./deploymentVehiclePositions";
export * from "./deploymentSwapRequests";
export * from "./deploymentAlerts";

// ── PH roster domain ─────────────────────────────────────────────────────────
// See .scratch/govpaas-migration/issues/04-schema-ph-roster.md
export * from "./phRosterRef";
export * from "./phRosterOverrides";
export * from "./phBallot";
export * from "./phFaq";
export * from "./phHrBallotState";
export * from "./phRotationState";

// ── Inspections & push domain ────────────────────────────────────────────────
// See .scratch/govpaas-migration/issues/05-schema-inspections-push.md
export * from "./inspections";
export * from "./vapidKeys";
export * from "./pushSubscriptions";
