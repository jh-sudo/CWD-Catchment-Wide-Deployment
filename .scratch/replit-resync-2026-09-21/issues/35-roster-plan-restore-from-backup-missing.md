Type: gap
Status: done

> *Found during the post-completion audit of the whole resync effort. Ticket 19's own text already
> acknowledged this gap but never scoped a fix for it — logging it now as its own tracked item.*

## What's wrong

[Ticket 19](19-applications-manage-unsafe-wipe-button.md) removed the unsafe "wipe all roster
data" button from the admin UI, correctly citing that it had no confirmation step and no recovery
path. Its own writeup noted that Replit's version didn't just remove the button — it replaced the
whole workflow with a "Restore from Backup" flow (list prior roster-plan snapshots, pick one,
restore it). Only the removal half was ported; the replacement was never built.

Confirmed against Replit's current source (`rosterPlan.ts:2843` and `:2879`): it exposes
`GET /roster-plan/history/backups` (list available backups with metadata) and
`POST /roster-plan/history/restore` (restore a chosen one). Neither route exists in this repo's
`rosterPlan.ts` (target lines checked around 1795-1805, where the old wipe-all route used to be —
now just a comment referencing this exact gap, no working replacement).

## Impact

There is currently no way for an admin to recover from a bad roster-plan state short of a direct
database intervention. The dangerous button is gone (good), but so is the entire recovery path it
was — badly — standing in for. This is a real capability gap, not a cosmetic one, though it's
lower urgency than [ticket 34](34-crew-schedule-grid-duty-inversion-not-fixed.md) since it only
matters when something has already gone wrong with a roster plan.

## Fix — done, with real design decisions made along the way

This needed real design work, not a mechanical port — reference's version is entirely GCS-backed
(`uploadToCloudPath`/`downloadFromCloudPath`/`listCloudFiles` against `backups/<ts>/*.json`), which
has no Postgres equivalent to copy.

**What counts as a "backup"**: a new `roster_plan_backups` table (`lib/db/src/schema/rosterPlanBackups.ts`),
one row per snapshot, with the four datasets (`roster_leaves`, `roster_overrides`, `roster_swaps`,
`leave_requests`) each stored as their own jsonb column — matching this schema's established
"read/written as one unit stays one jsonb column" convention (`roster_patterns.data` etc.), since a
snapshot is always read or restored as a whole, never queried at the row level.

**Trigger — the one real deviation from reference's design, and the reason this needed a decision
rather than a literal port**: reference only ever creates a backup as an automatic side effect of
its `history/clear` route, right before a `mode=all` full wipe. This repo's `history/clear` no
longer has a `mode=all` — ticket 19 removed that capability entirely rather than hardening it, on
the user's own explicit instruction at the time ("remove it entirely"). So there is no more
destructive event to hook an automatic snapshot into. Resolved this by making backup creation
**manual and on-demand** (a "Create backup now" button, admin/manager-gated) instead of automatic
— an admin can snapshot before doing something risky (a bulk import, a manual DB-adjacent change),
which is a strictly more general tool than reference's narrower "always snapshot right before the
one dangerous action" behavior, and doesn't require re-introducing any destructive action to hook
into.

**Retention**: none implemented — every backup persists until manually superseded. Deliberately
left unbounded rather than guessing at a policy; flagged here as a real follow-up once real usage
patterns are known (reference itself has no retention/pruning either, for what it's worth).

**Access level**: admin or manager (matches `history/clear`'s own existing check and reference's
`history/backups`/`history/restore` checks, both `admin`+`manager` — not admin-only).

**Backend** (`rosterPlan.ts`): `POST /roster-plan/history/backups` (create — snapshots
`loadAllLeaves()`/`loadAllOverrides()`/`loadSwaps()`/a plain `leaveRequestsTable` select),
`GET /roster-plan/history/backups` (list, metadata only — id/createdAt/createdBy/leaveCount/swapCount),
`POST /roster-plan/history/restore` (body `{ id }` — full transaction: delete then bulk-reinsert
all four tables from the chosen snapshot's jsonb payloads, children-before-parents on delete and
parents-before-children on insert since `leave_requests.committed_leave_id` references
`roster_leaves.id`). One real gotcha found while implementing: `timestamp` columns round-trip
through jsonb as plain ISO strings (JSON has no Date type), but drizzle's default timestamp mode
expects a JS `Date` object on insert and calls `.toISOString()` on whatever it's given — handing it
a string back would throw at insert time. Added a small `reviveDate()` helper applied to every
timestamp field (`appliedAt`, `madeAt`, `createdAt`/`reviewedAt`, `coverRespondedAt`/`icReviewedAt`/
`createdAt`/`updatedAt`/`lastEditedOn` across the four tables) before re-inserting.

**Frontend** (`ApplicationsManage.tsx`): a standalone "Backups" button next to "Clear Log" (not
nested inside the Clear Log confirm dialog the way reference nests it — reference's placement made
sense there because backups and the wipe were the same action's two halves; here they're
unrelated, since Clear Log now only clears the harmless application-log table, not committed
roster data) opening its own dialog: create-backup button, a list of existing snapshots
(timestamp, leave/swap counts, who created it), select one and restore.

Typechecked (`typecheck:libs` + `api-server` + `roster-dashboard`) and production-built clean
(`node ./build.mjs`, `vite build`).
