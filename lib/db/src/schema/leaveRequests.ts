import { pgTable, text, date, timestamp, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officersTable } from "./officers";
import { leaveTypesTable } from "./leaveTypes";
import { rosterLeavesTable } from "./rosterLeaves";
import { managersTable } from "./managers";

// Replaces leave-requests.json (LeaveRequest) — the full cover/IC approval
// workflow entity.
export const leaveRequestsTable = pgTable(
  "leave_requests",
  {
    id: text("id").primaryKey(),

    // Requester (crew)
    officerId: text("officer_id")
      .notNull()
      .references(() => officersTable.id),
    officerName: text("officer_name").notNull(),
    officerCatchment: text("officer_catchment").notNull(),

    // Leave details
    date: date("date").notNull(),
    leaveType: text("leave_type")
      .notNull()
      .references(() => leaveTypesTable.code),
    reason: text("reason"),

    // Cover officer
    coverOfficerId: text("cover_officer_id").references(() => officersTable.id),
    coverOfficerName: text("cover_officer_name"),
    coverStatus: text("cover_status"),
    coverRespondedAt: timestamp("cover_responded_at", { withTimezone: true }),
    coverDeclineReason: text("cover_decline_reason"),

    // IC approval
    icAccountId: text("ic_account_id").references(() => managersTable.id),
    icName: text("ic_name"),
    icStatus: text("ic_status"),
    icReviewedAt: timestamp("ic_reviewed_at", { withTimezone: true }),
    icNote: text("ic_note"),

    // Metadata
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    lastEditedBy: text("last_edited_by"),
    lastEditedOn: timestamp("last_edited_on", { withTimezone: true }),

    // Reference to committed leave entry (after approval)
    committedLeaveId: text("committed_leave_id").references(() => rosterLeavesTable.id),
  },
  (table) => [
    check(
      "leave_requests_cover_status_check",
      sql`${table.coverStatus} IS NULL OR ${table.coverStatus} IN ('PENDING', 'ACCEPTED', 'DECLINED')`,
    ),
    check(
      "leave_requests_ic_status_check",
      sql`${table.icStatus} IS NULL OR ${table.icStatus} IN ('PENDING', 'APPROVED', 'REJECTED')`,
    ),
    check(
      "leave_requests_status_check",
      sql`${table.status} IN ('PENDING_COVER', 'PENDING_IC', 'APPROVED', 'REJECTED', 'CANCELLED')`,
    ),
    // Backstops the app-level duplicate check in POST /leave-requests, which
    // does a select-then-insert with an await boundary between them and is
    // otherwise racy under concurrent requests for the same officer+date.
    // Partial (not a plain unique) because REJECTED/CANCELLED requests must
    // not block a resubmission for the same officer+date.
    uniqueIndex("leave_requests_officer_date_active_unique")
      .on(table.officerId, table.date)
      .where(sql`${table.status} IN ('PENDING_COVER', 'PENDING_IC', 'APPROVED')`),
  ],
);

export const insertLeaveRequestSchema = createInsertSchema(leaveRequestsTable);
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;
export type LeaveRequest = typeof leaveRequestsTable.$inferSelect;
