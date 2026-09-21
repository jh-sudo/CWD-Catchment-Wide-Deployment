Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 10). Automation on top of ticket 03's
> validation-only fix — same files.*

## What this is

If an officer who is themselves currently designated to cover someone else's leave applies for
leave on that same date, they'd otherwise leave the person they were covering uncovered again.
This automatically requires and wires in a replacement, rather than silently dropping the
original cover assignment.

## What changed

- `lib/db/src/schema/leaveRequests.ts`: added `replacementForOfficerId` (references
  `officers.id`) — when set, this leave request was a chain-of-cover handoff, and the field
  points at the ORIGINAL absent officer being covered (not this request's own officer).
  Migration statement added to `startupMigration.ts`.
- `leaveRequests.ts`'s `POST /leave-requests`:
  - Looks up `activeCoveredLeave` — a `rosterLeavesTable` row for this date where this applying
    officer is the current `coveringOfficerId` for someone else.
  - Cover is now required whenever `activeCoveredLeave` exists, not just when the applying
    officer's own scheduled duty is DAY/PD — with a specific error message naming who they're
    covering.
  - When a replacement cover officer is provided and this is a chain: the NEW leave record's own
    `coveringOfficerId`/`coveringOfficerName` stay null (nothing to cover on THIS record), and
    instead the ORIGINAL leave record (`activeCoveredLeave`) is updated to hand the covering
    assignment to the new cover officer. `replacementForOfficerId` is set on the new leave
    request to the original absent officer's id.
  - Override handling: clears any override currently covering either this officer's own post or
    (when chained) the original covered position, then writes the replacement's cover override
    targeting the **original covered position's** required duty (not the applying officer's own
    duty) with `coverForOfficerId` pointed at the original absent officer — so the display
    correctly shows the new cover officer at the original unit, not the applying officer's.
- `DELETE /leave-requests/:id`: when cancelling a request with `replacementForOfficerId` set,
  hands the covering assignment back to the officer whose leave is being cancelled (they resume
  covering), removes the replacement's now-stale cover override, and recreates the resumed
  coverer's override for the original covered position if their current duty isn't OFF/REST —
  full round-trip undo.

## Known gap, not fixed here

`SwapLeaveApply.tsx`'s frontend doesn't proactively check whether the applying officer is
currently covering someone else — it only prompts for a cover officer when the applicant's own
scheduled duty is DAY/PD (ticket 03's check). An officer in the chain-of-cover situation with an
OFF/REST duty of their own would submit without being prompted for a cover, then get rejected by
the backend. This degrades gracefully, not silently: the frontend already surfaces the backend's
exact error message (`You are covering X; choose a replacement cover officer`) rather than a
generic failure, so the user still gets correct guidance — just one submit-and-retry instead of
being prompted proactively. Left as-is given this is a comparatively rare double-duty edge case;
worth a proactive frontend check in a future pass if it comes up often in practice.
