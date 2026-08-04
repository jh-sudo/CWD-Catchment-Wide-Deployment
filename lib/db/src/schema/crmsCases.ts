import { pgTable, text, boolean, numeric, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces crms.json (CrmsCase).
export const crmsCasesTable = pgTable(
  "crms_cases",
  {
    id: text("id").primaryKey(),
    caseNumber: text("case_number").notNull(),
    isWog: boolean("is_wog").notNull(),
    fpName: text("fp_name").notNull(),
    fpContact: text("fp_contact").notNull(),
    address: text("address").notNull(),
    postalCode: text("postal_code").notNull(),
    // mode: "number" — lat/lng are simple floats with no precision-loss risk;
    // avoids string<->number conversion boilerplate at every call site.
    lat: numeric("lat", { mode: "number" as const }),
    lng: numeric("lng", { mode: "number" as const }),
    locationName: text("location_name").notNull(),
    details: text("details").notNull(),
    status: text("status").notNull(),
    assignedVehicleId: text("assigned_vehicle_id"),
    assignedUnitCode: text("assigned_unit_code"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    fpUpdatedAt: timestamp("fp_updated_at", { withTimezone: true }),
    assistanceProvidedAt: timestamp("assistance_provided_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    floodAssessment: text("flood_assessment"),
    updateProvidedToFp: text("update_provided_to_fp"),
    reportedBy: text("reported_by").notNull(),
  },
  (table) => [
    check(
      "crms_cases_status_check",
      sql`${table.status} IN ('TO_BE_ASSIGNED', 'TEAM_ACKNOWLEDGE_OTW', 'FP_UPDATED', 'ASSISTANCE_PROVIDED', 'RESOLVED')`,
    ),
  ],
);

export const insertCrmsCaseSchema = createInsertSchema(crmsCasesTable);
export type InsertCrmsCase = z.infer<typeof insertCrmsCaseSchema>;
export type CrmsCase = typeof crmsCasesTable.$inferSelect;

// Child of crms_cases — replaces CrmsCase.comments[] (CrmsComment).
export const crmsCommentsTable = pgTable("crms_comments", {
  commentId: text("comment_id").primaryKey(),
  caseId: text("case_id")
    .notNull()
    .references(() => crmsCasesTable.id),
  vehicleId: text("vehicle_id").notNull(),
  unitCode: text("unit_code").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const insertCrmsCommentSchema = createInsertSchema(crmsCommentsTable);
export type InsertCrmsComment = z.infer<typeof insertCrmsCommentSchema>;
export type CrmsComment = typeof crmsCommentsTable.$inferSelect;
