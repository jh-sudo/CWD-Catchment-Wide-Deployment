import { randomUUID } from "crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  meetingsTable,
  meetingGroupsTable,
  managerCalendarEventsTable,
} from "@workspace/db";
import {
  getApprovedAccountSummaries,
  getManager,
  requireAdminOrManager,
  requireManager,
  setManagerMeetingGroups,
  type ManagerAccount,
} from "./auth.js";
import { sendToAccount } from "./push.js";
import { logger } from "../lib/logger.js";

// Meeting scheduler — propose/vote on candidate time slots, reusable
// attendee groups, and out-of-office/leave calendar events, restricted to
// the "manager" role (admin gets read/delete-only; ic and crew have no
// access at all). Ported from Replit's meetings.ts, adapted to this repo's
// Postgres persistence rather than a flat-JSON file: every mutation here
// operates on one row (or a handful of a caller's own rows), so each is a
// direct db.insert/update/delete rather than reference's "load the whole
// array, mutate in memory, rewrite the whole array" pattern — that pattern
// only existed to work around JSON-file storage having no per-row API.
// .scratch/replit-resync-2026-09-21/issues/33.
export const meetingsRouter = Router();

const REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;

const MANAGER_GROUPS = [
  "SDD",
  "DD (FOB)",
  "DD (DMB)",
  "SAD (FOB)",
  "SAD (DMB)",
  "SAD (FMOC)",
  "SAD (SMART)",
  "Unit Heads (FOB)",
  "Unit Heads (DMB)",
  "2IC (FOB)",
  "2IC (DMB)",
] as const;

type Period = "AM" | "PM";
type MeetingStatus = "collecting" | "ready" | "confirmed";

interface ProposedSlot {
  id: string;
  date: string;
  period: Period;
}

interface MeetingResponse {
  slotIds: string[];
  respondedAt: string;
}

interface ReminderState {
  nextReminderAt: string;
  lastSentAt: string | null;
}

interface ResponseProgress {
  responderName: string;
  respondedCount: number;
  remainingCount: number;
  at: string;
}

interface MeetingUpdateNotice {
  summary: string;
  at: string;
}

export interface Meeting {
  id: string;
  title: string;
  location: string;
  organizerId: string;
  organizerName: string;
  attendeeIds: string[];
  requiredAttendeeIds: string[];
  optionalAttendeeIds: string[];
  proposedSlots: ProposedSlot[];
  responses: Record<string, MeetingResponse>;
  status: MeetingStatus;
  confirmedSlotId: string | null;
  confirmedAt: string | null;
  readyNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reminderState: Record<string, ReminderState>;
  lastResponseProgress?: ResponseProgress;
  lastUpdateNotice?: MeetingUpdateNotice;
}

interface MeetingGroup {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ManagerCalendarEvent {
  id: string;
  ownerId: string;
  type: "leave" | "out-of-office";
  startDate: string;
  endDate: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Persistence ────────────────────────────────────────────────────────────

function rowToMeeting(row: typeof meetingsTable.$inferSelect): Meeting {
  const requiredAttendeeIds = row.requiredAttendeeIds;
  const optionalAttendeeIds = row.optionalAttendeeIds;
  return {
    id: row.id,
    title: row.title,
    location: row.location,
    organizerId: row.organizerId,
    organizerName: row.organizerName,
    requiredAttendeeIds,
    optionalAttendeeIds,
    // Derived, never stored — matches reference's own loadMeetings().
    attendeeIds: [...new Set([...requiredAttendeeIds, ...optionalAttendeeIds])],
    proposedSlots: row.proposedSlots as ProposedSlot[],
    responses: row.responses as Record<string, MeetingResponse>,
    status: row.status as MeetingStatus,
    confirmedSlotId: row.confirmedSlotId,
    confirmedAt: row.confirmedAt,
    readyNotifiedAt: row.readyNotifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reminderState: row.reminderState as Record<string, ReminderState>,
    lastResponseProgress: (row.lastResponseProgress as ResponseProgress | null) ?? undefined,
    lastUpdateNotice: (row.lastUpdateNotice as MeetingUpdateNotice | null) ?? undefined,
  };
}

async function loadMeetings(): Promise<Meeting[]> {
  const rows = await db.select().from(meetingsTable);
  return rows.map(rowToMeeting);
}

async function loadMeeting(id: string | string[]): Promise<Meeting | undefined> {
  const normalizedId = Array.isArray(id) ? id[0] : id;
  const [row] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, normalizedId));
  return row ? rowToMeeting(row) : undefined;
}

async function saveMeeting(meeting: Meeting): Promise<void> {
  const values = {
    id: meeting.id,
    title: meeting.title,
    location: meeting.location,
    organizerId: meeting.organizerId,
    organizerName: meeting.organizerName,
    requiredAttendeeIds: meeting.requiredAttendeeIds,
    optionalAttendeeIds: meeting.optionalAttendeeIds,
    proposedSlots: meeting.proposedSlots,
    responses: meeting.responses,
    status: meeting.status,
    confirmedSlotId: meeting.confirmedSlotId,
    confirmedAt: meeting.confirmedAt,
    readyNotifiedAt: meeting.readyNotifiedAt,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
    reminderState: meeting.reminderState,
    lastResponseProgress: meeting.lastResponseProgress ?? null,
    lastUpdateNotice: meeting.lastUpdateNotice ?? null,
  };
  await db
    .insert(meetingsTable)
    .values(values)
    .onConflictDoUpdate({ target: meetingsTable.id, set: values });
}

async function deleteMeetingRow(id: string): Promise<void> {
  await db.delete(meetingsTable).where(eq(meetingsTable.id, id));
}

function rowToGroup(row: typeof meetingGroupsTable.$inferSelect): MeetingGroup {
  return {
    id: row.id, name: row.name, ownerId: row.ownerId, memberIds: row.memberIds,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function loadMeetingGroups(ownerId: string): Promise<MeetingGroup[]> {
  const rows = await db.select().from(meetingGroupsTable).where(eq(meetingGroupsTable.ownerId, ownerId));
  return rows.map(rowToGroup);
}

function rowToCalendarEvent(row: typeof managerCalendarEventsTable.$inferSelect): ManagerCalendarEvent {
  return {
    id: row.id, ownerId: row.ownerId, type: row.type as "leave" | "out-of-office",
    startDate: row.startDate, endDate: row.endDate, note: row.note ?? undefined,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function loadAllCalendarEvents(): Promise<ManagerCalendarEvent[]> {
  const rows = await db.select().from(managerCalendarEventsTable);
  return rows.map(rowToCalendarEvent);
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function accountFromRequest(req: { session?: { managerId?: string } }): ManagerAccount | undefined {
  return req.session?.managerId ? getManager(req.session.managerId) : undefined;
}

function managerFromRequest(
  req: { session?: { managerId?: string } },
  res: { status: (code: number) => { json: (body: { error: string }) => void } },
): ManagerAccount | undefined {
  const caller = accountFromRequest(req);
  if (!caller) {
    res.status(401).json({ error: "Not authenticated" });
    return undefined;
  }
  if (caller.role !== "manager") {
    res.status(403).json({ error: "Meeting scheduler is available to managers only" });
    return undefined;
  }
  return caller;
}

function approvedManagerAccounts() {
  return getApprovedAccountSummaries().filter((account) => account.role === "manager");
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function allAttendeesResponded(meeting: Meeting): boolean {
  return meeting.requiredAttendeeIds.every((id) => Boolean(meeting.responses[id]?.respondedAt));
}

function reminderPayload(meeting: Meeting) {
  return {
    title: "Meeting availability reminder",
    body: `Please submit your availability for ${meeting.title}.`,
    tag: `meeting-reminder-${meeting.id}`,
    url: "/roster/manager/meetings",
  };
}

// ── Reminder scan ────────────────────────────────────────────────────────────
// Exported for meeting-reminders.ts's timer wrapper — kept in this file since
// it operates directly on the same persistence helpers above. Durability
// rule (see .agents/memory/meeting-reminder-durability.md in the reference
// repo this was ported from): persist each attendee's next-due time BEFORE
// sending their push, so a restart mid-scan can never duplicate a reminder;
// a push that fails to send is retried at the next scheduled tick rather
// than immediately.
let reminderScanInFlight = false;
export async function scanMeetingReminders(): Promise<void> {
  if (reminderScanInFlight) return;
  reminderScanInFlight = true;
  try {
    const meetings = await loadMeetings();
    const now = new Date();
    const nowIso = now.toISOString();
    const due: Array<{ meeting: Meeting; attendeeId: string }> = [];

    for (const meeting of meetings) {
      if (meeting.status !== "collecting" && meeting.status !== "ready") continue;
      let meetingChanged = false;
      for (const attendeeId of meeting.attendeeIds) {
        if (meeting.responses[attendeeId]) continue;
        const state = meeting.reminderState[attendeeId];
        if (!state || new Date(state.nextReminderAt).getTime() > now.getTime()) continue;
        meeting.reminderState[attendeeId] = {
          lastSentAt: nowIso,
          nextReminderAt: new Date(now.getTime() + REMINDER_INTERVAL_MS).toISOString(),
        };
        meetingChanged = true;
        due.push({ meeting, attendeeId });
      }
      if (meetingChanged) {
        meeting.updatedAt = nowIso;
        await saveMeeting(meeting);
      }
    }

    if (!due.length) return;
    await Promise.allSettled(due.map(({ meeting, attendeeId }) => sendToAccount(attendeeId, reminderPayload(meeting))));
  } catch (err) {
    logger.error({ err }, "[meetings] reminder scan failed");
  } finally {
    reminderScanInFlight = false;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────
// Note: /meetings/accounts, /meetings/calendar-events, /meetings/profile-groups,
// /meetings/groups all have fixed, literal paths, so route-registration order
// relative to the /meetings/:id-style routes below doesn't matter the way it
// does in phRoster.ts/deployments.ts (no ":id" segment could ever capture a
// literal path Express already matched exactly).

meetingsRouter.get("/meetings/accounts", requireManager, (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  res.json({ accounts: approvedManagerAccounts() });
});

meetingsRouter.get("/meetings/calendar-events", requireManager, async (req, res) => {
  const caller = accountFromRequest(req);
  if (!caller || (caller.role !== "manager" && caller.role !== "admin")) {
    res.status(403).json({ error: "Manager access required" }); return;
  }
  const accountNames = new Map(
    approvedManagerAccounts().map((account) => [account.id, account.displayName ?? account.username]),
  );
  const events = await loadAllCalendarEvents();
  res.json({
    events: events.map((event) => ({
      ...event,
      ownerName: accountNames.get(event.ownerId) ?? "Manager",
      isOwn: event.ownerId === caller.id,
    })),
  });
});

meetingsRouter.post("/meetings/calendar-events", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const { type, startDate, endDate, note } = req.body as {
    type?: unknown; startDate?: unknown; endDate?: unknown; note?: unknown;
  };
  if (type !== "leave" && type !== "out-of-office") {
    res.status(400).json({ error: "Event type must be leave or out of office" }); return;
  }
  if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) {
    res.status(400).json({ error: "Enter a valid date range" }); return;
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if ((end.getTime() - start.getTime()) / 86_400_000 > 366) {
    res.status(400).json({ error: "Calendar events cannot exceed 366 days" }); return;
  }
  const now = new Date().toISOString();
  const event: ManagerCalendarEvent = {
    id: randomUUID(),
    ownerId: caller.id,
    type,
    startDate,
    endDate,
    note: typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(managerCalendarEventsTable).values({ ...event, note: event.note ?? null });
  res.status(201).json({ event: { ...event, ownerName: caller.officerName ?? caller.username, isOwn: true } });
});

meetingsRouter.delete("/meetings/calendar-events/:id", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [row] = await db.select().from(managerCalendarEventsTable).where(eq(managerCalendarEventsTable.id, id));
  if (!row) { res.status(404).json({ error: "Calendar event not found" }); return; }
  if (row.ownerId !== caller.id) {
    res.status(403).json({ error: "You can only remove your own calendar events" }); return;
  }
  await db.delete(managerCalendarEventsTable).where(eq(managerCalendarEventsTable.id, id));
  res.json({ success: true });
});

meetingsRouter.put("/meetings/profile-groups", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const { groups } = req.body as { groups?: unknown };
  if (!Array.isArray(groups) || groups.some((group) => typeof group !== "string") ||
      new Set(groups).size !== groups.length ||
      groups.some((group) => !MANAGER_GROUPS.includes(group as typeof MANAGER_GROUPS[number]))) {
    res.status(400).json({ error: "Groups must contain only supported manager groups" });
    return;
  }
  await setManagerMeetingGroups(caller.id, groups);
  res.json({ groups });
});

meetingsRouter.get("/meetings/groups", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  res.json({ groups: await loadMeetingGroups(caller.id) });
});

meetingsRouter.post("/meetings/groups", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const memberIds = Array.isArray(req.body?.memberIds) ? [...new Set(req.body.memberIds)] : [];
  const approvedIds = new Set(approvedManagerAccounts().map((account) => account.id));
  if (!name || name.length > 60) { res.status(400).json({ error: "A group name of up to 60 characters is required" }); return; }
  if (!memberIds.length || memberIds.some((id) => typeof id !== "string" || !approvedIds.has(id))) {
    res.status(400).json({ error: "Select at least one approved manager" }); return;
  }
  const existing = await loadMeetingGroups(caller.id);
  if (existing.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
    res.status(409).json({ error: "You already have a group with this name" }); return;
  }
  const now = new Date().toISOString();
  const group: MeetingGroup = { id: randomUUID(), name, ownerId: caller.id, memberIds: memberIds as string[], createdAt: now, updatedAt: now };
  await db.insert(meetingGroupsTable).values(group);
  res.status(201).json({ group });
});

meetingsRouter.patch("/meetings/groups/:id", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const existing = await loadMeetingGroups(caller.id);
  const group = existing.find((item) => item.id === id);
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const memberIds = Array.isArray(req.body?.memberIds) ? [...new Set(req.body.memberIds)] : [];
  const approvedIds = new Set(approvedManagerAccounts().map((account) => account.id));
  if (!name || name.length > 60) { res.status(400).json({ error: "A group name of up to 60 characters is required" }); return; }
  if (!memberIds.length || memberIds.some((id) => typeof id !== "string" || !approvedIds.has(id))) {
    res.status(400).json({ error: "Select at least one approved manager" }); return;
  }
  if (existing.some((item) => item.id !== group.id && item.name.toLowerCase() === name.toLowerCase())) {
    res.status(409).json({ error: "You already have a group with this name" }); return;
  }
  group.name = name;
  group.memberIds = memberIds as string[];
  group.updatedAt = new Date().toISOString();
  await db.update(meetingGroupsTable)
    .set({ name: group.name, memberIds: group.memberIds, updatedAt: group.updatedAt })
    .where(eq(meetingGroupsTable.id, group.id));
  res.json({ group });
});

meetingsRouter.delete("/meetings/groups/:id", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [row] = await db.select().from(meetingGroupsTable).where(eq(meetingGroupsTable.id, id));
  if (!row || row.ownerId !== caller.id) { res.status(404).json({ error: "Group not found" }); return; }
  await db.delete(meetingGroupsTable).where(eq(meetingGroupsTable.id, id));
  res.status(204).end();
});

meetingsRouter.get("/meetings", requireAdminOrManager, async (req, res) => {
  const caller = accountFromRequest(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }
  const accountById = new Map(approvedManagerAccounts().map((account) => [account.id, account]));
  const meetings = (await loadMeetings())
    .filter((meeting) => caller.role === "admin" || meeting.organizerId === caller.id || meeting.attendeeIds.includes(caller.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((meeting) => ({
      ...meeting,
      attendees: meeting.attendeeIds
        .map((id) => accountById.get(id))
        .filter((account) => account !== undefined),
      currentUserRole: caller.role === "admin" ? "admin" : meeting.organizerId === caller.id
        ? (meeting.attendeeIds.includes(caller.id) ? "both" : "organizer")
        : "attendee",
    }));
  res.json({ meetings });
});

meetingsRouter.post("/meetings", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const { title, location, proposedSlots, attendeeIds, requiredAttendeeIds, optionalAttendeeIds } = req.body as {
    title?: unknown;
    location?: unknown;
    proposedSlots?: Array<{ date?: unknown; period?: unknown }>;
    attendeeIds?: unknown;
    requiredAttendeeIds?: unknown;
    optionalAttendeeIds?: unknown;
  };
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle || trimmedTitle.length > 200) {
    res.status(400).json({ error: "A meeting title of up to 200 characters is required" }); return;
  }
  const trimmedLocation = typeof location === "string" ? location.trim() : "";
  if (!trimmedLocation || trimmedLocation.length > 200) {
    res.status(400).json({ error: "A meeting location of up to 200 characters is required" }); return;
  }
  if (!Array.isArray(proposedSlots) || proposedSlots.length < 2 ||
      proposedSlots.some((slot) => !isValidDate(slot.date) || (slot.period !== "AM" && slot.period !== "PM"))) {
    res.status(400).json({ error: "At least two valid AM or PM proposed slots are required" }); return;
  }
  const slotKeys = proposedSlots.map((slot) => `${slot.date}|${slot.period}`);
  if (new Set(slotKeys).size !== slotKeys.length || new Set(proposedSlots.map((slot) => slot.date)).size < 2) {
    res.status(400).json({ error: "Proposed slots must be unique and cover at least two calendar dates" }); return;
  }
  const requiredInput = Array.isArray(requiredAttendeeIds) ? requiredAttendeeIds : attendeeIds;
  const optionalInput = Array.isArray(optionalAttendeeIds) ? optionalAttendeeIds : [];
  if (!Array.isArray(requiredInput) || requiredInput.length === 0 ||
      requiredInput.some((id) => typeof id !== "string") ||
      !Array.isArray(optionalInput) || optionalInput.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "At least one required attendee is required" }); return;
  }
  const uniqueRequiredIds = [...new Set(requiredInput)] as string[];
  const uniqueOptionalIds = [...new Set(optionalInput)] as string[];
  const uniqueAttendeeIds = [...new Set([...uniqueRequiredIds, ...uniqueOptionalIds])];
  const approvedIds = new Set(approvedManagerAccounts().map((account) => account.id));
  if (uniqueRequiredIds.some((id) => uniqueOptionalIds.includes(id)) ||
      uniqueAttendeeIds.includes(caller.id) || uniqueAttendeeIds.some((id) => !approvedIds.has(id))) {
    res.status(400).json({ error: "Attendees must be distinct approved accounts other than the organizer" }); return;
  }
  const now = new Date().toISOString();
  const meeting: Meeting = {
    id: randomUUID(),
    title: trimmedTitle,
    location: trimmedLocation,
    organizerId: caller.id,
    organizerName: caller.officerName ?? caller.username,
    attendeeIds: uniqueAttendeeIds,
    requiredAttendeeIds: uniqueRequiredIds,
    optionalAttendeeIds: uniqueOptionalIds,
    proposedSlots: proposedSlots.map((slot) => ({ id: randomUUID(), date: slot.date as string, period: slot.period as Period })),
    responses: {},
    status: "collecting",
    confirmedSlotId: null,
    confirmedAt: null,
    readyNotifiedAt: null,
    createdAt: now,
    updatedAt: now,
    reminderState: Object.fromEntries(uniqueAttendeeIds.map((id) => [id, {
      lastSentAt: null,
      nextReminderAt: new Date(Date.now() + REMINDER_INTERVAL_MS).toISOString(),
    }])),
  };
  await saveMeeting(meeting);
  void Promise.allSettled(uniqueAttendeeIds.map((id) => sendToAccount(id, {
    title: "Meeting invitation",
    body: `${meeting.organizerName} invited you to ${meeting.title} at ${meeting.location}.`,
    tag: `meeting-invitation-${meeting.id}`,
    url: "/roster/manager/meetings",
  })));
  res.status(201).json({ meeting });
});

meetingsRouter.patch("/meetings/:id", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const meeting = await loadMeeting(req.params.id);
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (meeting.organizerId !== caller.id) {
    res.status(403).json({ error: "Only the organizer can edit this meeting" }); return;
  }

  const { title, location, proposedSlots, confirmedDate, confirmedPeriod } = req.body as {
    title?: unknown;
    location?: unknown;
    proposedSlots?: Array<{ date?: unknown; period?: unknown }>;
    confirmedDate?: unknown;
    confirmedPeriod?: unknown;
  };
  const nextTitle = title === undefined ? meeting.title : typeof title === "string" ? title.trim() : "";
  const nextLocation = location === undefined ? meeting.location : typeof location === "string" ? location.trim() : "";
  if (!nextTitle || nextTitle.length > 200) {
    res.status(400).json({ error: "A meeting title of up to 200 characters is required" }); return;
  }
  if (!nextLocation || nextLocation.length > 200) {
    res.status(400).json({ error: "A meeting location of up to 200 characters is required" }); return;
  }

  const titleChanged = nextTitle !== meeting.title;
  const locationChanged = nextLocation !== meeting.location;
  let scheduleChanged = false;
  meeting.title = nextTitle;
  meeting.location = nextLocation;

  if (meeting.status === "confirmed") {
    if (proposedSlots !== undefined) {
      res.status(400).json({ error: "Use confirmedDate and confirmedPeriod to reschedule a confirmed meeting" }); return;
    }
    if (confirmedDate !== undefined || confirmedPeriod !== undefined) {
      if (!isValidDate(confirmedDate) || (confirmedPeriod !== "AM" && confirmedPeriod !== "PM")) {
        res.status(400).json({ error: "A valid confirmed date and AM or PM period are required" }); return;
      }
      const confirmedSlot = meeting.proposedSlots.find((slot) => slot.id === meeting.confirmedSlotId);
      if (!confirmedSlot) {
        res.status(409).json({ error: "The confirmed meeting slot could not be found" }); return;
      }
      scheduleChanged = confirmedSlot.date !== confirmedDate || confirmedSlot.period !== confirmedPeriod;
      confirmedSlot.date = confirmedDate as string;
      confirmedSlot.period = confirmedPeriod as Period;
    }
  } else {
    if (confirmedDate !== undefined || confirmedPeriod !== undefined) {
      res.status(400).json({ error: "Confirmed meeting fields can only update a confirmed meeting" }); return;
    }
    if (proposedSlots !== undefined) {
      if (!Array.isArray(proposedSlots) || proposedSlots.length < 2 ||
          proposedSlots.some((slot) => !isValidDate(slot.date) || (slot.period !== "AM" && slot.period !== "PM"))) {
        res.status(400).json({ error: "At least two valid AM or PM proposed slots are required" }); return;
      }
      const slotKeys = proposedSlots.map((slot) => `${slot.date}|${slot.period}`);
      if (new Set(slotKeys).size !== slotKeys.length || new Set(proposedSlots.map((slot) => slot.date)).size < 2) {
        res.status(400).json({ error: "Proposed slots must be unique and cover at least two calendar dates" }); return;
      }
      const oldKeys = meeting.proposedSlots.map((slot) => `${slot.date}|${slot.period}`).sort();
      const newKeys = slotKeys.slice().sort();
      scheduleChanged = oldKeys.length !== newKeys.length || oldKeys.some((key, index) => key !== newKeys[index]);
      if (scheduleChanged) {
        meeting.proposedSlots = proposedSlots.map((slot) => ({
          id: randomUUID(),
          date: slot.date as string,
          period: slot.period as Period,
        }));
        meeting.responses = {};
        meeting.status = "collecting";
        meeting.confirmedSlotId = null;
        meeting.readyNotifiedAt = null;
        meeting.lastResponseProgress = undefined;
        meeting.reminderState = Object.fromEntries(meeting.attendeeIds.map((id) => [id, {
          lastSentAt: null,
          nextReminderAt: new Date(Date.now() + REMINDER_INTERVAL_MS).toISOString(),
        }]));
      }
    }
  }

  if (!titleChanged && !locationChanged && !scheduleChanged) {
    res.json({ meeting });
    return;
  }
  const now = new Date().toISOString();
  meeting.updatedAt = now;
  const changes = [
    scheduleChanged ? (meeting.status === "confirmed" ? "time changed" : "new time options need your response") : null,
    locationChanged ? `location changed to ${meeting.location}` : null,
    titleChanged ? `title changed to ${meeting.title}` : null,
  ].filter((item): item is string => Boolean(item));
  meeting.lastUpdateNotice = { summary: changes.join("; "), at: now };
  await saveMeeting(meeting);
  void Promise.allSettled(meeting.attendeeIds.map((id) => sendToAccount(id, {
    title: meeting.status === "confirmed" ? "Confirmed meeting updated" : "Meeting poll updated",
    body: `${meeting.title}: ${changes.join("; ")}.`,
    tag: `meeting-updated-${meeting.id}-${now}`,
    url: "/roster/manager/meetings",
  })));
  res.json({ meeting });
});

meetingsRouter.put("/meetings/:id/availability", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const { slotIds } = req.body as { slotIds?: unknown };
  if (!Array.isArray(slotIds) || slotIds.some((id) => typeof id !== "string") ||
      new Set(slotIds).size !== slotIds.length) {
    res.status(400).json({ error: "slotIds must be an array of unique slot IDs" }); return;
  }
  const meeting = await loadMeeting(req.params.id);
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (!meeting.attendeeIds.includes(caller.id)) {
    res.status(403).json({ error: "Only invited attendees can submit availability" }); return;
  }
  if (meeting.status === "confirmed") {
    res.status(400).json({ error: "Availability cannot be changed after confirmation" }); return;
  }
  const allowedSlots = new Set(meeting.proposedSlots.map((slot) => slot.id));
  if (slotIds.some((id) => !allowedSlots.has(id))) {
    res.status(400).json({ error: "Availability includes a slot outside this meeting" }); return;
  }
  const now = new Date().toISOString();
  const wasFirstResponse = !meeting.responses[caller.id];
  let becameReady = false;
  meeting.responses[caller.id] = { slotIds: slotIds as string[], respondedAt: now };
  delete meeting.reminderState[caller.id];
  meeting.updatedAt = now;
  if (allAttendeesResponded(meeting)) {
    meeting.status = "ready";
    if (!meeting.readyNotifiedAt) {
      meeting.readyNotifiedAt = now;
      becameReady = true;
    }
  }
  const respondedCount = meeting.attendeeIds.filter((id) => Boolean(meeting.responses[id])).length;
  const remainingCount = meeting.attendeeIds.length - respondedCount;
  const responderName = caller.officerName ?? caller.username;
  meeting.lastResponseProgress = { responderName, respondedCount, remainingCount, at: now };
  await saveMeeting(meeting);
  if (becameReady) {
    void sendToAccount(meeting.organizerId, {
      title: "Meeting ready to confirm",
      body: `All required attendees responded to ${meeting.title}.`,
      tag: `meeting-ready-${meeting.id}`,
      url: "/roster/manager/meetings",
    });
  }
  void sendToAccount(meeting.organizerId, {
    title: remainingCount === 0 ? "Everyone responded" : "Meeting response received",
    body: remainingCount === 0
      ? `${responderName} responded to ${meeting.title}. Everyone has now responded.`
      : `${responderName} ${wasFirstResponse ? "responded" : "updated their response"} to ${meeting.title}. ${respondedCount} responded, ${remainingCount} left.`,
    tag: `meeting-progress-${meeting.id}-${caller.id}-${now}`,
    url: "/roster/manager/meetings",
  });
  res.json({ meeting });
});

meetingsRouter.put("/meetings/:id/confirm", requireManager, async (req, res) => {
  const caller = managerFromRequest(req, res);
  if (!caller) return;
  const { slotId } = req.body as { slotId?: unknown };
  if (typeof slotId !== "string") { res.status(400).json({ error: "slotId is required" }); return; }
  const meeting = await loadMeeting(req.params.id);
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (meeting.organizerId !== caller.id) {
    res.status(403).json({ error: "Only the organizer can confirm this meeting" }); return;
  }
  if (meeting.status !== "ready" || !allAttendeesResponded(meeting)) {
    res.status(400).json({ error: "All attendee responses are required before confirmation" }); return;
  }
  if (!meeting.proposedSlots.some((slot) => slot.id === slotId)) {
    res.status(400).json({ error: "Confirmed slot must be one of this meeting's proposed slots" }); return;
  }
  const now = new Date().toISOString();
  meeting.status = "confirmed";
  meeting.confirmedSlotId = slotId;
  meeting.confirmedAt = now;
  meeting.updatedAt = now;
  await saveMeeting(meeting);
  const confirmedSlot = meeting.proposedSlots.find((slot) => slot.id === slotId)!;
  void Promise.allSettled(meeting.attendeeIds.map((id) => sendToAccount(id, {
    title: "Meeting confirmed",
    body: `${meeting.title} is confirmed for ${confirmedSlot.date} ${confirmedSlot.period}.`,
    tag: `meeting-confirmed-${meeting.id}`,
    url: "/roster/manager/meetings",
  })));
  res.json({ meeting });
});

meetingsRouter.delete("/meetings/:id", requireAdminOrManager, async (req, res) => {
  const caller = accountFromRequest(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }
  const meeting = await loadMeeting(req.params.id);
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (caller.role !== "admin" && meeting.organizerId !== caller.id) {
    res.status(403).json({ error: "Only the organizer or an admin can delete this meeting" }); return;
  }
  await deleteMeetingRow(meeting.id);
  res.status(204).end();
});
