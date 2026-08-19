# 03 — Verify existing /manager dashboard + staleness indicator

Status: in-progress
Depends on: 01, 02

Originally scoped as four separate tickets (map view, locations+roster, alert
broadcast, CRMS) under the assumption that none of `manager.tsx`'s (native,
never-deployed) functionality had a web equivalent. **That assumption was
wrong** — `/manager` (`artifacts/api-server/src/routes/manager.ts`) already
implements essentially all of it, live, already deployed on GOV PaaS,
confirmed by the user directly against the real instance:

- Live map — Google Maps, vehicle markers (car icons, unit-coloured,
  arrived/en-route state), driving-direction routes, hover tooltips
- Add/Edit location modal, roster table, shift selector
- Assign Crew modal — "Live GPS vehicles" / "Roster teams" split, same shape
  the native app had
- Alert broadcast + acknowledgment rendering
- Full CRMS case management — list, map pins, detail modal, pin-mode, edit,
  clear-with-undo
- WLS panel (already known, see the old 07 ticket, now folded in here)

Confirmed safe: `/manager`'s JS never calls the deployment endpoints ticket 02
put behind `requireCrew` (accept/position/arrive/weather/swap-*,
alert/acknowledge) — so ticket 02 didn't break anything here.

## Actual remaining scope (much smaller than originally planned)

1. **Staleness indicator** — the one genuinely new piece. Crew positions are
   now intermittent by design (see spec.md), not continuous, so the live map
   needs to show *how stale* a dot is (e.g. "12 min ago", greying out past a
   threshold) rather than implying a constant live feed.
2. **Verify** the existing map/assignment UI still behaves sensibly against
   intermittent updates rather than the continuous stream it was likely built
   assuming.

## Progress

Both done, locally verified:
- Added a shared `STALE_THRESHOLD_MIN = 30` constant. Vehicle map markers now
  grey out (`buildCarIcon`) and their hover tooltip shows "Updated N min ago"
  in red past the threshold (`buildVehicleTooltip`). Same staleness label
  added to the sidebar vehicle list (`renderVehicles`), and its empty-state
  copy changed from "No vehicles online" to "No positions reported yet" —
  the old wording implied a live connection that no longer exists by design.
- Confirmed no other assumption of continuous updates in the map/assignment
  code — it already just renders whatever `/api/deployments/state` returns
  on each poll, so intermittent data flows through it fine as-is.
- Typechecked, built, and the four embedded `<script>` blocks on `/manager`
  parsed with no syntax errors after the edit (this file has no build step,
  so this was the only way to catch a template-string typo).

Not yet deployed — same as tickets 01/02, verified against local Postgres/MinIO
only so far.
