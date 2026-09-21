Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 13) — user said "port everything" for the
> remaining list after Partner Reports (deferred) and AI Flood Scan (declined) were resolved.*

## What this is

`POST /deployments/optimize-assign`'s `"nearest-selected"` mode (the no-rain, manager-hand-picked
Tier-1-locations flow) previously only matched *unassigned* vehicles to locations. Replit's
version also lets it reassign an already-deployed team to a closer selected location — useful
when a manager re-triages after already dispatching some crews.

## What changed

1. **Eligibility filter**: `nearest-selected` mode now only excludes vehicles that have a
   *pending* assignment (`assignments.has(vehicleId)`), not ones with a live, accepted deployment
   entry. Rain mode's eligibility (`occupiedVehicleIds`-based) is unchanged.
2. **`assignTeam`**: when reassigning (mode is `nearest-selected` and the vehicle already has a
   `deploymentEntries` entry), now records a `ReassignmentRecord` (reused this repo's own existing
   reassignment-history pattern, already used by the manual `/deployments/assign` route — same
   fields, same `persist()` call to `deploymentReassignmentHistoryTable`), clears the old entry via
   the existing `removeVehicleEntries()`, and sets `previousLocationId`/`previousLocationName` on
   the new assignment (a field the `Assignment` interface already had, just never populated here).
3. **Push notification**: now says "Reassigned to X — your previous location has been freed"
   instead of "Optimized Assignment" when `previousLocationId` is set, matching the wording the
   manual assign route already uses.

Confirmed via direct comparison that this repo already had all the supporting
infrastructure (`reassignmentHistory`, `ReassignmentRecord`, `previousLocationId`/
`previousLocationName` fields, `removeVehicleEntries()`) from its own independent port of the
manual reassign flow — this change just wires `optimize-assign` into that same, already-existing
pattern rather than building anything new.
