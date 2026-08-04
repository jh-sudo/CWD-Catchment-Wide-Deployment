# CONTEXT

Domain glossary and business rules for the CWD (Catchment-Wide Deployment) fleet/roster/inspection tracking system — an internal, government-adjacent flood-ops tool for coordinating vehicle deployments, crew rosters, and field inspections across catchments.

This file exists to carry forward domain knowledge that used to live only in Replit's own AI agent memory (`.agents/memory/`), ported here per the repo hygiene decision in `.scratch/govpaas-migration/issues/06-repo-hygiene-replit-surface.md` so it's discoverable by any future agent or human working in this repo, not tied to a platform being left behind.

## Glossary

- **Officer** — a crew member, identified by `officers.id` (e.g. `bu1a`). Has a `name`, `unitCode`, `vehicle`, `catchment`, `teamSlot`, `crewPosition` (1 or 2 — each unit has exactly two officers), and `active` (soft-delete flag, default `true`).
- **Unit** (`unitCode`, e.g. `BU1`, `WK2`, `CP4`) — a vehicle/crew pairing. Both officers on a unit normally share the same scheduled duty.
- **Catchment** — the geographic area a unit is responsible for. Prefix → name: `BU`→Bukit Timah & Urban, `PJ`→Jurong & Pandan, `WK`→Kranji & Woodlands, `CP`→Changi & Punggol, `KG`→Kallang & Geylang.
- **Duty code** — `PD`, `DAY`, `ND`, `OFF`, `REST` (shift/rest codes), or a leave-type code (`VL`, `SL`, `MC`, `OIL`, `OVL`, …; see `leave_types` table for the full list).
- **Cycle** — the repeating multi-week duty rotation. Officers have a `teamSlot` that determines their position in a weekly rotation template (`CYCLE_20/24/28_WEEK1` in `rosterPlan.ts`), or an Excel-sourced day-by-day grid (`roster_cycle_duties`, keyed by unit + date) that takes precedence when present.
- **Override** — a manual duty correction for a specific officer+date (`roster_overrides`, PK `(officer_id, date)`).
- **Committed leave** — an approved leave entry (`roster_leaves`, unique per `(officer_id, date)`).
- **Covering officer** — an officer who takes over an absent officer's unit duty for a date. Recorded via `roster_overrides.cover_for_officer_id` (auto-generated cover override) and/or `roster_leaves.covering_officer_id`/`covering_officer_name`.
- **Swap** — two officers trade duties for a date (`roster_swaps`).
- **PH** — Public Holiday. **OIL** — Off In Lieu (granted when a PH falls on a Sunday; the following Monday becomes a fixed OIL day).

## Duty resolution — 4-tier precedence

For a given officer + date, the effective duty resolves in this order:

1. **Override** (`roster_overrides` row for that officer+date)
2. **Committed leave** (`roster_leaves` row for that officer+date)
3. **Cycle** — Excel-sourced grid (`roster_cycle_duties`, looked up by `unit_code` + date) if present, else the generated weekly-rotation formula (`teamSlot` + `cycleStartDate` + `teamCount`)
4. **Generator fallback** (the weekly-rotation formula, when no cycle grid entry exists for that unit/date)

This is a 4-tier model, not 3-tier — a committed leave entry sits between override and cycle. It's easy to under-count this as "override > cycle > generator" if you only trace `resolveOfficerDuty`/`getDutyFromCycle`/`getDutyForSlotInWeek`, missing that leave entries are folded in as their own precedence step in `buildSummary`'s absence handling (`rosterPlan.ts`).

## Write-time invariant: leave application must clear stale overrides

When a leave entry is created for officer+date, any existing override for that same officer+date must be cleared **before** the leave is written — otherwise the override outranks the leave in the precedence order above and the leave is silently masked (the officer still shows their old override duty, not the leave). This is enforced in the leave-application code paths (`leaveRequests.ts`, `rosterPlan.ts`'s `/roster-plan/leave`), not the schema — `roster_overrides` has no trigger preventing this, so any new code path that writes a leave entry must replicate the clear-then-write ordering.

Covering overrides (rows with `cover_for_officer_id` set — auto-generated so the covering officer shows the absent officer's scheduled duty instead of their own) are a *different* kind of override and should generally be regenerated, not just blanket-preserved, when the leave/cover assignment changes.

## Subcatchment reassignment is leave-independent

`PUT /roster-plan/officers/:id` lets a manager change an officer's `unitCode`/`catchment` (reassign them to a different subcatchment). `roster_leaves` and `leave_requests` are keyed by `officer_id`, never by `unitCode` — a reassignment needs no leave migration, and existing leave entries keep resolving correctly (their duty-type display doesn't depend on which subcatchment's cycle the officer is currently reading from). Any new code path touching officer reassignment must preserve this: never rekey or filter leave records by `unitCode`.

## Covering-officer / swap display rules

- **Deduplication**: only *auto-redirected* officers are hidden from their home unit's slot. Swapped, cross-posted, or covering-another-officer officers **keep** their home-unit entry (shown as a strikethrough name + bracket), with the replacement rendered inline beside them. This lets managers see the original two-officer structure at a glance rather than having names silently disappear from a unit.
- **One-directional fields, watch for it**: coverage/swap relationship fields on the schedule API have historically been written onto only one side of the relationship (e.g. `coveredByOfficerName` on the *absent* officer, not mirrored onto the *covering* officer). Any UI or report that renders a per-officer grid needs to check both directions — don't assume a field's absence on one officer's row means "no relationship," it may just mean the API only populated the other officer's row.

## PH (Public Holiday) rotation engine

Full implementation lives in `phRoster.ts`'s `autoAllocate()`. Key rules:

- Units are selected from a fixed 24-unit rotation sequence in strict order — no unit is ever skipped at the unit level for racial/religious reasons. Racial exclusion (CNY: Officer-04/Officer-25/Officer-09 excluded; Deepavali: Officer-10 excluded) is applied at the **officer level** inside the selected unit — the unit still appears in the roster with its remaining eligible officer(s).
- Officer filtering inside a PH slot, in order: (1) hard racial exclusions, always; (2) Rule B — exclude officers who worked the *same PH name* last year, with equalization-aware restoration if that would push someone too far behind; (3) Rule A — exclude officers who worked the *immediately preceding* PH, same restoration logic; (4) pool-local equalization — keep only officers at/near the minimum PH count in the eligible set. All soft criteria (2–4) fall back to "keep everyone" if they'd otherwise leave zero eligible officers.
- Hari Raya has its own layout: 4 rotation units → 3 PD + 1 DAY slots via the normal filtering, plus two fixed DAY pairs (Officer-10+Officer-04, Officer-25+Officer-09) that bypass all criteria.
- **Regenerate years in chronological order.** Rule B reads the *prior* year's `ph_roster_ref` data — regenerating out of order (or against a year generated by an older/buggy engine) propagates wrong exclusions forward. Some units structurally appear more often than others in a given year's rotation (e.g. 4× vs 3×) — this is an unavoidable property of the rotation sequence, not a bug.

## Officer deletion is soft-delete

`DELETE /roster-plan/officers/:id` never issues a hard SQL delete — it sets `officers.active = false`. `officers.id` is a NOT NULL RESTRICT-FK target from 8 other tables (managers, leaveRequests, rosterLeaves, rosterSwaps, rosterOverrides, rosterDayOverrides, pushSubscriptions, phRosterOverrides), so a real hard delete would either be blocked by that history or destroy it — neither acceptable for a compliance-adjacent system with real staff records. Deactivated officers:

- Are excluded from future roster/duty generation, PH-rotation eligibility, and assignment/reassignment pickers (`officersInRotation`-style filters in `rosterPlan.ts` and `phRoster.ts`, `.filter(o => o.active)` in the roster-dashboard frontend).
- Keep all past leave/override/swap/duty history intact and fully resolvable — nothing reads `active` when looking up *historical* records by id or name (e.g. PH rotation's Rule A/B lookback reads `ph_roster_ref`, which is name-keyed with no FK to `officers`, so it's unaffected either way).
- Remain visible (and reactivatable via the same `PUT` endpoint, `{ active: true }`) on the Officers admin page — the only place in the UI that shows inactive officers by design.

There is currently no way to truly hard-delete an officer via the API — a stray duplicate/typo entry with zero history just becomes permanently inactive rather than removable. Deciding whether officer deletion should ever cascade or reassign related records instead of blocking/deactivating is still an open question (see `.scratch/postgres-migration-fixes/issues/05-officer-delete-fk-restrict.md`).

## Persistence

This app originally persisted everything as flat JSON files (`artifacts/api-server/data/*.json`), synced to Replit Object Storage. It has since been migrated to a proper relational Postgres schema (`lib/db/src/schema/`) as part of the GOV PaaS migration — see `.scratch/govpaas-migration/map.md` for the full decision record and `.scratch/govpaas-migration/issues/` for the per-domain schema tickets. All rules above are described in terms of the current Postgres tables, not the legacy JSON files.
