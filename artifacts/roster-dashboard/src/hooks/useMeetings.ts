import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Plain fetch() rather than the generated OpenAPI client — same escape
// hatch usePushSubscription.ts already uses in this repo, and reference's
// own precedent for this exact feature (its useMeetings.ts never touches
// the generated client either). Avoids hand-patching ~15 endpoint shapes
// into api.schemas.ts for a codegen toolchain that's currently broken
// anyway (see ticket 30's notes). .scratch/replit-resync-2026-09-21/issues/33.

export interface Account {
  id: string;
  displayName: string | null;
  username: string;
  role: string;
  meetingGroups: string[];
}

export interface ProposedSlot {
  id: string;
  date: string;
  period: "AM" | "PM";
}

export interface MeetingResponse {
  slotIds: string[];
  respondedAt: string;
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
  attendees?: Account[];
  proposedSlots: ProposedSlot[];
  responses: Record<string, MeetingResponse>;
  status: "collecting" | "ready" | "confirmed";
  confirmedSlotId: string | null;
  confirmedAt?: string | null;
  readyNotifiedAt: string | null;
  reminderState: Record<string, { nextReminderAt: string; lastSentAt: string | null }>;
  lastResponseProgress?: {
    responderName: string;
    respondedCount: number;
    remainingCount: number;
    at: string;
  };
  lastUpdateNotice?: {
    summary: string;
    at: string;
  };
  createdAt: string;
  updatedAt: string;
  currentUserRole: "organizer" | "attendee" | "both" | "admin";
}

// Shared by Layout.tsx's sidebar shortcut, its alert popup, and
// ManagerDashboard.tsx's pending list — all three need to agree on exactly
// what "this meeting needs the current user's action" means, so it's
// centralized here instead of re-derived per call site.
export function attendeeNeedsToRespond(meeting: Meeting, userId: string): boolean {
  return meeting.attendeeIds.includes(userId) && !meeting.responses[userId] && meeting.status !== "confirmed";
}

export function organizerNeedsToConfirm(meeting: Meeting, userId: string): boolean {
  return meeting.organizerId === userId && meeting.status === "ready";
}

export interface MeetingGroup {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ManagerCalendarEvent {
  id: string;
  ownerId: string;
  ownerName: string;
  type: "leave" | "out-of-office";
  startDate: string;
  endDate: string;
  note?: string;
  isOwn: boolean;
}

const fetchAccounts = async (): Promise<Account[]> => {
  const res = await fetch("/api/meetings/accounts", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch accounts");
  const data = await res.json();
  return data.accounts;
};

const fetchMeetings = async (): Promise<Meeting[]> => {
  const res = await fetch("/api/meetings", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch meetings");
  const data = await res.json();
  return data.meetings;
};

const fetchCalendarEvents = async (): Promise<ManagerCalendarEvent[]> => {
  const res = await fetch("/api/meetings/calendar-events", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch manager calendar");
  return (await res.json()).events;
};

async function apiError(res: Response, fallback: string): Promise<Error> {
  try {
    const data = await res.json();
    return new Error(typeof data.error === "string" ? data.error : fallback);
  } catch {
    return new Error(fallback);
  }
}

const createMeeting = async (payload: {
  title: string;
  location: string;
  proposedSlots: Omit<ProposedSlot, "id">[];
  requiredAttendeeIds: string[];
  optionalAttendeeIds: string[];
}): Promise<Meeting> => {
  const res = await fetch("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await apiError(res, "Failed to create meeting");
  const data = await res.json();
  return data.meeting;
};

export interface UpdateMeetingPayload {
  id: string;
  title?: string;
  location?: string;
  proposedSlots?: Omit<ProposedSlot, "id">[];
  confirmedDate?: string;
  confirmedPeriod?: "AM" | "PM";
}

const updateMeeting = async ({ id, ...payload }: UpdateMeetingPayload): Promise<Meeting> => {
  const res = await fetch(`/api/meetings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await apiError(res, "Failed to update meeting");
  return (await res.json()).meeting;
};

const fetchMeetingGroups = async (): Promise<MeetingGroup[]> => {
  const res = await fetch("/api/meetings/groups", { credentials: "include" });
  if (!res.ok) throw await apiError(res, "Failed to fetch meeting groups");
  return (await res.json()).groups;
};

const saveMeetingGroup = async (payload: { id?: string; name: string; memberIds: string[] }): Promise<MeetingGroup> => {
  const res = await fetch(payload.id ? `/api/meetings/groups/${payload.id}` : "/api/meetings/groups", {
    method: payload.id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: payload.name, memberIds: payload.memberIds }),
  });
  if (!res.ok) throw await apiError(res, "Failed to save meeting group");
  return (await res.json()).group;
};

const deleteMeetingGroup = async (id: string): Promise<void> => {
  const res = await fetch(`/api/meetings/groups/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw await apiError(res, "Failed to delete meeting group");
};

const deleteMeeting = async (id: string): Promise<void> => {
  const res = await fetch(`/api/meetings/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw await apiError(res, "Failed to delete meeting");
};

const submitAvailability = async ({ id, slotIds }: { id: string; slotIds: string[] }): Promise<Meeting> => {
  const res = await fetch(`/api/meetings/${id}/availability`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ slotIds }),
  });
  if (!res.ok) throw await apiError(res, "Failed to submit availability");
  const data = await res.json();
  return data.meeting;
};

const confirmMeeting = async ({ id, slotId }: { id: string; slotId: string }): Promise<Meeting> => {
  const res = await fetch(`/api/meetings/${id}/confirm`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ slotId }),
  });
  if (!res.ok) throw await apiError(res, "Failed to confirm meeting");
  const data = await res.json();
  return data.meeting;
};

export function useMeetingAccounts() {
  return useQuery({
    queryKey: ["meetings", "accounts"],
    queryFn: fetchAccounts,
    staleTime: 5 * 60 * 1000,
  });
}

export function useManagerCalendarEvents() {
  return useQuery({
    queryKey: ["meetings", "calendar-events"],
    queryFn: fetchCalendarEvents,
    staleTime: 30_000,
  });
}

export function useCreateManagerCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { type: "leave" | "out-of-office"; startDate: string; endDate: string; note?: string }) => {
      const res = await fetch("/api/meetings/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await apiError(res, "Failed to add calendar event");
      return (await res.json()).event as ManagerCalendarEvent;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meetings", "calendar-events"] }),
  });
}

export function useDeleteManagerCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/meetings/calendar-events/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw await apiError(res, "Failed to remove calendar event");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meetings", "calendar-events"] }),
  });
}

export function useMeetingGroups(enabled = true) {
  return useQuery({
    queryKey: ["meetings", "groups"],
    queryFn: fetchMeetingGroups,
    enabled,
  });
}

export function useMeetings(enabled = true) {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: fetchMeetings,
    refetchInterval: 15000,
    enabled,
  });
}

const updateMeetingGroups = async (groups: string[]): Promise<string[]> => {
  const res = await fetch("/api/meetings/profile-groups", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ groups }),
  });
  if (!res.ok) throw await apiError(res, "Failed to update groups");
  const data = await res.json();
  return data.groups;
};

export function useUpdateMeetingGroups() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMeetingGroups,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings", "accounts"] });
    },
  });
}

export function useCreateMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMeeting,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useUpdateMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMeeting,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function useSaveMeetingGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveMeetingGroup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meetings", "groups"] }),
  });
}

export function useDeleteMeetingGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMeetingGroup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meetings", "groups"] }),
  });
}

export function useDeleteMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMeeting,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function useSubmitAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitAvailability,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useConfirmMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmMeeting,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}
