// Hari Raya ballot pool — pure fairness-draw logic, no I/O. Ported from
// Replit's lib/hrBallot.ts. Two holidays, Puasa and Haji, each track their
// own independent exhaustion pool (an officer is only removed from the pool
// they're actually drawn for), but a Muslim officer chosen for one cannot
// also be chosen for the other within the same calendar year — a temporary,
// same-year-only exclusion (see hrRoster.ts's buildHRCrossHolidayExclusions).
// This rule and the exhaustion-cycle behavior come from Replit's own
// .agents/memory/hr-ballot-exhaustion.md and hari-raya-cross-pool-exclusion.md
// notes — the only record of it found during the capability-parity review;
// there's no independently-verifiable policy doc to cross-check it against.
//
// Dropped relative to Replit's version: the version-1/version-2 JSON-file
// migration logic (restoreHRBallotState) — that existed to migrate Replit's
// own pre-v3 JSON file format, which this Postgres-backed repo never had.

export type HRPoolKind = "puasa" | "haji";
export type HRCycleColor = "green" | "orange";

export interface HRBallotPoolState {
  pool: string[];
  initialized: boolean;
  cycle: HRCycleColor;
  drawHistory: Record<string, Record<string, HRCycleColor>>;
}

export interface HRBallotState {
  version: 3;
  pools: Record<HRPoolKind, HRBallotPoolState>;
}

export interface HRHistoricalDraw {
  date: string;
  officers: string[];
}

export interface HRPoolRebuild {
  poolState: HRBallotPoolState;
  invalidDraws: Array<{ date: string; officer: string }>;
}

/**
 * Mutates only the requested holiday pool and records the cycle of each draw.
 *
 * `excludedNames` is a temporary, caller-owned constraint (officers already
 * allocated to the other Hari Raya holiday that year). Those officers remain
 * in this holiday's pool and can be selected in a later year.
 */
export function drawFromHRBallot(
  state: HRBallotState,
  kind: HRPoolKind,
  date: string,
  count: number,
  officers: readonly string[],
  random: () => number = Math.random,
  excludedNames: ReadonlySet<string> = new Set(),
): Array<{ name: string; cycle: HRCycleColor }> {
  const poolState = state.pools[kind];
  const drawn: Array<{ name: string; cycle: HRCycleColor }> = [];
  poolState.drawHistory[date] = {};

  while (drawn.length < count) {
    const eligiblePool = () => poolState.pool.filter((name) => !excludedNames.has(name));

    if (eligiblePool().length === 0) {
      if (officers.every((name) => excludedNames.has(name))) {
        throw new Error(`No eligible officers remain for Hari Raya ${kind} on ${date}.`);
      }

      // A pool containing only temporarily excluded officers is exhausted for
      // this year's draw. Start the next cycle for eligible officers, while
      // retaining the deferred names so they remain available next year.
      poolState.cycle = poolState.cycle === "green" ? "orange" : "green";
      const drawnSet = new Set(drawn.map((entry) => entry.name));
      const deferred = poolState.pool.filter((name) => excludedNames.has(name));
      const deferredSet = new Set(deferred);
      poolState.pool = [
        ...deferred,
        ...officers.filter((name) => !deferredSet.has(name) && !drawnSet.has(name)),
      ];
    }

    const eligible = eligiblePool();
    const name = eligible[Math.floor(random() * eligible.length)];
    const index = poolState.pool.indexOf(name);
    poolState.pool.splice(index, 1);
    drawn.push({ name, cycle: poolState.cycle });
    poolState.drawHistory[date][name] = poolState.cycle;
  }

  return drawn;
}

/**
 * Reconstructs one independent Hari Raya pool from scheduled duties.
 *
 * The schedule, rather than a mutable saved pool, is the source of truth:
 * officers are removed from their specific holiday pool until it is empty,
 * then the next draw starts the opposite-colour cycle with the full pool.
 * An assignment that is already absent from its current pool is reported as
 * invalid instead of being silently accepted as a repeat.
 */
export function rebuildHRBallotPoolFromHistory(
  historicalDraws: HRHistoricalDraw[],
  officers: readonly string[],
  excludedNamesByDate: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): HRPoolRebuild {
  const poolState: HRBallotPoolState = {
    pool: [...officers],
    initialized: true,
    cycle: "green",
    drawHistory: {},
  };
  const allowed = new Set(officers);
  const invalidDraws: Array<{ date: string; officer: string }> = [];

  for (const { date, officers: scheduled } of [...historicalDraws].sort((a, b) => a.date.localeCompare(b.date))) {
    const excludedNames = excludedNamesByDate.get(date) ?? new Set<string>();
    for (const officer of scheduled) {
      if (!allowed.has(officer)) continue;

      const eligiblePool = () => poolState.pool.filter((name) => !excludedNames.has(name));
      if (eligiblePool().length === 0) {
        poolState.cycle = poolState.cycle === "green" ? "orange" : "green";
        const deferred = poolState.pool.filter((name) => excludedNames.has(name));
        const deferredSet = new Set(deferred);
        poolState.pool = [
          ...deferred,
          ...officers.filter((name) => !deferredSet.has(name)),
        ];
      }

      const index = poolState.pool.indexOf(officer);
      if (index < 0) {
        invalidDraws.push({ date, officer });
        continue;
      }

      poolState.pool.splice(index, 1);
      if (!poolState.drawHistory[date]) poolState.drawHistory[date] = {};
      poolState.drawHistory[date][officer] = poolState.cycle;
    }
  }

  return { poolState, invalidDraws };
}

export function buildHRBallotPoolSummary(
  poolState: HRBallotPoolState,
  officers: readonly string[],
) {
  const pool = [...poolState.pool];
  const poolSet = new Set(pool);
  return {
    pool,
    drawn: officers.filter((name) => !poolSet.has(name)),
    remaining: pool.length,
    currentCycle: poolState.cycle,
    // Retained for existing clients that already read this name.
    cycle: poolState.cycle,
  };
}
