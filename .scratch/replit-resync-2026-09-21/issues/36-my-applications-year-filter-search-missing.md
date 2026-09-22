Type: gap
Status: done

> *Found during the post-completion audit of the whole resync effort. Pure miss — no prior ticket
> in this tracker references `MyApplications.tsx` at all.*

## What's wrong

Replit's `MyApplications.tsx` has a year filter (dropdown, defaults to current year) and a text
search box over an officer's own leave/duty applications list. This repo's `MyApplications.tsx`
has neither — it renders the full unfiltered list with no way to narrow it down.

## Impact

Cosmetic/quality-of-life only — the page still works, it just has no filtering once an officer has
accumulated enough application history to make scrolling annoying. Lowest priority of the three
findings in this batch; unlike [ticket 34](34-crew-schedule-grid-duty-inversion-not-fixed.md) it's
not a live correctness bug, and unlike [ticket 35](35-roster-plan-restore-from-backup-missing.md)
it doesn't block recovery from anything.

## Fix — done

Added the year-selector pills (previous/current/next year, defaulting to current) and a search
box above the list, filtering `myLeaves`/`mySwaps` client-side before the existing sort — no
backend changes, as expected. Deliberately used this repo's own field names throughout
(`coverOfficerName`, `icName`, endpoint `/api/leave-requests`) rather than reference's, which have
diverged (reference uses `coveringOfficerName`/`appliedBy`/`appliedAt` and a different endpoint,
`/api/roster-plan/leave` — this repo's own naming, confirmed against `leaveRequests.ts`'s actual
response shape, already matches what `ticket 04` established). Kept the existing card rendering
(cover/IC/last-edited fields, badge styling) unchanged — reference's card layout has diverged
further (clickable card navigating to the calendar, different "Edited by" fields) but that's a
separate redesign, not part of what this ticket scoped ("year filter and search box"). Empty-state
message now distinguishes "no records match your search" from "no records for {year}".
Typechecked clean, production-built clean.
