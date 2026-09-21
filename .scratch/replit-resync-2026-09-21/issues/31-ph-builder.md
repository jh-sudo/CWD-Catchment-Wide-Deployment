Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 5). One design decision in this ticket
> (unit-pattern deduplication) was raised to the user directly rather than resolved unilaterally
> — see "User decision" below.*

## What this is

A configurable/preset-driven layer on top of the existing PH-roster auto-generation engine
(`autoAllocate`, already present and hardened by ticket 07's guardrails): a reorderable rotation
pattern (drag-and-drop), two rule toggles (prevent-consecutive-PH, prevent-same-holiday-as-
previous-year), a staff exclusion list, named/reusable presets, and a narrower "apply exception
changes only" mode that swaps just the excluded/un-excluded officers' assignments without
rebuilding the whole year. Lives in a new "PH Builder" tab (admin/manager/ic only) alongside the
existing manual PH roster editor — it writes to the exact same `ph_roster_ref` data the manual
editor already reads/writes; there's no separate draft state.

## User decision: unit-pattern deduplication

Our existing `PH_ROTATION_SEQUENCE` intentionally repeats CP4/KG4/BU4/PJ4 twice in its 24-slot
cycle "per spec" (per the code's own comment), giving those 4 units roughly double the PH-duty
frequency of the others. Making the pattern user-reorderable only works cleanly if each unit
appears exactly once — reference's own `normalizePHBuilderConfig` explicitly validates this,
rejecting any pattern with duplicates. Adopting PH Builder as designed therefore removes that
double-weighting. **Asked the user directly rather than deciding unilaterally, since this changes
real PH-duty fairness for specific units** — confirmed: adopt Builder's model (each active unit
exactly once). `defaultPHBuilderConfig()`'s `pattern` is `[...new Set(PH_ROTATION_SEQUENCE)]` — a
deduplicated 20-unit list — rather than the original 24-slot sequence.

## What changed

**Backend (`phRoster.ts`)**:
- New `PHBuilderConfig`/`PHBuilderPreset` types, `defaultPHBuilderConfig()`,
  `loadPHBuilderConfig()`/`savePHBuilderConfig()` (self-healing: reconciles the saved pattern
  against currently-active units on every read, so a roster change doesn't silently break the
  "each active unit exactly once" invariant), `normalizePHBuilderConfig()` (validates on write).
- `GET`/`PUT /ph-roster-ref/builder-config`, `GET`/`POST /ph-roster-ref/builder-presets`,
  `PATCH`/`DELETE /ph-roster-ref/builder-presets/:id` — registered before the existing
  `/ph-roster-ref/:date` wildcard route (Express would otherwise capture "builder-config" as a
  date param).
- **`autoAllocate()` made config-driven** (surgical, not a rewrite): new `builderConfig` parameter;
  `allOfficers` now excludes `builderConfig.excludedOfficers`; `getUnits()` reads
  `builderConfig.pattern` instead of the hardcoded `PH_ROTATION_SEQUENCE`; `failsRuleA`/`failsRuleB`
  and the rebalance-swap loop's Rule-A check are now gated on `builderConfig.consecutivePH`/
  `.sameHolidayPreviousYear`. `POST /ph-roster-ref/auto-allocate` (existing route, now also what
  "Run New Pattern" calls) loads the config and passes it through.
- Also updated `POST /ph-roster-ref/realign-subcatchments` (an existing repair tool that re-derives
  sub-catchment labels from the rotation) to read the same config-driven pattern — left on the
  hardcoded sequence, it would have silently disagreed with what `autoAllocate` now produces
  whenever a custom pattern is active. Found while tracing the blast radius of the pattern change,
  not part of the original scoping.
- New `POST /ph-roster-ref/builder-run` ("Apply Exception Changes") — a separate, narrower
  algorithm that does **not** call `autoAllocate`: only replaces rows belonging to a
  newly-excluded officer (picking the lowest-PH-count eligible replacement) and symmetrically
  restores newly-un-excluded officers (pulling duties from the currently highest-count eligible
  officers), leaving every other assignment untouched. Saves only the dates that actually changed.

**New Postgres tables**: `ph_builder_config` (singleton, pattern/toggles/exclusions/startYear) and
`ph_builder_presets` (id/name/config jsonb/updatedAt) — both purely additive, no existing table
touched.

**Frontend**: ported `PHBuilder.tsx` (810 lines — pattern drag-and-drop via pointer events, rules,
staff-exception multi-select, preset load/save/rename/delete, run buttons, a results table) and
wired it into `PHHoliday.tsx` as a new tab gated the same way as the existing edit permission
(`admin`/`manager`/`ic`). Two new shadcn/ui primitives ported for this: `checkbox.tsx`
(`@radix-ui/react-checkbox`) and `command.tsx` (`cmdk`, for the searchable staff picker) — both
new dependencies, same low-risk category as ticket 30's `react-day-picker` addition.

## Deliberately not ported

**Reference's `autoAllocate` also absorbed a structural rewrite of how the rotation index is
computed** — from this repo's existing incremental cursor (`rotIdx = (rotIdx + 6) % length`,
persisted per-year in `ph_rotation_state`) to a stateless "compute from this date's absolute
position in the full year's PH calendar" model (`PH_YEAR_SLOTS`-based), plus moved the
invariant-checking (`assertNoHRCrossHolidayDoubleDuty`/`assertBalancedPHCounts`) inside
`autoAllocate` itself rather than the caller. The comment motivating it: this matters when a
pattern change triggers regenerating only *some* future dates, so a date's rotation position
doesn't depend on a mutable cursor that a partial regeneration could leave inconsistent. **Checked
first**: this repo's own `POST /ph-roster-ref/auto-allocate` always regenerates the *entire*
target year in one call — never a partial date range — so the specific problem this rewrite solves
doesn't arise here. Kept the existing incremental-cursor design (already correct for whole-year
generation) and the existing caller-side invariant-checking (ticket 07's established pattern, kept
consistent) instead of importing a structural rewrite whose only payoff is an edge case this repo's
call site doesn't exercise.

**Also dropped**: `pick()`'s T4 "no constraints, absolute last resort" fallback tier, which
reference removed ("Rule A is never relaxed" — a deliberate hardening choice on their side). Kept
ours: it's a safety net against a pathological case (aggressive exclusions leaving too few
Rule-A-eligible candidates) that fails soft (an unfilled slot gets a fallback, no throw) rather
than the algorithm silently under-filling a PH day. More conservative than reference, not required
by the config-driven port, and reduces regression risk to an already-hardened function.

## Worth knowing

- Replit's own default `excludedOfficers` seeded one specific person's name
  (`["Salim Y"]`) — not meaningful outside their environment. This repo's default is `[]`.
- A one-time rotation-continuity wrinkle: switching the pattern length from 24 (with duplicates) to
  20 (deduplicated) changes the modulo base the persisted `ph_rotation_state` cursor wraps against.
  The algorithm still produces a valid, safe result either way (JS modulo handles any raw index),
  but the *exact* rotation position at the transition year may shift slightly rather than
  perfectly continuing where the old 24-slot cycle left off. A one-time, low-stakes side effect of
  adopting the new pattern model, not a correctness bug.
- `builder-run`'s validation loop (`assertNoHRCrossHolidayDoubleDuty`/`assertBalancedPHCounts` per
  year in range) reuses this repo's existing two-arg (`generated`, `slots`) signatures rather than
  reference's year-number-based ones, by deriving `PH_YEAR_SLOTS[year]` per iteration — consistent
  with the "keep autoAllocate's existing architecture" choice above.
