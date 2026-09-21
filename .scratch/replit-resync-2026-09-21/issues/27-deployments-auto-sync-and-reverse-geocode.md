Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 12).*

## What this is

Two independent pieces bundled under one map.md item: (1) auto-pull today's roster from
`rosterPlan`'s own summary into the live deployment roster, instead of requiring a manual
paste-import every day; (2) a reverse-geocoding endpoint for map-pin-drop flows.

## What changed

**`/search/sg/reverse`** — this repo already had `/search/sg` (forward search, OneMap). Added
the reverse-geocode sibling (Nominatim-backed, same as the internal `geocodeRoadName` helper
`deployments.ts` already used elsewhere, just exposed as its own endpoint) — ported verbatim,
byte-for-byte match with Replit's version.

**`syncDeploymentRosterFromCentralSource()`** — auto-syncs `currentRoster` from
`rosterPlan.ts`'s FIRB summary text on every `GET /deployments/state` and `GET /roster` call, only
actually mutating state when the central roster differs from what's currently loaded (normalized
comparison), so this doesn't generate unnecessary Postgres writes on every poll.
- Factored `getRosterSummary(dateStr)` out of `rosterPlan.ts`'s `GET /roster-plan/summary` route
  into an exported function (same pattern as ticket 05's `resolveOfficerVehicleMap`) so
  `deployments.ts` can call it directly. New one-directional import edge
  (`deployments.ts` → `rosterPlan.ts`) — no cycle, unlike the `vehicleArrangement.ts` one from
  ticket 05.
- The per-unit lines in the FIRB summary text (`"BU1 TST0004A: Name & Name (DAY)"`) double as both
  the human-readable report and a machine-reparseable roster-import source — `parseRoster()`
  (ticket 15) already expects exactly this format, so `syncDeploymentRosterFromCentralSource`
  just feeds the summary text straight through it.
- Reused this repo's own existing `reconcileDeploymentStateWithRoster(previous, next)` (ticket 15)
  rather than porting Replit's differently-designed same-named function — see note below.

## A naming coincidence worth flagging

Replit's `deployments.ts` has its **own** `reconcileDeploymentStateWithRoster()`, but with a
different (no-argument) design: it unconditionally rebuilds every deployment entry/assignment/
vehicle-position from the current roster on every call, rather than diffing old-vs-new like this
repo's ticket-15 version. I didn't know this function existed when I wrote ticket 15 (the name
came from that ticket's own original triage notes, which described the *behavior* Replit had, not
the exact code) — turns out I'd already independently built something with the same name and a
similar goal, just a different (diff-based, narrower-write) implementation.

Deliberately did **not** replace the working ticket-15 version with Replit's rebuild-everything
one: Replit's approach makes sense for its cheap in-memory JSON arrays, but doing a full
clear-and-reinsert of every entry/assignment/vehicle-position on every roster-differs event would
generate meaningfully more Postgres writes than necessary for a DB-backed system. The diff-based
version achieves the same goal (keep deployment state's vehicleId in sync with roster changes)
with fewer writes. Flagging this only so it isn't rediscovered as a surprise later — this was a
deliberate choice, not an oversight.

## Worth knowing

`syncDeploymentRosterFromCentralSource` now runs `getRosterSummary()` (several DB reads: config,
officers, overrides, leaves, the vehicle-arrangement map) on every `GET /deployments/state`/
`GET /roster` call, even when nothing has changed — the "only mutate if different" guard avoids
extra *writes*, not the reads needed to compute the comparison in the first place. This matches
Replit's own design (it also runs on every read there), and these are live-map endpoints likely
polled frequently by multiple clients — worth keeping an eye on in practice if it ever becomes a
real load concern, but not something this port should second-guess without evidence it's actually
a problem.
