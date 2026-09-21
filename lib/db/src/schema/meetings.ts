import { pgTable, text, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { managersTable } from "./managers";

// Replaces meetings.json. One row per meeting, read/written as one unit —
// matching this schema's existing convention for naturally-single-blob data
// (roster_patterns.data, ph_hr_ballot_state.pools, ph_builder_presets.config):
// every mutation in meetings.ts operates on one whole Meeting object, so
// proposedSlots/responses/reminderState stay jsonb columns here rather than
// being split into a handful of always-joined child tables — no query in
// this feature needs to look across meetings at the slot/response level.
// .scratch/replit-resync-2026-09-21/issues/33.
export const meetingsTable = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    location: text("location").notNull(),
    organizerId: text("organizer_id").notNull().references(() => managersTable.id),
    organizerName: text("organizer_name").notNull(),
    // attendeeIds itself is never stored — always the derived union of these
    // two, recomputed in application code, matching reference's own
    // loadMeetings() behavior.
    requiredAttendeeIds: text("required_attendee_ids").array().notNull(),
    optionalAttendeeIds: text("optional_attendee_ids").array().notNull(),
    proposedSlots: jsonb("proposed_slots").notNull(), // ProposedSlot[]
    responses: jsonb("responses").notNull(), // Record<attendeeId, { slotIds: string[], respondedAt: string }>
    status: text("status").notNull(), // "collecting" | "ready" | "confirmed"
    confirmedSlotId: text("confirmed_slot_id"),
    confirmedAt: text("confirmed_at"),
    readyNotifiedAt: text("ready_notified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    reminderState: jsonb("reminder_state").notNull(), // Record<attendeeId, { nextReminderAt: string, lastSentAt: string|null }>
    lastResponseProgress: jsonb("last_response_progress"), // { responderName, respondedCount, remainingCount, at } | null
    lastUpdateNotice: jsonb("last_update_notice"), // { summary, at } | null
  },
  (table) => [
    check("meetings_status_check", sql`${table.status} IN ('collecting', 'ready', 'confirmed')`),
  ],
);

export const insertMeetingSchema = createInsertSchema(meetingsTable);
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type MeetingRow = typeof meetingsTable.$inferSelect;

// Replaces meeting-groups.json — an organizer's own reusable named attendee
// lists (distinct from managers.meeting_groups, the fixed-enum self-tag).
export const meetingGroupsTable = pgTable("meeting_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull().references(() => managersTable.id),
  memberIds: text("member_ids").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertMeetingGroupSchema = createInsertSchema(meetingGroupsTable);
export type InsertMeetingGroup = z.infer<typeof insertMeetingGroupSchema>;
export type MeetingGroupRow = typeof meetingGroupsTable.$inferSelect;

// Replaces meeting-calendar-events.json — a manager's own leave/out-of-office
// date ranges, shown on their My Calendar page and surfaced to meeting
// organizers as (non-blocking) availability warnings.
export const managerCalendarEventsTable = pgTable(
  "manager_calendar_events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => managersTable.id),
    type: text("type").notNull(), // "leave" | "out-of-office"
    startDate: text("start_date").notNull(), // YYYY-MM-DD
    endDate: text("end_date").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("manager_calendar_events_type_check", sql`${table.type} IN ('leave', 'out-of-office')`),
  ],
);

export const insertManagerCalendarEventSchema = createInsertSchema(managerCalendarEventsTable);
export type InsertManagerCalendarEvent = z.infer<typeof insertManagerCalendarEventSchema>;
export type ManagerCalendarEventRow = typeof managerCalendarEventsTable.$inferSelect;
