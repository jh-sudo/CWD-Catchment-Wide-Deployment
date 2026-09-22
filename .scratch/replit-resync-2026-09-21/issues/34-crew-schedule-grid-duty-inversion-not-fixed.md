Type: bug
Status: done

> *Found during the post-completion audit of the whole resync effort (user asked to confirm all
> functions of `/manager`, `/lightning`, `/roster`, `/crew` were ported). Corrects an incomplete
> fix claimed done by [ticket 14](14-crew-schedule-duty-display-and-partner-bugs.md) — not a new
> Replit-side change, a gap in this repo's own port.*

## What's wrong

Ticket 14 claimed to fix the "actual duty should take priority over scheduled duty, falling back
to scheduled only when there's no override" bug in both `CrewSchedule.tsx` and `MySchedule.tsx`.
That fix only landed in the **day-detail panel** of each page:
- `CrewSchedule.tsx:464` — `selActual ?? selTarget` (fixed)
- `MySchedule.tsx:366` — `selDuty ?? selTarget` (fixed, with a `.scratch/.../issues/14` comment)

The **calendar month-grid cells** — the primary view both pages actually show — still have the
original, inverted logic:
- `CrewSchedule.tsx:352` — `const primaryDuty = targetDuty ?? actualDuty;` (scheduled-first, the
  original bug)
- `MySchedule.tsx:264` — `const primaryDuty = targetDuty ?? actualDuty;` (same)

Confirmed against Replit's current source: its equivalent grid cells (`CrewSchedule.tsx:465`,
`MySchedule.tsx:391`) both read `actualDuty ?? targetDuty` (actual-first, correct) and
additionally compute a `primaryIsLeave` flag to color the badge red when the actual duty is a
leave code — neither the corrected precedence nor the leave-coloring made it into this repo's
grid cells.

## Impact

An officer with an approved leave/MC override still sees their normal scheduled shift (e.g. "ND")
prominently on the calendar grid in both `/crew-schedule` and `/schedule` (My Schedule) — the
grid, at a glance, looks like they're rostered to work. The detail panel (opened by tapping a day)
does show the correct leave status, so the information isn't lost, but the primary at-a-glance
view is wrong. This is live in the app today, not a Replit-side regression.

## Fix — done

Mirrored the detail-panel fix into the grid cells in both files: `primaryDuty` now reads
`actualDuty ?? targetDuty` in both `CrewSchedule.tsx` and `MySchedule.tsx`'s calendar grid, with
the scheduled duty demoted to the secondary badge (shown only when it differs from actual). Added
the `primaryIsLeave` flag (`leaveType != null || LEAVE_DUTIES.has(primaryDuty)`) so the primary
badge itself renders in `LEAVE_COLOR` when the effective duty is a leave/MC/override day, matching
reference's grid cells exactly (verified line-for-line against
`CWD-replit-mirror-2026-09-21/.../CrewSchedule.tsx:460-474` and `MySchedule.tsx:391-398`).
Deliberately did not port reference's `NoteIndicator` addition to the day-number label — out of
this ticket's scope (a separate comments-on-calendar-cell feature, not part of the duty-priority
bug). Typechecked (`typecheck:libs` + both `api-server`/`roster-dashboard`) and production-built
clean (`node ./build.mjs`, `vite build`).
