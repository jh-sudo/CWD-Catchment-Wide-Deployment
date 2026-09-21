Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 8). Flagged at scoping time as the riskiest
> item on the approved list — turned out much smaller than feared once actually read.*

## What this is

Originally scoped as "a new auth role distinct from manager/admin" — genuinely concerning, since
`AccountRole` is used by dozens of role checks across every file touched in Phase 1. On reading
Replit's actual code, it's **not** a new role at all: `requireRosterEditor` is just a new
middleware function (same shape as `requireManager`/`requireAdmin`/`requireAdminOrManager`) that
allows the three existing non-crew roles (admin, manager, ic) but rejects crew — a tighter gate,
not a new identity. No `AccountRole` union change, no cross-cutting risk.

## What changed

- `auth.ts`: added `requireRosterEditor` (+ `requireRosterEditorSession`), mirroring
  `requireManager`'s exact shape including the rate-limited `X-Manager-Pin` bypass (the shared PIN
  is itself a manager-tier credential, so it's inherently "not crew" already).
- Switched exactly the three endpoints Replit gates with it, all in `rosterPlan.ts`:
  `PUT /roster-plan/config`, `POST /roster-plan/leave`, `DELETE /roster-plan/leave/:id` — from
  `requireManager` (which, per ticket 01's finding, actually allows *any* approved role including
  crew) to `requireRosterEditor`.
- Deliberately did **not** touch `GET /roster-plan/leave` (ticket 01's fix) — that read endpoint
  is legitimately used by "all roles" pages (`TodaysRoster.tsx`, `RosterCycle.tsx`,
  `VehicleArrangement.tsx`) for shared roster display; crew needs read access there. Only the
  three write/config endpoints needed tightening, matching Replit exactly.

## Verified safe

Checked before applying: none of the three endpoints have any frontend caller anywhere in this
repo (`roster-dashboard` only calls the sibling `GET`, untouched; `manager.ts` doesn't call any
of the three at all). This tightening has zero regression risk — nothing currently relies on
crew being able to reach them, and now nothing can.
