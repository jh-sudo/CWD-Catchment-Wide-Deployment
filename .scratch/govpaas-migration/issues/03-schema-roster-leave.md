Type: grilling
Status: resolved

## Question

Design the relational Postgres schema for the roster & leave domain — currently `roster-officers.json`, `roster-config.json`, `roster-swaps.json`, `roster-overrides.json`, `roster-leaves.json`, `roster-day-overrides.json`, `roster-cycle.json`, and `leave-requests.json` in `cloudPersistence.ts`.

Read the current shape of each file and the relevant route handlers (`artifacts/api-server/src/routes/rosterPlan.ts`, `leaveRequests.ts`) to understand relationships between officers, roster cycles, swaps, overrides, and leave requests, then work through with the user: what normalized tables and foreign keys replace this set of files. This is likely the most relationally complex domain (officers ↔ roster entries ↔ swaps ↔ leaves ↔ overrides) — pay particular attention to how swaps and overrides reference specific roster entries/dates without duplicating state.

## Answer

### Findings that shaped the design

- This is the only domain with real production data today: `roster-officers.json` (34 real officers) and `roster-cycle.json` (350KB, "Excel-sourced" 140-day duty grid) contain actual staff first names, vehicle plate numbers, and catchment assignments. `roster-swaps.json`, `roster-overrides.json`, `roster-leaves.json`, and `leave-requests.json` are currently all empty (`[]`).
- **Duty resolution has 4 layers of precedence** (corrected — see Amendment below), in `rosterPlan.ts`: (1) an explicit `DutyOverride` for that officer+date, else (2) a committed `LeaveEntry` for that officer+date, else (3) a lookup into the Excel-sourced cycle grid **by unit code + date** (`getDutyFromCycle`), else (4) an algorithmically generated duty from hardcoded weekly rotation templates (`CYCLE_20/24/28_WEEK1`) based on `teamSlot` + `cycleStartDate` + `teamCount`.
- **Decision: keep this as application logic**, not materialized in the DB. The DB stores the source tables (officers, config, cycle grid, overrides); the app reads from Postgres instead of JSON files but the resolution algorithm itself doesn't move into the database.
- **Decision: `resolveOfficerDuty`/`buildSummary`'s "today's summary" path is a bug** — it skips step (2), the Excel-cycle lookup, that every other duty-resolution call site checks. Flagged for a fix bundled into the migration (use the same 3-tier resolution everywhere), not preserved as-is.
- **Decision: the cycle grid is keyed by `unit_code`, not `officer_id`** — `getDutyFromCycle(unitCode, dateStr)` confirms two officers sharing a unit (crew positions 1 & 2) work the same duty together; one row per unit per date, not per officer per date.
- **Decision: `DEFAULT_OFFICERS`** (44 officers hardcoded in `rosterPlan.ts`, including "TBC"/"Crew N" placeholders for unrecruited teams 21–28) **gets deleted** once the officers table is seeded — DB becomes the sole source of truth, no code-level fallback.
- **Decision: real officer names/PII are fine to migrate as-is** — the GitHub repo and GOV PaaS deployment will be private.
- Swap/leave records keep their **name-snapshot fields** (`requesterName`, `officerName`, etc.) alongside the FK to `officers` — deliberate denormalization for point-in-time audit history (a name change later shouldn't rewrite historical records), not something to normalize away.

### Proposed tables

**`officers`** — replaces `roster-officers.json`
- `id TEXT PRIMARY KEY` (preserve existing ids like `bu1a` — already meaningful, everything else references them)
- `name TEXT NOT NULL`, `unit_code TEXT NOT NULL`, `vehicle TEXT NOT NULL DEFAULT ''`, `catchment TEXT NOT NULL DEFAULT ''`
- `team_slot INT NOT NULL`, `crew_position SMALLINT NOT NULL CHECK (crew_position IN (1,2))`

**`roster_config`** — replaces `roster-config.json`, singleton row
- `team_count SMALLINT NOT NULL CHECK (team_count IN (20,24,28))`
- `cycle_start_date DATE NOT NULL`

**`roster_maintenance_vehicles`** — replaces `roster-config.json`'s `maintenanceVehicles[]`
- `vehicle TEXT PRIMARY KEY`

**`roster_cycle_meta`** — replaces `roster-cycle.json`'s top-level fields, singleton row
- `cycle_start_date DATE NOT NULL`, `cycle_length_days INT NOT NULL`, `excel_start_date DATE NOT NULL`

**`roster_cycle_duties`** — replaces `roster-cycle.json`'s `officers[].duties[]`
- `unit_code TEXT NOT NULL`, `date DATE NOT NULL`, `target_duty TEXT NOT NULL`, `actual_duty TEXT NOT NULL`
- `PRIMARY KEY (unit_code, date)`

**`roster_overrides`** — replaces `roster-overrides.json` (`DutyOverride`)
- `PRIMARY KEY (officer_id, date)` (matches how the code looks these up — no separate id in the source shape)
- `officer_id TEXT NOT NULL REFERENCES officers(id)`, `date DATE NOT NULL`, `duty TEXT NOT NULL`
- `covered_by_officer_name TEXT`, `target_duty TEXT`, `cross_posted_to_unit TEXT`, `vehicle TEXT`, `overtime_hours TEXT`, `swapped_with_officer_name TEXT`
- `made_by TEXT`, `made_by_name TEXT`, `made_at TIMESTAMPTZ`
- `cover_for_officer_id TEXT REFERENCES officers(id)` (the `_coverFor` auto-cover linkage)

**`roster_swaps`** — replaces `roster-swaps.json` (`RosterSwap`)
- `id TEXT PRIMARY KEY`
- `requester_id TEXT NOT NULL REFERENCES officers(id)`, `requester_name TEXT NOT NULL` (snapshot)
- `target_id TEXT NOT NULL REFERENCES officers(id)`, `target_name TEXT NOT NULL` (snapshot)
- `date DATE NOT NULL`, `requester_duty TEXT NOT NULL`, `target_duty TEXT NOT NULL`, `reason TEXT`
- `status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED'))`
- `reviewer_name TEXT`, `created_at TIMESTAMPTZ NOT NULL`, `reviewed_at TIMESTAMPTZ`

**`leave_types`** — new; not a file today, extracted from `ABSENT_DUTY_SET` in `rosterPlan.ts`
- `code TEXT PRIMARY KEY` (VL, SL, MC, CCL, FCL, PL, SPL, UL, ML, BL, C, CSL, SLWOMC, AMC, AMMA, AMTO, PMTO, C/PMTO, NS, PPTW, TO, OVL, HL, OIL, OIL(AM), OIL(PM), EL, CPL, MA, UNPAID L), `description TEXT`
- Lookup table rather than a free-text column or Postgres enum — enums are painful to extend later, this list will grow

**`roster_leaves`** — replaces `roster-leaves.json` (`LeaveEntry`)
- `id TEXT PRIMARY KEY`
- `officer_id TEXT NOT NULL REFERENCES officers(id)`, `officer_name TEXT NOT NULL` (snapshot)
- `date DATE NOT NULL`, `leave_type TEXT NOT NULL REFERENCES leave_types(code)`, `source TEXT`
- `covering_officer_id TEXT REFERENCES officers(id)`, `covering_officer_name TEXT`

**`leave_requests`** — replaces `leave-requests.json` (`LeaveRequest`), the full workflow entity
- `id TEXT PRIMARY KEY`
- `officer_id TEXT NOT NULL REFERENCES officers(id)`, `officer_name TEXT NOT NULL`, `officer_catchment TEXT NOT NULL` (snapshot)
- `date DATE NOT NULL`, `leave_type TEXT NOT NULL REFERENCES leave_types(code)`, `reason TEXT`
- `cover_officer_id TEXT REFERENCES officers(id)`, `cover_officer_name TEXT`, `cover_status TEXT CHECK (cover_status IN ('PENDING','ACCEPTED','DECLINED'))`, `cover_responded_at TIMESTAMPTZ`, `cover_decline_reason TEXT`
- `ic_account_id TEXT REFERENCES managers(id)`, `ic_name TEXT`, `ic_status TEXT CHECK (ic_status IN ('PENDING','APPROVED','REJECTED'))`, `ic_reviewed_at TIMESTAMPTZ`, `ic_note TEXT`
- `status TEXT NOT NULL CHECK (status IN ('PENDING_COVER','PENDING_IC','APPROVED','REJECTED','CANCELLED'))`
- `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`, `last_edited_by TEXT`, `last_edited_on TIMESTAMPTZ`
- `committed_leave_id TEXT REFERENCES roster_leaves(id)`

**`roster_day_overrides`** + **`roster_day_override_applications`** — replaces `roster-day-overrides.json` (`DayOverrideEvent`); needs a child table since `applied[]` is one-to-many
- `roster_day_overrides`: `id TEXT PRIMARY KEY`, `date DATE NOT NULL`, `text TEXT NOT NULL`, `submitted_by TEXT NOT NULL`, `submitted_at TIMESTAMPTZ NOT NULL`
- `roster_day_override_applications`: `day_override_id TEXT NOT NULL REFERENCES roster_day_overrides(id)`, `officer_id TEXT NOT NULL REFERENCES officers(id)`, `officer_name TEXT NOT NULL` (snapshot), `duty TEXT NOT NULL`

`managers(id)` referenced by `leave_requests.ic_account_id` belongs to the [core ops state schema](02-schema-core-ops-state.md) ticket, not this one — cross-domain FK to confirm there.

This feeds directly into [data backfill & cutover](11-data-backfill-cutover.md) — in particular, migrating `roster-cycle.json` requires matching each entry's `unit`+`name` to an `officers.id` (the cycle file has no officer id today), and the `DEFAULT_OFFICERS` deletion should happen only after the officers table is confirmed seeded correctly.

### Amendment (found during repo hygiene, `.agents/memory/`)

Replit's own AI agent left behind persistent memory notes on this exact codebase (`.agents/memory/*.md`, found while working the [repo hygiene](06-repo-hygiene-replit-surface.md) ticket) that corrected and extended this ticket's original findings:

- **Duty resolution is actually 4-tier, not 3-tier**: `roster-cycle-subcatchment.md` documents it as **Override > Committed leave (`roster-leaves.json`) > Cycle > Generator fallback** — a committed leave entry takes precedence over the cycle grid, sitting between override and cycle. The original resolution here only traced `resolveOfficerDuty`/`getDutyFromCycle`/`getDutyForSlotInWeek` and missed that leave entries are folded in as their own precedence step elsewhere (`buildSummary`'s absence handling). No schema change needed — `roster_leaves` already models this — but the *application logic* rebuilding duty resolution on Postgres must implement all 4 tiers, not the 3 originally documented here.
- **Write-time invariant, not just a read-time resolution rule** (`leave-override-interaction.md`): when `POST /leave` creates a leave entry, it must first clear any existing **UploadBrief-managed** override for that officer+date (an override *without* a `_coverFor` field) — otherwise the override silently masks the leave in duty resolution, since override outranks leave. Covering overrides (*with* `_coverFor`, created by the leave-application flow itself) must NOT be cleared. The `roster_overrides` schema already distinguishes these via the nullable `cover_for_officer_id` column, so this is purely an application-logic invariant to preserve in the reimplementation, not a schema gap.
- Other memory files documented UI-level rules (covering-officer deduplication display logic, one-directional coverage fields needing reverse lookups) — relevant to whoever reimplements the frontend/API logic, not to the schema itself, so not reproduced here in full; see `.agents/memory/deduplication-covering-officers.md` and `roster-covering-swap-fields.md` before they're ported into this repo's `CONTEXT.md`/`docs/adr/` per the repo hygiene ticket's decision.
