import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// New — not a file today. Extracted from ABSENT_DUTY_SET in rosterPlan.ts.
// A lookup table rather than a free-text column or Postgres enum — this
// list grows, and enums are painful to extend later.
export const leaveTypesTable = pgTable("leave_types", {
  code: text("code").primaryKey(),
  description: text("description"),
});

export const insertLeaveTypeSchema = createInsertSchema(leaveTypesTable);
export type InsertLeaveType = z.infer<typeof insertLeaveTypeSchema>;
export type LeaveType = typeof leaveTypesTable.$inferSelect;

// Seed values for the initial migration — the codes found in
// ABSENT_DUTY_SET (rosterPlan.ts). Descriptions are left blank for a human
// to fill in; the codes themselves are what duty resolution depends on.
export const LEAVE_TYPE_CODES = [
  "VL", "SL", "MC", "CCL", "FCL", "PL", "SPL", "UL", "ML", "BL", "C", "CSL",
  "SLWOMC", "AMC", "AMMA", "AMTO", "PMTO", "C/PMTO", "NS", "PPTW", "TO",
  "OVL", "HL", "OIL", "OIL(AM)", "OIL(PM)", "EL", "CPL", "MA", "UNPAID L",
] as const;
