Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 6).*

## What this is

Replaces the hardcoded, aggregate-only minimum-manning model (a single number: 24 weekday / 12
weekend-or-PH, 2-tier red/green coloring) with a config-driven one: per-shift (PD/DAY/ND) minimum
bands for weekday vs. weekend-or-PH, 3-tier (below/minimum/full) coloring with configurable
colors, and named date exceptions (e.g. "Major event coverage" on specific dates) — all editable
by an admin/manager/ic through a new Strength tab, applied consistently across the roster,
vehicle, and deployment views.

## What changed

**Backend (`rosterPlan.ts`)** — added `StrengthBand`/`StrengthSpecialRule`/`StrengthConfigShape`
+ `normalizeStrengthBand`/`normalizeStrengthConfig`/`validateStrengthConfig`, and a `strength`
field on `RosterConfigShape`, persisted as a new nullable `jsonb` column on `roster_config`
(migration in `startupMigration.ts`). `GET /roster-plan/config` now always returns a fully
normalized `strength` object (self-heals defaults on read, no migration/backfill script needed).
`PUT /roster-plan/config` validates an incoming `strength` when present and rejects it with a
specific 400 reason on failure, rather than silently coercing it — a config a manager can't see is
worse than one that's rejected with an explanation.

**Frontend** — new `lib/strength.ts` (band/tier/color logic + `computeRosterStrength()`), new
`lib/phStrength.ts` (PH-specific strength — PH days compare actual-vs-scheduled from the PH
reference roster, not the config bands, so this stayed a separate function rather than folding
into the config-driven one), and a new `StrengthTab.tsx` settings panel (weekday/weekend default
shift-minimum editors, named-exception add/remove with a multi-date calendar picker, and the 3
tier colors) wired into `RosterBuilder.tsx` as a third "Strength" tab alongside Build/Requirements.
`TodaysRoster.tsx`, `RosterCycle.tsx`, and `VehicleArrangement.tsx` all switched their strength
strips from the old hardcoded 2-tier logic to `computeRosterStrength`/`getPHStrength` +
`getStrengthRule`/`getStrengthTier`/`getStrengthColor`, so the strip's background color, the
`Strength: X / full` and `minimum Y` figures, the named-exception badge, and each ND/DAY/PD pill's
`/target` denominator all now come from one shared, configurable source instead of three
independent hardcoded copies.

**New dependency**: `react-day-picker@^9.11.1` (roster-dashboard only), plus the shadcn/ui
`Calendar` component it needs — required for `StrengthTab.tsx`'s multi-date exception picker.
Ported verbatim from the reference's own `components/ui/calendar.tsx`; depends only on `cn` and
`Button`/`buttonVariants`, both already present. Flagging since it's new supply-chain surface, not
because of any specific concern — it's a well-established, actively maintained library already
used the same way in the reference codebase.

## Deliberate simplification: no "derive shift minimums from cycle pattern" auto-sync

Reference's `normalizeStrengthConfig` also auto-recomputes the default `shiftMinimums` from the
roster cycle pattern's own worst-case per-day PD/DAY/ND counts whenever `cycleStartDate` changes
(`deriveShiftMinimumsFromCycle`, walking Replit's flat `roster-cycle.json`). This repo has a
genuine Postgres equivalent to port from (`roster_cycle_meta`/`roster_cycle_duties`,
`ensureCycleCacheLoaded()`/`getDutyFromCycle()` in this same file) — but doing so faithfully would
mean summing per-*officer* shift counts from data that's stored per-*unit*-per-*date*, needing a
crew-size lookup per unit that added real complexity for a narrow payoff: reference's own
`validateStrengthConfig` pins the *overall* weekday (24/27) and weekend/PH (12/12) minimum/full
numbers as invariants regardless of this auto-sync, and `StrengthTab.tsx`'s UI never lets an admin
edit the overall numbers either — only the PD/DAY/ND breakdown and named-exception dates. So the
auto-sync only ever affects the *default* shiftMinimums' starting values, which `StrengthTab.tsx`'s
manual editor already covers going forward. Skipped the auto-sync; seeded the same static
fallbacks reference uses (PD:4/DAY:8/ND:1 weekday, PD:3/DAY:3/ND:0 weekend) instead. If the
default 20-team pattern is ever replaced with something structurally different, an admin retuning
these by hand via the Strength tab is the fallback — flagging this as the one piece of the
reference feature not fully ported, not as an oversight.

## Also fixed in passing

`lib/strength.ts`'s `defaultStrengthConfig()` took four parameters (`teamCount`, `weekendPD`,
`weekendDAY`, `weekdayFull`) in the reference source that the function body silently ignored,
always returning the same static object regardless of what was passed — every one of reference's
own call sites passed real values into this dead parameter list. Ported as a genuinely no-arg
function instead, and updated every call site to match, rather than reproducing the same
misleading signature.

## Worth knowing

- `RosterListView.tsx` has its own, older, un-migrated 2-tier strength bar — deliberately **not**
  touched. Every current caller (`TodaysRoster.tsx`, `RosterCycle.tsx`) already passes
  `hideStrengthBar`, so this code path is unreachable in practice on both this repo and the
  reference it was ported from; reference's own strength overhaul left it alone for the same
  reason. Not a gap, just confirmed-dead code in both codebases.
- `VehicleArrangement.tsx` previously scoped its strength headcount to `allSubcatchments` (in
  practice: every officer with a non-empty `unitCode`, since this page's catchment groups already
  span the whole roster, not one catchment). Switching to `computeRosterStrength()` additionally
  excludes officers whose `unitCode` starts with "TBC" — a placeholder-unit exclusion already
  applied elsewhere in this codebase (ticket 20's `OverrideEditor` strength counts) but missing
  here; this is a real small fix riding along with the port, not a behavior regression.
- Discovered while regenerating the OpenAPI client: `pnpm run codegen` (in `lib/api-spec`) is
  currently broken for unrelated reasons — the installed `orval`/`zod` versions have drifted from
  what the generated output expects (`z.int()` doesn't exist on the installed zod, plus an
  unrelated `Headers.entries()` DOM-lib mismatch), and running it regenerates every file with a
  different formatting style besides. Worked around by hand-adding just the new `StrengthBand`/
  `StrengthSpecialRule`/`StrengthConfig`/`RosterConfig.strength`/`RosterConfigInput.strength`
  types to `api.schemas.ts` directly (matching what a working codegen run would have produced) and
  leaving `api.ts`/`lib/api-zod` untouched, since neither actually needs the new fields. The
  codegen toolchain itself needs a real fix (upgrading zod, or pinning orval to a version that
  targets the installed zod) — flagging as a pre-existing gap for the next time someone needs to
  add a field the hand-patch approach won't cover.
- Also discovered mid-ticket: `node_modules` had drifted from the versions `package.json`/the
  pnpm catalog actually declare — `typescript` was resolving to a stale `5.9.3` instead of the
  declared `~7.0.2`, and `vite` to a stale `7.3.6` instead of the catalog's `^8.3.0`, the latter
  missing its `@rolldown/binding-win32-x64-msvc` native binary entirely and failing `vite build`
  outright. Neither was caused by this ticket's own `package.json` edit (both were already
  declared at their newer versions before this session touched anything) — a plain `pnpm install`
  only partially reconciled it; `pnpm install --force` fixed it cleanly, with a 33-line
  lockfile diff (just `react-day-picker` and its transitive deps) confirming the lockfile itself
  was fine and only the on-disk `node_modules` was stale. Both packages' typechecks and the
  roster-dashboard production build were re-verified clean afterward.
