Type: cleanup
Status: done

> *Found during the same two-axis code review as [ticket 37](37-admin-password-still-hardcoded.md).
> In [ticket 33](33-meetings-scheduler.md)'s commit (`e8e42d2`).*

## What's wrong

"Does this meeting need this user's action" was independently re-derived three times:

- `Layout.tsx`'s `meetingShortcut` `useMemo` — `pendingAction` filter
- `Layout.tsx`'s alert-building `useEffect` — two of its four notice branches
- `ManagerDashboard.tsx`'s `pendingConfirmation` `useMemo`

Each site phrased the same two underlying conditions slightly differently (e.g.
`status !== "confirmed"` vs. an explicit `status === "collecting"`), which reads as risk of drift.
Checked whether the difference is actually live: `MeetingStatus` is a closed
`"collecting" | "ready" | "confirmed"` union, and the backend only ever transitions a meeting to
`"ready"` once every attendee has responded
(`meetings.ts`'s `allAttendeesResponded` check before `meeting.status = "ready"`). So
"attendee hasn't responded" and `status === "ready"` can never both be true — the two phrasings
were already equivalent in practice, just duplicated rather than actually inconsistent.

## Fix — done

Added `attendeeNeedsToRespond(meeting, userId)` and `organizerNeedsToConfirm(meeting, userId)` to
`useMeetings.ts`, and switched all three call sites to use them instead of re-deriving the
conditions inline.
