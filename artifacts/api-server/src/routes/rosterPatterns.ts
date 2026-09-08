// RosterBuilder backend — authoring, generating, and "implementing" duty-cycle
// patterns. Ported from Replit's rosterPatterns.ts, adapted from its
// JSON-file architecture to Postgres (see the schema file's header comment
// for the storage-shape decision, and the implement route below for the
// biggest behavioral adaptation — see "Officers: upsert + soft-delete").
import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, gte, inArray } from "drizzle-orm";
import {
  db,
  rosterPatternsTable,
  rosterCycleMetaTable,
  rosterCycleDutiesTable,
  officersTable,
  rosterConfigTable,
  rosterOverridesTable,
  rosterSwapsTable,
  rosterDayOverridesTable,
  rosterDayOverrideApplicationsTable,
} from "@workspace/db";
import { requireManager, getManager } from "./auth.js";
import { invalidateCycleCache } from "./rosterPlan.js";
import { sendToManagers, broadcastToCrew } from "./push.js";
import { appendActivityLog } from "../lib/activityLog.js";

export const rosterPatternsRouter = Router();

// ── Types (mirror the jsonb `data` column's shape) ─────────────────────────
interface PatternOfficer {
  id: string;
  name: string;
  vehicle: string;
  crewPosition: number;
}
interface Subcatchment {
  id: string;
  acronym: string;
  name: string;
  color: string;
}
interface PatternTeam {
  slot: number;
  subcatchmentId?: string;
  catchment: string;
  unit: string;
  color?: string;
  officers: PatternOfficer[];
}
interface PatternData {
  weekdayPD: number;
  weekdayDAY: number;
  weekendPD: number;
  weekendDAY: number;
  weekdayPattern?: string;
  weekendPattern?: string;
  consecutiveShifts?: number;
  baseWeeks: string[][];
  teams: PatternTeam[];
  subcatchments?: Subcatchment[];
}
interface RosterPattern {
  id: string;
  name: string;
  teamCount: number;
  createdAt: string;
  isBuiltIn: boolean;
  data: PatternData;
}

function toRosterPattern(row: typeof rosterPatternsTable.$inferSelect): RosterPattern {
  return {
    id: row.id,
    name: row.name,
    teamCount: row.teamCount,
    createdAt: row.createdAt,
    isBuiltIn: row.isBuiltIn,
    data: row.data as PatternData,
  };
}
// Flattens id/name/teamCount/createdAt/isBuiltIn alongside the data fields —
// matches Replit's RosterPattern shape (one flat object), so the frontend
// doesn't need to know about the storage split into columns vs. jsonb.
function flatten(p: RosterPattern) {
  return { id: p.id, name: p.name, teamCount: p.teamCount, createdAt: p.createdAt, isBuiltIn: p.isBuiltIn, ...p.data };
}

// ── Cycle templates (for generating new patterns) ─────────────────────────────
const DAYS_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const CYCLE_20_WEEK1: Record<string, string[]> = {
  Mon: ["PD","OFF","OFF","DAY","PD","ND","DAY","DAY","ND","ND","DAY","PD","DAY","ND","ND","PD","DAY","ND","DAY","DAY"],
  Tue: ["PD","ND","ND","DAY","PD","OFF","DAY","DAY","ND","ND","DAY","PD","DAY","ND","ND","PD","DAY","OFF","DAY","DAY"],
  Wed: ["PD","ND","ND","DAY","PD","ND","DAY","DAY","ND","OFF","DAY","PD","DAY","OFF","ND","PD","DAY","ND","DAY","DAY"],
  Thu: ["PD","ND","ND","DAY","PD","ND","DAY","DAY","ND","ND","DAY","PD","DAY","ND","OFF","PD","DAY","ND","DAY","DAY"],
  Fri: ["PD","ND","ND","DAY","PD","ND","DAY","DAY","ND","ND","DAY","PD","DAY","ND","ND","PD","DAY","ND","DAY","DAY"],
  Sat: ["REST","PD","DAY","OFF","REST","DAY","OFF","OFF","REST","PD","OFF","OFF","REST","REST","PD","OFF","REST","DAY","OFF","OFF"],
  Sun: ["PD","REST","REST","REST","PD","REST","REST","REST","DAY","REST","REST","REST","DAY","DAY","REST","REST","PD","REST","REST","REST"],
};
const CYCLE_24_WEEK1: Record<string, string[]> = {
  Mon: ["PD","OFF","OFF","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","DAY","ND","ND","DAY"],
  Tue: ["PD","ND","ND","DAY","PD","OFF","OFF","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","DAY","ND","ND","DAY"],
  Wed: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","OFF","OFF","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","DAY","ND","ND","DAY"],
  Thu: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","OFF","DAY","DAY","PD","ND","DAY","DAY","DAY","ND","OFF","DAY"],
  Fri: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","OFF","DAY","DAY","DAY","OFF","ND","DAY"],
  Sat: ["PD","REST","PD","OFF","PD","REST","DAY","OFF","PD","REST","DAY","OFF","DAY","REST","OFF","OFF","REST","REST","OFF","OFF","REST","REST","DAY","OFF"],
  Sun: ["REST","PD","REST","REST","REST","PD","REST","REST","REST","PD","REST","REST","REST","DAY","REST","OFF","PD","DAY","OFF","OFF","DAY","DAY","REST","OFF"],
};
const CYCLE_28_WEEK1: Record<string, string[]> = {
  Mon: ["PD","OFF","OFF","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","PD","DAY","ND","DAY","DAY","ND","ND","ND"],
  Tue: ["PD","ND","ND","DAY","PD","OFF","OFF","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","PD","DAY","ND","DAY","DAY","ND","ND","ND"],
  Wed: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","OFF","ND","DAY","PD","OFF","DAY","DAY","PD","ND","DAY","DAY","PD","DAY","ND","DAY","DAY","ND","ND","ND"],
  Thu: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","OFF","DAY","DAY","PD","DAY","ND","DAY","DAY","OFF","ND","ND"],
  Fri: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","PD","DAY","ND","DAY","DAY","ND","OFF","ND"],
  Sat: ["PD","REST","DAY","OFF","PD","REST","DAY","OFF","PD","DAY","OFF","OFF","PD","REST","OFF","OFF","REST","REST","OFF","OFF","REST","OFF","OFF","OFF","DAY","REST","REST","OFF"],
  Sun: ["REST","PD","REST","REST","REST","PD","REST","REST","REST","REST","REST","REST","REST","DAY","REST","OFF","PD","DAY","OFF","OFF","PD","OFF","OFF","OFF","REST","DAY","DAY","OFF"],
};

function getWeek1Template(teamCount: number): Record<string, string[]> {
  if (teamCount === 24) return CYCLE_24_WEEK1;
  if (teamCount === 28) return CYCLE_28_WEEK1;
  return CYCLE_20_WEEK1;
}

/** Convert WEEK1 template to base_weeks for team slot 1 over teamCount weeks. */
function generateBaseWeeks(teamCount: number): string[][] {
  const template = getWeek1Template(teamCount);
  const base: string[][] = [];
  for (let w = 0; w < teamCount; w++) {
    const week: string[] = [];
    for (const day of DAYS_ORDER) {
      week.push(template[day]?.[w % teamCount] ?? "OFF");
    }
    base.push(week);
  }
  return base;
}

// GET /api/roster-patterns — list all patterns (summary)
rosterPatternsRouter.get("/roster-patterns", requireManager, async (_req, res) => {
  const rows = await db
    .select({
      id: rosterPatternsTable.id,
      name: rosterPatternsTable.name,
      teamCount: rosterPatternsTable.teamCount,
      createdAt: rosterPatternsTable.createdAt,
      isBuiltIn: rosterPatternsTable.isBuiltIn,
    })
    .from(rosterPatternsTable);
  res.json(rows);
});

// GET /api/roster-patterns/:id — full pattern
rosterPatternsRouter.get("/roster-patterns/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const [row] = await db.select().from(rosterPatternsTable).where(eq(rosterPatternsTable.id, id));
  if (!row) { res.status(404).json({ error: "Pattern not found" }); return; }
  res.json(flatten(toRosterPattern(row)));
});

// POST /api/roster-patterns — create new pattern
rosterPatternsRouter.post("/roster-patterns", requireManager, async (req, res) => {
  const body = req.body as Partial<PatternData & { name?: string; teamCount?: number; subcatchments?: Subcatchment[] }>;
  if (!body.name?.trim() || !body.teamCount || !Array.isArray(body.baseWeeks) || !Array.isArray(body.teams)) {
    res.status(400).json({ error: "Missing required fields: name, teamCount, baseWeeks, teams" });
    return;
  }
  const name = body.name.trim();
  const existing = await db.select({ id: rosterPatternsTable.id }).from(rosterPatternsTable).where(eq(rosterPatternsTable.name, name));
  if (existing.length > 0) {
    res.status(400).json({ error: "A pattern with this name already exists" });
    return;
  }
  const id = `pattern-${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString().slice(0, 10);
  const data: PatternData = {
    weekdayPD: body.weekdayPD ?? 4,
    weekdayDAY: body.weekdayDAY ?? 8,
    weekendPD: body.weekendPD ?? 3,
    weekendDAY: body.weekendDAY ?? 3,
    weekdayPattern: body.weekdayPattern ?? "",
    weekendPattern: body.weekendPattern ?? "",
    consecutiveShifts: body.consecutiveShifts ?? undefined,
    baseWeeks: body.baseWeeks,
    teams: body.teams,
    subcatchments: body.subcatchments ?? [],
  };
  await db.insert(rosterPatternsTable).values({ id, name, teamCount: body.teamCount, createdAt, isBuiltIn: false, data });
  res.json(flatten({ id, name, teamCount: body.teamCount, createdAt, isBuiltIn: false, data }));
});

// PUT /api/roster-patterns/:id — update pattern
rosterPatternsRouter.put("/roster-patterns/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const [existingRow] = await db.select().from(rosterPatternsTable).where(eq(rosterPatternsTable.id, id));
  if (!existingRow) { res.status(404).json({ error: "Pattern not found" }); return; }
  const existing = toRosterPattern(existingRow);
  const body = req.body as Partial<PatternData & { name?: string; teamCount?: number; subcatchments?: Subcatchment[] }>;

  const newName = body.name?.trim() ?? existing.name;
  if (newName !== existing.name) {
    const clash = await db.select({ id: rosterPatternsTable.id }).from(rosterPatternsTable).where(eq(rosterPatternsTable.name, newName));
    if (clash.some((c) => c.id !== id)) {
      res.status(400).json({ error: "A pattern with this name already exists" });
      return;
    }
  }

  const data: PatternData = {
    weekdayPD: body.weekdayPD ?? existing.data.weekdayPD,
    weekdayDAY: body.weekdayDAY ?? existing.data.weekdayDAY,
    weekendPD: body.weekendPD ?? existing.data.weekendPD,
    weekendDAY: body.weekendDAY ?? existing.data.weekendDAY,
    weekdayPattern: body.weekdayPattern ?? existing.data.weekdayPattern ?? "",
    weekendPattern: body.weekendPattern ?? existing.data.weekendPattern ?? "",
    consecutiveShifts: body.consecutiveShifts !== undefined ? body.consecutiveShifts : existing.data.consecutiveShifts,
    baseWeeks: body.baseWeeks ?? existing.data.baseWeeks,
    teams: body.teams ?? existing.data.teams,
    subcatchments: body.subcatchments ?? existing.data.subcatchments ?? [],
  };
  const teamCount = body.teamCount ?? existing.teamCount;
  await db.update(rosterPatternsTable).set({ name: newName, teamCount, data }).where(eq(rosterPatternsTable.id, id));
  res.json(flatten({ ...existing, name: newName, teamCount, data }));
});

// DELETE /api/roster-patterns/:id
rosterPatternsRouter.delete("/roster-patterns/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const [row] = await db.select().from(rosterPatternsTable).where(eq(rosterPatternsTable.id, id));
  if (!row) { res.status(404).json({ error: "Pattern not found" }); return; }
  if (row.isBuiltIn) { res.status(400).json({ error: "Cannot delete built-in pattern" }); return; }
  await db.delete(rosterPatternsTable).where(eq(rosterPatternsTable.id, id));
  res.json({ success: true });
});

// POST /api/roster-patterns/generate — generate base_weeks from teamCount
rosterPatternsRouter.post("/roster-patterns/generate", requireManager, (req, res) => {
  const count = Number((req.body as { teamCount?: number }).teamCount);
  if (![20, 24, 28].includes(count)) {
    res.status(400).json({ error: "teamCount must be 20, 24, or 28" });
    return;
  }
  res.json({ baseWeeks: generateBaseWeeks(count) });
});

// ── Officer plan (shared by the implement-preview dry run and the real
// implement route below) — resolves which existing officers get upserted vs.
// deactivated for a given pattern. One source of truth so the preview shown
// to the operator can never drift from what implementing actually does —
// see .scratch/roster-qa/issues/01: implementing a pattern with unnamed/
// unmatched officer slots used to silently deactivate the entire active
// roster with zero warning. ─────────────────────────────────────────────────
const BUILT_IN_SUBS: Subcatchment[] = [
  { id: "sc_default_1", acronym: "BU", name: "Bukit Timah Urban", color: "#FFFFCC" },
  { id: "sc_default_2", acronym: "PJ", name: "Jurong Pandan", color: "#D0D0D0" },
  { id: "sc_default_3", acronym: "WK", name: "Woodlands Kranji", color: "#FBE2D5" },
  { id: "sc_default_4", acronym: "CP", name: "Changi Punggol", color: "#DAF2D0" },
  { id: "sc_default_5", acronym: "KG", name: "Kallang Geylang", color: "#CAEDFB" },
];

function resolveTeamUnit(team: PatternTeam, subMap: Map<string, Subcatchment>): { fullUnit: string; fullCatchment: string } {
  const sub = team.subcatchmentId ? subMap.get(team.subcatchmentId) : undefined;
  const acronym = sub?.acronym ?? "";
  const unitNum = team.unit?.replace(/^[A-Za-z]+/, "") || team.unit || "";
  return {
    fullUnit: acronym ? `${acronym}${unitNum}` : team.unit || "",
    fullCatchment: sub?.name || team.catchment || "",
  };
}

function nameToOfficerId(name: string): string {
  const slug = (name ?? "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return slug || `officer-${Date.now()}`;
}

async function computeOfficerPlan(pattern: RosterPattern): Promise<{
  newOfficerRows: (typeof officersTable.$inferInsert)[];
  deactivateIds: string[];
  deactivatedOfficers: { id: string; name: string }[];
}> {
  const allSubs: Subcatchment[] = pattern.data.subcatchments && pattern.data.subcatchments.length > 0
    ? pattern.data.subcatchments
    : BUILT_IN_SUBS;
  const subMap = new Map(allSubs.map((s) => [s.id, s]));

  const existingOfficers = await db.select({ id: officersTable.id, name: officersTable.name }).from(officersTable);
  const existingIdByName = new Map(existingOfficers.map((o) => [o.name.trim().toLowerCase(), o.id]));

  const newOfficerRows: (typeof officersTable.$inferInsert)[] = [];
  for (const team of pattern.data.teams) {
    const { fullUnit, fullCatchment } = resolveTeamUnit(team, subMap);
    for (const o of team.officers) {
      if (!o.name?.trim()) continue;
      const nameKey = o.name.trim().toLowerCase();
      const stableId = existingIdByName.get(nameKey)
        ?? (o.id && !o.id.startsWith("new-") ? o.id : null)
        ?? nameToOfficerId(o.name);
      newOfficerRows.push({
        id: stableId,
        name: o.name,
        unitCode: fullUnit,
        vehicle: o.vehicle ?? "",
        catchment: fullCatchment,
        teamSlot: team.slot,
        crewPosition: o.crewPosition,
        active: true,
      });
    }
  }
  const keepIds = new Set(newOfficerRows.map((o) => o.id!));
  const deactivateIds = existingOfficers.map((o) => o.id).filter((id) => !keepIds.has(id));
  const deactivatedOfficers = existingOfficers
    .filter((o) => !keepIds.has(o.id))
    .map((o) => ({ id: o.id, name: o.name }));

  return { newOfficerRows, deactivateIds, deactivatedOfficers };
}

// GET /api/roster-patterns/:id/implement-preview — dry run of the officer
// upsert/deactivate step implement performs, no writes. Lets the frontend
// warn the operator with exactly who'd be deactivated before they commit.
rosterPatternsRouter.get("/roster-patterns/:id/implement-preview", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const [row] = await db.select().from(rosterPatternsTable).where(eq(rosterPatternsTable.id, id));
  if (!row) { res.status(404).json({ error: "Pattern not found" }); return; }
  const pattern = toRosterPattern(row);
  const { newOfficerRows, deactivatedOfficers } = await computeOfficerPlan(pattern);
  res.json({ keepCount: newOfficerRows.length, deactivatedOfficers });
});

// POST /api/roster-patterns/:id/implement — implement pattern from a date.
//
// Adapted from Replit's JSON-file version, which wholesale-replaced
// roster-officers.json. That doesn't translate to Postgres: officers.id is
// a RESTRICT-FK target from 8 other tables (leave/override/swap/duty
// history — see officers.ts's schema comment), so hard-deleting an officer
// who isn't in the new pattern would either be blocked or destroy history.
// Officers no longer in the pattern are deactivated (active=false, the
// existing soft-delete convention) instead of deleted — they keep their
// history and remain reactivatable from the officer admin page, matching
// how officer removal already works everywhere else in this app.
//
// Also NOT ported: Replit's fire-and-forget regeneratePHForFutureDates()
// call at the end. That duplicates/adapts logic this repo already built as
// its own well-tested standalone endpoint in Phase B
// (POST /ph-roster-ref/auto-allocate) — re-deriving a second internal
// auto-regen codepath here would be scope creep for what's meant to be a
// nice-to-have convenience, not a required step. Regenerating PH for a
// newly-implemented pattern's future dates stays a manual follow-up call
// to that existing endpoint.
rosterPatternsRouter.post("/roster-patterns/:id/implement", requireManager, async (req, res) => {
  const { implementDate, implementerName } = req.body as { implementDate?: string; implementerName?: string };
  if (!implementDate || !/^\d{4}-\d{2}-\d{2}$/.test(implementDate)) {
    res.status(400).json({ error: "implementDate (YYYY-MM-DD) required" });
    return;
  }

  const { id } = req.params as { id: string };
  const [row] = await db.select().from(rosterPatternsTable).where(eq(rosterPatternsTable.id, id));
  if (!row) { res.status(404).json({ error: "Pattern not found" }); return; }
  const pattern = toRosterPattern(row);
  const { teamCount } = pattern;
  const { baseWeeks, teams } = pattern.data;
  const cycleLengthDays = teamCount * 7;

  // Subcatchment resolution — see resolveTeamUnit/BUILT_IN_SUBS above.
  const allSubs: Subcatchment[] = pattern.data.subcatchments && pattern.data.subcatchments.length > 0
    ? pattern.data.subcatchments
    : BUILT_IN_SUBS;
  const subMap = new Map(allSubs.map((s) => [s.id, s]));

  // 1. Generate per-officer duty rows from the pattern (target === actual on
  // a freshly-implemented cycle — no overrides exist for it yet).
  const cycleDutyRows: (typeof rosterCycleDutiesTable.$inferInsert)[] = [];
  for (const team of teams) {
    const { fullUnit } = resolveTeamUnit(team, subMap);
    if (!fullUnit) continue;
    for (let dayIdx = 0; dayIdx < cycleLengthDays; dayIdx++) {
      const week = Math.floor(dayIdx / 7);
      const dayOfWeek = dayIdx % 7;
      const baseIdx = (team.slot - 1 + week) % teamCount;
      const duty = baseWeeks[baseIdx]?.[dayOfWeek] ?? "OFF";
      const date = new Date(`${implementDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + dayIdx);
      cycleDutyRows.push({
        unitCode: fullUnit,
        date: date.toISOString().slice(0, 10),
        targetDuty: duty,
        actualDuty: duty,
      });
    }
  }

  // 2. Officers: upsert everyone in the new pattern (stable id — same name
  // match keeps existing history attached), deactivate everyone else. Same
  // computeOfficerPlan the implement-preview endpoint above uses, so the
  // confirmation the frontend shows before calling this route can never
  // disagree with what actually happens here.
  const { newOfficerRows, deactivateIds } = await computeOfficerPlan(pattern);

  // 3. Trim overrides/swaps/day-overrides from implementDate onward — a new
  // cycle makes any future-dated manual edit against the old cycle stale.
  const trimmedDayOverrides = await db
    .select({ id: rosterDayOverridesTable.id })
    .from(rosterDayOverridesTable)
    .where(gte(rosterDayOverridesTable.date, implementDate));
  const trimmedIds = trimmedDayOverrides.map((r) => r.id);

  await db.transaction(async (tx) => {
    // roster_cycle_meta + roster_cycle_duties: full replace, same as
    // Replit's wholesale roster-cycle.json rewrite.
    await tx
      .insert(rosterCycleMetaTable)
      .values({ id: 1, cycleStartDate: implementDate, cycleLengthDays, excelStartDate: implementDate })
      .onConflictDoUpdate({
        target: rosterCycleMetaTable.id,
        set: { cycleStartDate: implementDate, cycleLengthDays, excelStartDate: implementDate },
      });
    await tx.delete(rosterCycleDutiesTable);
    if (cycleDutyRows.length > 0) await tx.insert(rosterCycleDutiesTable).values(cycleDutyRows);

    // Officers: upsert then deactivate stragglers (see the route-level
    // comment above for why this isn't a hard delete).
    for (const o of newOfficerRows) {
      await tx
        .insert(officersTable)
        .values(o)
        .onConflictDoUpdate({
          target: officersTable.id,
          set: { name: o.name, unitCode: o.unitCode, vehicle: o.vehicle, catchment: o.catchment, teamSlot: o.teamSlot, crewPosition: o.crewPosition, active: true },
        });
    }
    if (deactivateIds.length > 0) {
      await tx.update(officersTable).set({ active: false }).where(inArray(officersTable.id, deactivateIds));
    }

    // roster_config: teamCount + cycleStartDate only — weekendPD/weekendDay/
    // weekdayMinStrength are a separate concern (see rosterConfig.ts) and
    // stay untouched, same partial-update convention as everywhere else.
    await tx
      .insert(rosterConfigTable)
      .values({ id: 1, teamCount, cycleStartDate: implementDate })
      .onConflictDoUpdate({ target: rosterConfigTable.id, set: { teamCount, cycleStartDate: implementDate } });

    await tx.delete(rosterOverridesTable).where(gte(rosterOverridesTable.date, implementDate));
    await tx.delete(rosterSwapsTable).where(gte(rosterSwapsTable.date, implementDate));
    if (trimmedIds.length > 0) {
      await tx.delete(rosterDayOverrideApplicationsTable).where(inArray(rosterDayOverrideApplicationsTable.dayOverrideId, trimmedIds));
      await tx.delete(rosterDayOverridesTable).where(inArray(rosterDayOverridesTable.id, trimmedIds));
    }
  });

  invalidateCycleCache();

  const mid = req.session?.managerId;
  const caller = mid ? getManager(mid) : null;
  const byWhom = implementerName?.trim() || caller?.officerName || caller?.username || "an administrator";

  const notifPayload = {
    title: "New Roster Implemented",
    body: `A new roster has been implemented by ${byWhom}. Please check for any changes to your duties.`,
    tag: "roster-implement",
  };
  Promise.all([sendToManagers(notifPayload), broadcastToCrew(notifPayload)]).catch(() => {});

  await appendActivityLog({
    type: "roster-implement",
    title: `New roster implemented by ${byWhom}`,
    body: `Pattern "${pattern.name}" is active from ${implementDate}.`,
    createdAt: new Date(),
    patternName: pattern.name,
    implementDate,
    implementerName: byWhom,
    officerId: null,
    officerName: null,
    leaveDate: null,
    leaveType: null,
    appliedByName: null,
  });

  res.json({
    success: true,
    message: `Pattern "${pattern.name}" implemented from ${implementDate}.`,
    officersActivated: newOfficerRows.length,
    officersDeactivated: deactivateIds.length,
  });
});
