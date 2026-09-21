import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, ne, inArray, desc, isNull, isNotNull } from "drizzle-orm";
import {
  db,
  officersTable,
  rosterConfigTable,
  rosterMaintenanceVehiclesTable,
  rosterCycleMetaTable,
  rosterCycleDutiesTable,
  rosterOverridesTable,
  rosterSwapsTable,
  rosterLeavesTable,
  rosterDayOverridesTable,
  rosterDayOverrideApplicationsTable,
  leaveRequestsTable,
  phRosterRefTable,
  rosterRequirementsTable,
  type Officer,
  type RosterOverride,
  type RosterLeave,
  type RosterSwap,
} from "@workspace/db";
import { getManager, requireManager } from "./auth.js";
import { appendActivityLog, getActivityLog } from "../lib/activityLog.js";
// vehicleArrangement.ts already imports several functions from this file;
// this is the reverse edge of that same (safe) cycle — see
// resolveOfficerVehicleMap's own comment for why. Used by buildSummary() so
// the FIRB deployment text shows the day's actual vehicle arrangement
// instead of an officer's static home-vehicle field.
// .scratch/replit-resync-2026-09-21/issues/05.
import { resolveOfficerVehicleMap } from "./vehicleArrangement.js";

// ── Cycle patterns ─────────────────────────────────────────────────────────────
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

// ── 24-team template ──────────────────────────────────────────────────────────
// Designed for perfect 4-week balance: positions cycle [6,5,5,5] shifts/week
// (heavy positions at 0,4,8,12,16,20 — exactly one per 4-position group)
// so any consecutive 4-week window = 6+5+5+5 = 21 shifts × 8 hrs = 42 hrs/wk
//
// Weekdays: 5 PD + 9 DAY + 8 ND + 2 OFF  (22 working out of 24)
// Weekends: 4 PD + 4 DAY + 8 REST + 8 OFF (Sat) / 4 PD + 4 DAY + 12 REST + 4 OFF (Sun)
//
// Position role key (0-indexed):
//   PD-type     : 0,4,8,12,16  — on PD all weekdays they work
//   DAY-type    : 3,7,11,14,15,18,19,20,23 — on DAY all weekdays they work
//   ND-type     : 1,2,5,6,9,10,13,17,21,22 — on ND weekdays, each has 1 weekday OFF
//
// Weekday OFF schedule (spread evenly): Mon→{1,2}, Tue→{5,6}, Wed→{9,10},
//                                       Thu→{13,22}, Fri→{17,21}
// Sat workers: 0,4,8 (PD), 2,6,10 (PD/DAY), 12,22 (DAY)  [4 PD + 4 DAY]
// Sun workers: 1,5,9,16 (PD), 13,17,20,21 (DAY)           [4 PD + 4 DAY]
const CYCLE_24_WEEK1: Record<string, string[]> = {
  Mon: ["PD","OFF","OFF","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","DAY","ND","ND","DAY"],
  Tue: ["PD","ND","ND","DAY","PD","OFF","OFF","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","DAY","ND","ND","DAY"],
  Wed: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","OFF","OFF","DAY","PD","ND","DAY","DAY","PD","ND","DAY","DAY","DAY","ND","ND","DAY"],
  Thu: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","OFF","DAY","DAY","PD","ND","DAY","DAY","DAY","ND","OFF","DAY"],
  Fri: ["PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","ND","DAY","PD","ND","DAY","DAY","PD","OFF","DAY","DAY","DAY","OFF","ND","DAY"],
  Sat: ["PD","REST","PD","OFF","PD","REST","DAY","OFF","PD","REST","DAY","OFF","DAY","REST","OFF","OFF","REST","REST","OFF","OFF","REST","REST","DAY","OFF"],
  Sun: ["REST","PD","REST","REST","REST","PD","REST","REST","REST","PD","REST","REST","REST","DAY","REST","OFF","PD","DAY","OFF","OFF","DAY","DAY","REST","OFF"],
};

// ── 28-team template ──────────────────────────────────────────────────────────
// [6,5,5,5]×7 = 147 slots/week = 42 hrs/week; any 4-week window = 21 shifts
//
// Heavy (6 shifts): 0,4,8,12,16,20 (PD) + 24 (DAY)
// NB    (5 shifts, 1 wd OFF + 1 wkend): 1,2,5,6,9,13,17,25,26
// NC    (5 shifts, 5 wd + no wkend): 3,7,10,11,14,15,18,19,21,22,23,27
//
// OFF rotation: Mon{1,2} Tue{5,6} Wed{9,13} Thu{17,25} Fri{26}
// Weekdays Mon–Thu: 6 PD + 10 DAY + 10 ND + 2 OFF (26 working)
// Weekday Fri:     6 PD + 10 DAY + 11 ND + 1 OFF  (27 working)
// Sat workers: 0,4,8,12(PD) + 2,6,9,24(DAY) = 4 PD + 4 DAY ✓
// Sun workers: 1,5,16,20(PD) + 13,17,25,26(DAY) = 4 PD + 4 DAY ✓
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

// ── Cycle computation ─────────────────────────────────────────────────────────
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function computeCycleWeek(cycleStartDate: string, targetMonday: Date, teamCount: number): number {
  const start = getMondayOf(new Date(cycleStartDate));
  const diffMs = targetMonday.getTime() - start.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return ((diffWeeks % teamCount) + teamCount) % teamCount + 1;
}

function getDutyForSlotInWeek(teamSlot: number, cycleWeek: number, day: string, teamCount: number): string {
  const template = getWeek1Template(teamCount);
  const dayTemplate = template[day];
  if (!dayTemplate) return "OFF";
  const slotIndex = ((teamSlot - 1 + cycleWeek - 1) % teamCount + teamCount) % teamCount;
  return dayTemplate[slotIndex] || "OFF";
}

// ── Excel-sourced cycle lookup (roster_cycle_meta / roster_cycle_duties) ───────
// Loaded once per process and cached, same architecture as the original
// JSON-backed _cycleCache/_cycleUnitMap — just sourced from Postgres. The
// original data was a dense array indexed by day-offset-from-cycleStartDate,
// wrapping (% cycleLengthDays) so the 140-day Excel window repeats forever.
// roster_cycle_duties instead has one row per (unit_code, date), so the
// wraparound math below maps any date back onto a date within the original
// window before looking up the row — preserving the exact original
// behavior rather than letting dates past the import window silently fall
// through to the generator.
let _cycleMeta: { cycleStartDate: string; cycleLengthDays: number } | null | undefined = undefined;
let _cycleUnitMap: Map<string, Map<string, string>> | null = null; // unitCode -> (date -> targetDuty)

export async function ensureCycleCacheLoaded(): Promise<void> {
  if (_cycleUnitMap) return;
  const [meta] = await db.select().from(rosterCycleMetaTable).where(eq(rosterCycleMetaTable.id, 1));
  _cycleMeta = meta ?? null;
  _cycleUnitMap = new Map();
  if (!meta) return;
  const rows = await db.select().from(rosterCycleDutiesTable);
  for (const row of rows) {
    if (!_cycleUnitMap.has(row.unitCode)) _cycleUnitMap.set(row.unitCode, new Map());
    _cycleUnitMap.get(row.unitCode)!.set(row.date, row.targetDuty);
  }
}

/** Drops the in-memory cycle cache so the next read reflects a just-written
 *  roster_cycle_meta/roster_cycle_duties change. Called by
 *  rosterPatterns.ts's implement route after it rewrites both tables. */
export function invalidateCycleCache(): void {
  _cycleMeta = undefined;
  _cycleUnitMap = null;
}

/**
 * Returns the scheduled (target) duty for a unit on a given date using the
 * Excel cycle. Returns null if no cycle data exists, the date is before the
 * cycle start date, or the unit is unknown. Call ensureCycleCacheLoaded()
 * first — this is synchronous once the cache is warm.
 */
function getDutyFromCycle(unitCode: string, dateStr: string): string | null {
  if (!_cycleMeta || !_cycleUnitMap) return null;
  const startMs = new Date(_cycleMeta.cycleStartDate + "T00:00:00Z").getTime();
  const dateMs = new Date(dateStr + "T00:00:00Z").getTime();
  if (dateMs < startMs) return null; // before cycle → use formula
  const dayIndex = Math.floor((dateMs - startMs) / 86_400_000) % _cycleMeta.cycleLengthDays;
  const wrappedDate = new Date(startMs + dayIndex * 86_400_000).toISOString().slice(0, 10);
  const unitDuties = _cycleUnitMap.get(unitCode);
  if (!unitDuties) return null; // unit not in Excel → use formula
  return unitDuties.get(wrappedDate) ?? null;
}

// Single-officer effective-duty lookup — the same 4-tier precedence
// (override > committed leave > cycle > generator fallback) buildSummary()
// computes per-officer above, factored out for read-before-write callers
// (import-brief) that need to compare one officer's *current* state against
// an incoming value without building a whole day's report. Deliberately
// re-derived from buildSummary's own resolution snippet rather than written
// independently — see CONTEXT.md's "Duty resolution — 4-tier precedence"
// note on how easy it is to under-count this to 3 tiers.
export function getOfficerEffectiveDutyForDate(
  officer: Officer,
  dateStr: string,
  overridesForDate: Map<string, RosterOverride>,
  leavesForDate: Map<string, RosterLeave>,
  config: RosterConfigShape,
): { duty: string; vehicle: string | null; crossPostedUnit: string | null; coveringName: string | null } {
  const d = new Date(dateStr + "T00:00:00Z");
  const monday = getMondayOf(d);
  const cycleWeek = computeCycleWeek(config.cycleStartDate, monday, config.teamCount);
  const utcDay = d.getUTCDay();
  const dayName = DAYS_ORDER[utcDay === 0 ? 6 : utcDay - 1];

  const ov = overridesForDate.get(officer.id);
  const lv = leavesForDate.get(officer.id);
  const computed = getDutyFromCycle(officer.unitCode, dateStr)
    ?? getDutyForSlotInWeek(officer.teamSlot, cycleWeek, dayName, config.teamCount);

  return {
    duty: ov ? ov.duty : lv ? lv.leaveType : computed,
    vehicle: ov?.vehicle ?? null,
    crossPostedUnit: ov?.crossPostedToUnit ?? null,
    coveringName: ov?.coveredByOfficerName ?? lv?.coveringOfficerName ?? null,
  };
}

// ── Officers ─────────────────────────────────────────────────────────────────
export async function loadOfficers(): Promise<Officer[]> {
  return db.select().from(officersTable);
}

// ── Roster config ────────────────────────────────────────────────────────────
export interface RosterConfigShape {
  teamCount: 20 | 24 | 28;
  cycleStartDate: string;
  maintenanceVehicles: string[];
  // Minimum on-duty strength inputs (see rosterConfigTable) — optional,
  // buildSummary() falls back to 3 / 3 / 40 when unset.
  weekendPD?: number;
  weekendDAY?: number;
  weekdayMinStrength?: number;
}

export async function loadConfig(): Promise<RosterConfigShape> {
  const [row] = await db.select().from(rosterConfigTable).where(eq(rosterConfigTable.id, 1));
  const vehicles = await db.select().from(rosterMaintenanceVehiclesTable);
  return {
    teamCount: (row?.teamCount as 20 | 24 | 28) ?? 20,
    cycleStartDate: row?.cycleStartDate ?? "2025-01-06",
    maintenanceVehicles: vehicles.map((v) => v.vehicle),
    weekendPD: row?.weekendPD ?? undefined,
    weekendDAY: row?.weekendDay ?? undefined,
    weekdayMinStrength: row?.weekdayMinStrength ?? undefined,
  };
}

async function saveConfig(config: RosterConfigShape): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(rosterConfigTable)
      .values({
        id: 1,
        teamCount: config.teamCount,
        cycleStartDate: config.cycleStartDate,
        weekendPD: config.weekendPD ?? null,
        weekendDay: config.weekendDAY ?? null,
        weekdayMinStrength: config.weekdayMinStrength ?? null,
      })
      .onConflictDoUpdate({
        target: rosterConfigTable.id,
        set: {
          teamCount: config.teamCount,
          cycleStartDate: config.cycleStartDate,
          weekendPD: config.weekendPD ?? null,
          weekendDay: config.weekendDAY ?? null,
          weekdayMinStrength: config.weekdayMinStrength ?? null,
        },
      });
    await tx.delete(rosterMaintenanceVehiclesTable);
    if (config.maintenanceVehicles.length > 0) {
      await tx
        .insert(rosterMaintenanceVehiclesTable)
        .values(config.maintenanceVehicles.map((vehicle) => ({ vehicle })));
    }
  });
}

// ── Overrides / leaves / swaps ──────────────────────────────────────────────
async function loadOverridesForDates(dates: string[]): Promise<RosterOverride[]> {
  if (dates.length === 0) return [];
  return db.select().from(rosterOverridesTable).where(inArray(rosterOverridesTable.date, dates));
}
async function loadAllOverrides(): Promise<RosterOverride[]> {
  return db.select().from(rosterOverridesTable);
}
async function loadLeavesForDates(dates: string[]): Promise<RosterLeave[]> {
  if (dates.length === 0) return [];
  return db.select().from(rosterLeavesTable).where(inArray(rosterLeavesTable.date, dates));
}
async function loadAllLeaves(): Promise<RosterLeave[]> {
  return db.select().from(rosterLeavesTable);
}
async function loadSwaps(): Promise<RosterSwap[]> {
  return db.select().from(rosterSwapsTable).orderBy(desc(rosterSwapsTable.createdAt));
}

interface DayOverrideEvent {
  id: string;
  date: string;
  text: string;
  applied: { officerId: string; officerName: string; duty: string }[];
  submittedBy: string;
  submittedAt: Date;
}

async function loadDayOverrides(): Promise<DayOverrideEvent[]> {
  const events = await db
    .select()
    .from(rosterDayOverridesTable)
    .orderBy(desc(rosterDayOverridesTable.submittedAt));
  const applications = await db.select().from(rosterDayOverrideApplicationsTable);
  const appliedByEvent = new Map<string, DayOverrideEvent["applied"]>();
  for (const a of applications) {
    if (!appliedByEvent.has(a.dayOverrideId)) appliedByEvent.set(a.dayOverrideId, []);
    appliedByEvent.get(a.dayOverrideId)!.push({
      officerId: a.officerId,
      officerName: a.officerName,
      duty: a.duty,
    });
  }
  return events.map((e) => ({
    id: e.id,
    date: e.date,
    text: e.text,
    applied: appliedByEvent.get(e.id) ?? [],
    submittedBy: e.submittedBy,
    submittedAt: e.submittedAt,
  }));
}

// ── Sort key for unit codes ───────────────────────────────────────────────────
const CATCHMENT_ORDER = ["Bukit Timah & Urban", "Jurong & Pandan", "Kranji & Woodlands", "Changi & Punggol", "Kallang & Geylang"];
const BLOCK1_CATCHMENTS = new Set(["Bukit Timah & Urban", "Jurong & Pandan", "Kranji & Woodlands"]);

// ── Today's summary formatter ─────────────────────────────────────────────────
const ABSENT_DUTY_SET = new Set([
  "VL","SL","MC","CCL","FCL","PL","SPL","UL","ML","BL","C","CSL",
  "SLWOMC","AMC","AMMA","AMTO","PMTO","C/PMTO","NS","PPTW","TO","OVL",
  "HL","OIL","OIL(AM)","OIL(PM)","EL","CPL","MA","UNPAID L",
]);

function buildSummary(
  dateStr: string,
  officers: Officer[],
  config: RosterConfigShape,
  overrides: RosterOverride[],
  leaves: RosterLeave[],
  officerVehicleMap: Record<string, string>,
): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const monday = getMondayOf(d);
  const cycleWeek = computeCycleWeek(config.cycleStartDate, monday, config.teamCount);
  const utcDay = d.getUTCDay();
  const dayName = DAYS_ORDER[utcDay === 0 ? 6 : utcDay - 1];

  // Date label: "28 May 26,Thu"
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dateLabel = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)},${DAY_ABBR[utcDay]}`;

  // Weekend = Sat or Sun
  const isWeekend = utcDay === 0 || utcDay === 6;

  // Today's IC-approved leaves
  const todayLeaves = leaves.filter((l) => l.date === dateStr);
  const leaveByOfficerId = new Map<string, RosterLeave>(todayLeaves.map((l) => [l.officerId, l]));

  // Compute each officer's effective duties from override, committed leave, or cycle
  interface OfficerInfo {
    officer: Officer;
    actualDuty: string;
    targetDuty: string;
    crossPostedToUnit: string | null;
    coveredByOfficerName: string | null;
    swappedWithOfficerName: string | null;
    icLeave: RosterLeave | undefined;
  }

  const activeOfficers = officers.filter((o) => o.unitCode && o.unitCode !== "TBC" && o.catchment);
  const SUMMARY_SHIFT_CODES = new Set(["ND","DAY","PD","OFF","REST","OIL"]);
  const infos: OfficerInfo[] = activeOfficers.map((o) => {
    const ov = overrides.find((x) => x.officerId === o.id && x.date === dateStr);
    const lv = leaveByOfficerId.get(o.id);
    const computed = getDutyFromCycle(o.unitCode, dateStr) ?? getDutyForSlotInWeek(o.teamSlot, cycleWeek, dayName, config.teamCount);
    // Precedence: override > committed leave > cycle. actualDuty's raw value
    // now reflects the leave type when no override exists — every current
    // consumer already independently checks icLeave for absence/display, so
    // this doesn't change observable output today, but keeps actualDuty
    // consistent with the documented 4-tier resolution model for any future
    // consumer that reads it directly (see roster & leave schema ticket's
    // amendment, ported from .agents/memory).
    const actualDuty = ov ? ov.duty : lv ? lv.leaveType : computed;
    return {
      officer: o,
      actualDuty,
      targetDuty: SUMMARY_SHIFT_CODES.has(actualDuty) ? (ov?.targetDuty || computed) : computed,
      crossPostedToUnit:      ov?.crossPostedToUnit ?? null,
      // coveredByOfficerName: prefer the override field; fall back to the LeaveEntry's
      // coveringOfficerName so that OVL + cover applied via the leave modal is treated
      // identically to an override that carries the same information.
      coveredByOfficerName:   ov?.coveredByOfficerName ?? leaveByOfficerId.get(o.id)?.coveringOfficerName ?? null,
      swappedWithOfficerName: ov?.swappedWithOfficerName ?? null,
      icLeave:                leaveByOfficerId.get(o.id),
    };
  });

  // Officers who are absent from their home unit:
  // - named as a covering officer for another absent officer (IC leave cover)
  // - OR swapped out (they cover the swap partner's unit instead)
  const coveringElsewhereNames = new Set<string>();
  for (const info of infos) {
    if (info.coveredByOfficerName) coveringElsewhereNames.add(info.coveredByOfficerName);
    // A swapped officer is covering their partner's unit — absent from their own
    if (info.swappedWithOfficerName) coveringElsewhereNames.add(info.officer.name);
  }

  // Name → info lookup (for covering officer duty resolution)
  const infoByName = new Map<string, OfficerInfo>(infos.map((i) => [i.officer.name, i]));

  // Is this officer absent from their home unit?
  function officerAbsent(info: OfficerInfo): boolean {
    return !!(
      info.icLeave ||
      info.crossPostedToUnit ||
      ABSENT_DUTY_SET.has(info.actualDuty) ||
      coveringElsewhereNames.has(info.officer.name)
    );
  }

  // Group by unit, sorted by crewPosition
  const UNIT_ORDER: Record<string, number> = { BU: 0, PJ: 1, WK: 2, CP: 3, KG: 4 };
  const unitMap = new Map<string, OfficerInfo[]>();
  for (const info of infos) {
    const u = info.officer.unitCode;
    if (!unitMap.has(u)) unitMap.set(u, []);
    unitMap.get(u)!.push(info);
  }
  for (const crew of unitMap.values()) crew.sort((a, b) => a.officer.crewPosition - b.officer.crewPosition);

  const sortedUnits = [...unitMap.keys()].sort((a, b) => {
    const ao = UNIT_ORDER[a.slice(0, 2)] ?? 9;
    const bo = UNIT_ORDER[b.slice(0, 2)] ?? 9;
    return ao !== bo ? ao - bo : a.localeCompare(b);
  });

  const block1Lines: string[] = [];
  const block2Lines: string[] = [];
  const offNames: string[] = [];
  const leaveLines: string[] = [];

  for (const unitCode of sortedUnits) {
    const crew = unitMap.get(unitCode)!;
    // Suppress the unit's vehicle when ALL regular crew are cross-posted elsewhere —
    // their vehicle travels with them; the covering ND officer brings no vehicle.
    const hasAnchorCrew = crew.some(c => !c.crossPostedToUnit);
    // Server-resolved daily plate (officerVehicleMap, from vehicle-arrangement's
    // cascade), not the officer's static home-vehicle field — a reassigned
    // plate or a unit with nobody actually working must never show the wrong
    // (or a stale) vehicle. .scratch/replit-resync-2026-09-21/issues/05.
    const plateHolder = crew.find(c => officerVehicleMap[c.officer.id]);
    const vehicle = hasAnchorCrew && plateHolder ? officerVehicleMap[plateHolder.officer.id] : "";
    const isBlock1 = BLOCK1_CATCHMENTS.has(crew[0].officer.catchment);

    // Unit's operational duty: use actualDuty of first non-absent shift worker (reflects
    // swaps & Excel overrides); fall back to covering officer's duty when the home crew
    // is on REST/OFF but someone from another unit is covering a slot as a shift duty.
    const SHIFTS = new Set(["DAY", "PD", "ND"]);
    const firstActive = crew.find(c => !officerAbsent(c) && SHIFTS.has(c.actualDuty));
    // If all home crew are on REST/OFF, check whether any covering officer brings a shift duty
    const firstCoverDuty = firstActive ? undefined : (() => {
      for (const c of crew) {
        if (!c.coveredByOfficerName) continue;
        const coverInfo = infoByName.get(c.coveredByOfficerName);
        if (coverInfo && SHIFTS.has(coverInfo.actualDuty)) return coverInfo.actualDuty;
      }
      return undefined;
    })();
    const unitDuty = firstActive?.actualDuty
      ?? firstCoverDuty
      ?? crew.find(c => SHIFTS.has(c.targetDuty))?.targetDuty
      ?? crew[0].actualDuty;

    const effectiveCrew: string[] = [];

    for (const info of crew) {
      const absent = officerAbsent(info);
      const isOff = !absent && (info.actualDuty === "OFF" || info.actualDuty === "REST");
      // Officer working a shift on their scheduled OFF/REST day (cross-day swap or manual override)
      const isWorkingFromOff = !absent && SHIFTS.has(info.actualDuty)
        && (info.targetDuty === "OFF" || info.targetDuty === "REST");

      if (isOff) {
        offNames.push(info.officer.name);
      } else if (!absent) {
        effectiveCrew.push(info.officer.name);
      } else if (info.swappedWithOfficerName) {
        // Swapped: the absent officer's home slot is filled by their swap partner.
        // Show ONLY the replacement — the absent officer's name must not appear here
        // (they are already shown at their partner's unit via the partner's crew entry).
        // Label rule: [swp] if the covered position is ND; [cover's home unit] for PD/DAY
        const coverInfo = infoByName.get(info.swappedWithOfficerName);
        const coverUnit = coverInfo?.officer.unitCode ?? "";
        const label = unitDuty === "ND" ? "swp" : coverUnit;
        effectiveCrew.push(`${info.swappedWithOfficerName} [${label}]`);
      } else if (info.coveredByOfficerName) {
        // Absent with named cover — use covering officer
        effectiveCrew.push(info.coveredByOfficerName);
      }
      // Absent without cover → empty slot
    }

    if (effectiveCrew.length > 0 && SHIFTS.has(unitDuty)) {
      const line = `${unitCode} ${vehicle}: ${effectiveCrew.join(" & ")} (${unitDuty})`;
      if (isBlock1) block1Lines.push(line);
      else block2Lines.push(line);
    }
  }

  // Leave lines: one per officer, unit order
  for (const unitCode of sortedUnits) {
    for (const info of unitMap.get(unitCode)!) {
      if (info.icLeave) {
        leaveLines.push(`${info.officer.name} (${info.targetDuty}/${info.icLeave.leaveType})`);
      } else if (ABSENT_DUTY_SET.has(info.actualDuty) && !info.crossPostedToUnit) {
        leaveLines.push(`${info.officer.name} (${info.targetDuty}/${info.actualDuty})`);
      }
    }
  }

  // Deployed count: count individual names across all deployed unit lines
  const allLines = [...block1Lines, ...block2Lines];
  const countPD  = allLines.filter((l) => l.endsWith("(PD)")).length;
  const countDAY = allLines.filter((l) => l.endsWith("(DAY)")).length;
  const deployedTotal = allLines.reduce((n, l) => {
    const m = l.match(/: (.+) \(\w+\)$/);
    return n + (m ? m[1].split(" & ").length : 0);
  }, 0);
  // Minimum strength: weekday = weekdayMinStrength (configured, default 40
  // per the Replit source this was ported from); weekend/PH =
  // (weekendPD + weekendDAY) × 2 (defaults 3 + 3 → 12).
  const wkPD = config.weekendPD ?? 3;
  const wkDAY = config.weekendDAY ?? 3;
  const wkMin = config.weekdayMinStrength ?? 40;
  const minStrength = isWeekend ? (wkPD + wkDAY) * 2 : wkMin;

  const SEP = "----------------------------------------------";

  return [
    SEP,
    "FIRB Deployment",
    `Date: ${dateLabel}`,
    `Strength:${deployedTotal}/${minStrength}`,
    "OT:,,",
    SEP,
    ...block1Lines,
    SEP,
    ...block2Lines,
    SEP,
    "OFF",
    ...offNames,
    SEP,
    "LEAVE",
    ...leaveLines,
    SEP,
    SEP,
  ].join("\n");
}

// Declare SHIFTS at module scope for reuse
const SHIFTS = new Set(["DAY", "PD", "ND"]);

// ── Router ────────────────────────────────────────────────────────────────────
export const rosterPlanRouter = Router();

// GET /api/roster-plan/config
rosterPlanRouter.get("/roster-plan/config", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const config = await loadConfig();
  const targetMonday = getMondayOf(new Date());
  const currentWeek = computeCycleWeek(config.cycleStartDate, targetMonday, config.teamCount);
  res.json({ ...config, currentWeek });
});

// PUT /api/roster-plan/config
rosterPlanRouter.put("/roster-plan/config", requireManager, async (req, res) => {
  const { teamCount, cycleStartDate, maintenanceVehicles, weekendPD, weekendDAY, weekdayMinStrength } = req.body as {
    teamCount: number;
    cycleStartDate: string;
    maintenanceVehicles?: string[];
    weekendPD?: number;
    weekendDAY?: number;
    weekdayMinStrength?: number;
  };
  if (![20, 24, 28].includes(teamCount)) {
    return res.status(400).json({ error: "invalid teamCount" });
  }
  // Partial update semantics for the strength fields — an omitted field
  // keeps whatever was already saved (falling back to the same 3/3/40
  // defaults buildSummary() uses) rather than being reset, so a caller that
  // only wants to change teamCount doesn't accidentally blank these out.
  const existing = await loadConfig();
  const config: RosterConfigShape = {
    teamCount: teamCount as 20 | 24 | 28,
    cycleStartDate,
    maintenanceVehicles: Array.isArray(maintenanceVehicles) ? maintenanceVehicles : [],
    weekendPD: weekendPD ?? existing.weekendPD ?? 3,
    weekendDAY: weekendDAY ?? existing.weekendDAY ?? 3,
    weekdayMinStrength: weekdayMinStrength ?? existing.weekdayMinStrength ?? 40,
  };
  await saveConfig(config);
  const targetMonday = getMondayOf(new Date());
  const currentWeek = computeCycleWeek(config.cycleStartDate, targetMonday, config.teamCount);
  return res.json({ ...config, currentWeek });
});

// GET /api/roster-plan/officers
rosterPlanRouter.get("/roster-plan/officers", async (_req, res) => {
  res.json(await loadOfficers());
});

// GET /api/roster-plan/officer-names
// Deduplicated, sorted {id, name, unitCode?, catchment?} list — a lighter
// picker source than the full officers list for UI dropdowns. Excludes
// blank names and generic placeholders ("Crew 1", "Crew 2", …).
// NOTE: the Replit original also merged in every officer name ever saved in
// a roster-pattern (a second source, for names that only exist in a
// historical pattern, not the live officers table) — that source doesn't
// exist here yet since roster-patterns hasn't been ported (see the
// capability-parity plan's Phase C). Add it back here once it lands.
rosterPlanRouter.get("/roster-plan/officer-names", async (_req, res) => {
  const seen = new Set<string>();
  const result: { id: string; name: string; unitCode?: string; catchment?: string }[] = [];

  for (const o of await loadOfficers()) {
    const trimmed = o.name.trim();
    if (!trimmed) continue;
    if (/^crew\s*\d+$/i.test(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: o.id,
      name: trimmed,
      ...(o.unitCode ? { unitCode: o.unitCode } : {}),
      ...(o.catchment ? { catchment: o.catchment } : {}),
    });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  res.json(result);
});

// ── Roster requirements notice ──────────────────────────────────────────────
// Ported from Replit's roster-requirements.json — seed text matches verbatim.
const DEFAULT_REQUIREMENTS = `"Roster Requirements"

To build up the roster, a shift pattern consisting of a rotation of shift duties is arranged to meet both the (1) operational needs for flood operations, and (2) requirements stated under MOM and PUB's HR Personnel Manual for shift staff.

"1. Regulatory Compliance"

_1A. Hours of Work (MOM & PUB HR Personnel Manual)_
- The average weekly working hours over a complete shift cycle must not exceed 42 hours, excluding overtime.
- Over a 20-week cycle, every 1 week of 48-hour work is balanced by 3 weeks of 40-hour work, repeated 5 times. This was derived through discussion with the crew and results in a monthly average of 42 hours [(48 + 3 × 40) ÷ 4].

_1B. OFF and REST Days (MOM)_
- The maximum number of consecutive working days for an 8-hour shift is 7 days.
- Where both OFF and REST days fall in the same calendar week, the OFF day must come before the REST day, with only 1 REST day permitted per calendar week.
- OFF days are placed within ND weeks to ensure the limit is not exceeded, and PD/DAY shifts are rotated between ND weeks accordingly.

"2. Operational Requirements"

_2A. Daily Operational Requirement_
- The number of PD and DAY shifts is guided by management, with more afternoon than morning coverage needed — 4 PD and 8 DAY on weekdays, and 3 PD and 3 DAY on weekends.
- Each officer covers 12 weekend shifts per cycle, distributed across 5 months.

_2B. Leave Application_
- Sufficient ND shifts must be available throughout the year to support leave-taking.
- 8 weeks of ND slots are placed in between PD/DAY shifts to allow for longer periods of leave.

_2C. Operational Expansion_
- The roster must be able to accommodate an increase in PD and DAY shifts if required.
- The 8 ND weeks provide 40 available days per cycle for leave-taking without affecting operations, amounting to 104 days per year.

"3. Staff Wellbeing"

_3A. Back-to-Back Shift Limits_
- Shift duties are structured to avoid being too exhausting for officers.
- Back-to-back weekday PD/DAY shifts are set at a minimum of 2 and a maximum of 3.
- A minimum of 1 and maximum of 2 was considered but rejected as it would reduce ND shifts available for leave-taking.

"4. Fairness and Parity"

_4A. Parity Across Shift Teams (PUB HR Personnel Manual)_
- Every officer must be scheduled an equal number of morning and afternoon shifts over a complete shift cycle.
- All teams follow the same 20-week roster pattern but start on a different week, ensuring equal distribution of shift types across all teams.

"5. Future Planning"

_5A. Manpower Expansion_
- The roster is expandable in multiples of 4 teams (8 personnel), constrained by MOM's average hours requirement.
- Expansion requires the 42-hour average work week condition to be maintained (via a 4-week expansion block) and the number of weeks in the cycle to remain equal to the number of teams.`;

// GET /api/roster-requirements — get requirements text (public)
rosterPlanRouter.get("/roster-requirements", async (_req, res) => {
  const [row] = await db.select().from(rosterRequirementsTable).where(eq(rosterRequirementsTable.id, 1));
  res.json({ text: row?.text ?? DEFAULT_REQUIREMENTS });
});

// PUT /api/roster-requirements — save requirements text (manager+)
rosterPlanRouter.put("/roster-requirements", requireManager, async (req, res) => {
  const { text } = req.body as { text?: string };
  if (typeof text !== "string") { res.status(400).json({ error: "text string required" }); return; }
  await db
    .insert(rosterRequirementsTable)
    .values({ id: 1, text })
    .onConflictDoUpdate({ target: rosterRequirementsTable.id, set: { text } });
  res.json({ ok: true });
});

// POST /api/roster-plan/officers
rosterPlanRouter.post("/roster-plan/officers", requireManager, async (req, res) => {
  const [officer] = await db
    .insert(officersTable)
    .values({ id: randomUUID(), ...req.body })
    .returning();
  res.json(officer);
});

// PUT /api/roster-plan/officers/:id
rosterPlanRouter.put("/roster-plan/officers/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const [officer] = await db
    .update(officersTable)
    .set({ ...req.body, id })
    .where(eq(officersTable.id, id))
    .returning();
  if (!officer) return res.status(404).json({ error: "not found" });
  return res.json(officer);
});

// DELETE /api/roster-plan/officers/:id
// Soft-delete (deactivate) rather than a hard DELETE — officersTable.id is
// referenced (RESTRICT) by managers, leaveRequests, rosterLeaves, rosterSwaps,
// rosterOverrides, rosterDayOverrides, pushSubscriptions, and
// phRosterOverrides, so a hard delete would either be blocked by that history
// or destroy it. Deactivated officers are excluded from future roster/PH
// generation (see officersInRotation filters) but keep all history intact and
// can be reactivated later via the same PUT endpoint.
rosterPlanRouter.delete("/roster-plan/officers/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const [officer] = await db
    .update(officersTable)
    .set({ active: false })
    .where(eq(officersTable.id, id))
    .returning({ id: officersTable.id });
  if (!officer) return res.status(404).json({ error: "not found" });
  return res.json({ success: true, message: "Officer deactivated" });
});

// GET /api/roster-plan/schedule?date=ISO
rosterPlanRouter.get("/roster-plan/schedule", async (req, res) => {
  res.set("Cache-Control", "no-store");
  await ensureCycleCacheLoaded();
  const config = await loadConfig();
  const officers = await loadOfficers();

  const dateParam = req.query.date as string | undefined;
  const referenceDate = dateParam ? new Date(dateParam) : new Date();
  const monday = getMondayOf(referenceDate);
  const cycleWeek = computeCycleWeek(config.cycleStartDate, monday, config.teamCount);

  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  const overrides = await loadOverridesForDates(weekDates);
  const leaves = await loadLeavesForDates(weekDates);

  // Reverse lookup: officer name (lower/trim) → who they're covering for, per date.
  // Leave applications only record the covering officer on the ABSENT officer's own
  // entry (coveringOfficerName); without this reverse map the covering officer's own
  // schedule row never reflects that they've left their post.
  const coveringForByDate = new Map<string, Map<string, { name: string; unitCode: string }>>();
  for (const l of leaves) {
    if (!l.coveringOfficerName) continue;
    const absentOfficer = officers.find((o) => o.id === l.officerId);
    if (!absentOfficer) continue;
    const key = l.coveringOfficerName.trim().toLowerCase();
    if (!coveringForByDate.has(l.date)) coveringForByDate.set(l.date, new Map());
    coveringForByDate.get(l.date)!.set(key, { name: absentOfficer.name, unitCode: absentOfficer.unitCode });
  }

  const officersInRotation = officers.filter((o) => o.active && o.teamSlot <= config.teamCount);

  const duties = officersInRotation.flatMap((officer) => {
    return weekDates.map((dateStr, dayIdx) => {
      const day = DAYS_ORDER[dayIdx];
      const override = overrides.find((o) => o.officerId === officer.id && o.date === dateStr);
      const leaveEntry = leaves.find((l) => l.officerId === officer.id && l.date === dateStr);
      const computed = getDutyFromCycle(officer.unitCode, dateStr) ?? getDutyForSlotInWeek(officer.teamSlot, cycleWeek, day, config.teamCount);
      // Covering-for: must be resolved before effectiveDuty so the covering officer
      // shows the covered unit's shift duty rather than their home cycle duty.
      const coveringFor = coveringForByDate.get(dateStr)?.get(officer.name.trim().toLowerCase());
      // Priority: manual override > own leave > covering-for (auto shift) > home cycle.
      // A cover override (coverForOfficerId) already stores the right duty; if none
      // exists (e.g. cycle data was empty when leave was applied), fall back to
      // getDutyFromCycle on the covered unit — same data source, so it's always
      // consistent with targetDuty.
      const effectiveDuty = override
        ? override.duty
        : leaveEntry
          ? leaveEntry.leaveType
          : coveringFor
            ? (getDutyFromCycle(coveringFor.unitCode, dateStr) ?? computed)
            : computed;
      // If an old override stored a unit code in coveredByOfficerName, treat it as crossPostedToUnit
      const UNIT_CODE_RE = /^[A-Z]{2}\d{1,2}$/;
      const rawCovered = override?.coveredByOfficerName ?? null;
      const isCoveredUnitCode = rawCovered ? UNIT_CODE_RE.test(rawCovered) : false;
      // targetDuty = the officer's SCHEDULED (cycle) duty, used for the unit badge.
      // For shift-change overrides (swap, cross-post, OT), override.targetDuty records
      // the home duty — preserve it.  For leave codes (SL/VL/MC/etc.) the stored
      // override.targetDuty may be stale (e.g. "OFF" from a prior import), so always
      // fall back to the live cycle value so the badge correctly shows "ND"/"DAY"/"PD".
      const SCHEDULE_SHIFT_CODES = new Set(["ND","DAY","PD","OFF","REST","OIL"]);
      const targetDuty = SCHEDULE_SHIFT_CODES.has(effectiveDuty)
        ? (override?.targetDuty || computed)
        : computed;
      return {
        officerId: officer.id,
        date: dateStr,
        duty: effectiveDuty,
        targetDuty,
        crossPostedToUnit: override?.crossPostedToUnit ?? (isCoveredUnitCode ? rawCovered : null),
        override: !!override,
        onLeave: !!leaveEntry,
        coveredByOfficerName: isCoveredUnitCode ? (leaveEntry?.coveringOfficerName ?? null) : (rawCovered ?? leaveEntry?.coveringOfficerName ?? null),
        vehicle: override?.vehicle ?? null,
        overtimeHours: override?.overtimeHours ?? null,
        swappedWithOfficerName: override?.swappedWithOfficerName ?? null,
        coveringForOfficerName: coveringFor?.name ?? null,
        coveringForUnit: coveringFor?.unitCode ?? null,
        comment: override?.comment ?? null,
      };
    });
  });

  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const weekLabel = `${monday.toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "UTC" })} – ${sunday.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;

  res.json({ weekLabel, cycleWeek, startDate: weekDates[0], endDate: weekDates[6], officers: officersInRotation, duties });
});

// ── Leave endpoints ───────────────────────────────────────────────────────────

// GET /api/roster-plan/leave?date=YYYY-MM-DD
rosterPlanRouter.get("/roster-plan/leave", requireManager, async (req, res) => {
  const date = req.query.date as string | undefined;
  const leaves = date
    ? await db.select().from(rosterLeavesTable).where(eq(rosterLeavesTable.date, date))
    : await loadAllLeaves();
  res.json(leaves);
});

// POST /api/roster-plan/leave
rosterPlanRouter.post("/roster-plan/leave", requireManager, async (req, res) => {
  const { officerId, date, leaveType, coveringOfficerId } = req.body as {
    officerId: string; date: string; leaveType: string; coveringOfficerId?: string;
  };
  const officers = await loadOfficers();
  const officer = officers.find((o) => o.id === officerId);
  if (!officer) return res.status(404).json({ error: "Officer not found" });

  if (coveringOfficerId && coveringOfficerId === officerId) {
    return res.status(400).json({ error: "An officer cannot cover their own leave" });
  }

  const coverOfficer = coveringOfficerId ? officers.find((o) => o.id === coveringOfficerId) : undefined;
  if (coveringOfficerId && !coverOfficer) return res.status(404).json({ error: "Cover officer not found" });
  const coveringOfficerName = coverOfficer?.name;

  // Cover-officer validation — without this, a manager could apply DAY/PD
  // leave with no cover at all (a silently unfilled shift), or assign a
  // cover officer who is themselves working, already on leave, or already
  // covering someone else that date. Found via a Replit-resync diff triage
  // (.scratch/replit-resync-2026-09-21/issues/03).
  {
    const config = await loadConfig();
    const [overrideRows, leaveRows] = await Promise.all([loadOverridesForDates([date]), loadLeavesForDates([date])]);
    const overridesForDate = new Map(overrideRows.map((o) => [o.officerId, o]));
    const leavesForDate = new Map(leaveRows.map((l) => [l.officerId, l]));
    const utcDay = new Date(date + "T00:00:00Z").getUTCDay();
    const isWeekend = utcDay === 0 || utcDay === 6;
    const absentDuty = getOfficerEffectiveDutyForDate(officer, date, overridesForDate, leavesForDate, config).duty;

    if (!coverOfficer && (absentDuty === "DAY" || absentDuty === "PD")) {
      return res.status(400).json({ error: "A cover officer is required for DAY/PD duty" });
    }

    if (coverOfficer) {
      const coverDuty = getOfficerEffectiveDutyForDate(coverOfficer, date, overridesForDate, leavesForDate, config).duty;
      const eligible = isWeekend
        ? coverDuty === "OFF" || coverDuty === "REST"
        : coverDuty === "ND" || coverDuty === "OFF";
      if (!eligible) {
        return res.status(400).json({
          error: `${coverOfficer.name} is not available to cover on ${date} (scheduled ${coverDuty})`,
        });
      }
      const [selfOnLeave] = await db
        .select({ id: rosterLeavesTable.id })
        .from(rosterLeavesTable)
        .where(and(eq(rosterLeavesTable.date, date), eq(rosterLeavesTable.officerId, coverOfficer.id)));
      if (selfOnLeave) {
        return res.status(409).json({ error: `${coverOfficer.name} is already on leave on ${date}` });
      }
      const [alreadyCovering] = await db
        .select({ id: rosterLeavesTable.id })
        .from(rosterLeavesTable)
        .where(
          and(
            eq(rosterLeavesTable.date, date),
            eq(rosterLeavesTable.coveringOfficerId, coverOfficer.id),
            ne(rosterLeavesTable.officerId, officerId),
          ),
        );
      if (alreadyCovering) {
        return res.status(409).json({ error: `${coverOfficer.name} is already covering another officer on ${date}` });
      }
    }
  }

  // Resolve who is applying — used for the activity-log entry below.
  const applierMid    = req.session?.managerId;
  const applier       = applierMid ? getManager(applierMid) : null;
  const appliedByName = applier?.officerName ?? applier?.username;

  // Checked before the upsert so the activity-log entry below only fires on a
  // genuinely new application, not every time an existing leave is edited —
  // matches Replit's behavior (its JSON array had an explicit new-vs-update
  // branch for exactly this reason).
  const [existingLeave] = await db
    .select({ id: rosterLeavesTable.id })
    .from(rosterLeavesTable)
    .where(and(eq(rosterLeavesTable.officerId, officerId), eq(rosterLeavesTable.date, date)));
  const isNewLeave = !existingLeave;

  // Remove any stale UploadBrief-managed override for this officer on this date so
  // the leave entry takes proper effect and is never masked by an old schedule import.
  await db
    .delete(rosterOverridesTable)
    .where(
      and(
        eq(rosterOverridesTable.officerId, officerId),
        eq(rosterOverridesTable.date, date),
        isNull(rosterOverridesTable.coverForOfficerId),
      ),
    );

  const [entry] = await db
    .insert(rosterLeavesTable)
    .values({
      id: randomUUID(),
      officerId,
      officerName: officer.name,
      date,
      leaveType,
      coveringOfficerId: coveringOfficerId ?? null,
      coveringOfficerName: coveringOfficerName ?? null,
      // Set on first write only — deliberately absent from onConflictDoUpdate's
      // `set` below so a later edit/re-import never overwrites who originally
      // applied the leave (see the schema's own comment on this column). Was
      // missing entirely before this fix, despite the schema already
      // supporting it — .scratch/replit-resync-2026-09-21/issues/04.
      appliedBy: appliedByName ?? null,
      appliedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [rosterLeavesTable.officerId, rosterLeavesTable.date],
      set: { leaveType, coveringOfficerId: coveringOfficerId ?? null, coveringOfficerName: coveringOfficerName ?? null },
    })
    .returning();

  if (isNewLeave) {
    await appendActivityLog({
      type: "leave-applied",
      title: `Leave applied for ${officer.name}`,
      body: `${leaveType} on ${date}${appliedByName ? ` (by ${appliedByName})` : ""}`,
      createdAt: new Date(),
      officerId,
      officerName: officer.name,
      leaveDate: date,
      leaveType,
      appliedByName: appliedByName ?? null,
      patternName: null,
      implementDate: null,
      implementerName: null,
    });
  }

  // Set the covering officer's duty override so they appear as working the covered
  // unit's scheduled shift (e.g. DAY) rather than their own home cycle duty (e.g. REST).
  if (coverOfficer) {
    await ensureCycleCacheLoaded();
    const scheduledDuty = getDutyFromCycle(officer.unitCode, date);
    if (scheduledDuty && scheduledDuty !== "OFF" && scheduledDuty !== "REST") {
      await db
        .insert(rosterOverridesTable)
        .values({ officerId: coverOfficer.id, date, duty: scheduledDuty, coverForOfficerId: officer.id })
        .onConflictDoUpdate({
          target: [rosterOverridesTable.officerId, rosterOverridesTable.date],
          set: { duty: scheduledDuty, coverForOfficerId: officer.id },
        });
    }
  }

  return res.json(entry);
});

// DELETE /api/roster-plan/leave/:id
rosterPlanRouter.delete("/roster-plan/leave/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const deleted = await db
    .delete(rosterLeavesTable)
    .where(eq(rosterLeavesTable.id, id))
    .returning();
  if (deleted.length === 0) return res.status(404).json({ error: "not found" });
  const [entry] = deleted;
  // Also remove the auto-generated cover override so the covering officer reverts
  // to their home cycle duty when the leave is cleared.
  if (entry.coveringOfficerId) {
    await db
      .delete(rosterOverridesTable)
      .where(
        and(
          eq(rosterOverridesTable.officerId, entry.coveringOfficerId),
          eq(rosterOverridesTable.date, entry.date),
          isNotNull(rosterOverridesTable.coverForOfficerId),
        ),
      );
  }
  return res.json({ success: true, message: "Leave entry deleted" });
});

// GET /api/activity-log — in-app notification feed (all roles including crew)
rosterPlanRouter.get("/activity-log", requireManager, async (req, res) => {
  const mid    = req.session?.managerId;
  const caller = mid ? getManager(mid) : null;
  const log    = await getActivityLog();
  if (caller?.role === "crew") {
    // Crew: only see roster-implement events + leave events for their own officer
    const myOfficerId = caller.officerId;
    const filtered = log.filter((e) =>
      e.type === "roster-implement" ||
      (e.type === "leave-applied" && e.officerId === myOfficerId)
    );
    res.json(filtered);
  } else {
    // Admin / Manager / IC: see everything (most recent 50, already ordered by getActivityLog)
    res.json(log);
  }
});

// ── Summary endpoint ──────────────────────────────────────────────────────────

// GET /api/roster-plan/summary?date=YYYY-MM-DD
rosterPlanRouter.get("/roster-plan/summary", async (req, res) => {
  res.set("Cache-Control", "no-store");
  await ensureCycleCacheLoaded();
  const config = await loadConfig();
  const officers = await loadOfficers();

  const dateParam = req.query.date as string | undefined;
  const dateStr = dateParam ?? new Date().toISOString().slice(0, 10);

  const overrides = await loadOverridesForDates([dateStr]);
  const leaves = await loadLeavesForDates([dateStr]);
  const officerVehicleMap = await resolveOfficerVehicleMap(dateStr);

  const officersInRotation = officers.filter((o) => o.active && o.teamSlot <= config.teamCount);
  const text = buildSummary(dateStr, officersInRotation, config, overrides, leaves, officerVehicleMap);
  res.json({ date: dateStr, text });
});

// ── Swaps endpoints ───────────────────────────────────────────────────────────

rosterPlanRouter.get("/roster-plan/swaps", async (req, res) => {
  const status = req.query.status as string | undefined;
  const swaps = status
    ? await db.select().from(rosterSwapsTable).where(eq(rosterSwapsTable.status, status)).orderBy(desc(rosterSwapsTable.createdAt))
    : await loadSwaps();
  res.json(swaps);
});

rosterPlanRouter.post("/roster-plan/swaps", requireManager, async (req, res) => {
  const mid = req.session?.managerId;
  const caller = mid ? getManager(mid) : null;

  const { requesterId, targetId, date, reason } = req.body as {
    requesterId: string; targetId: string; date: string; reason: string;
  };

  await ensureCycleCacheLoaded();
  const officers = await loadOfficers();
  const config = await loadConfig();
  const requester = officers.find((o) => o.id === requesterId);
  const target = officers.find((o) => o.id === targetId);
  if (!requester || !target) return res.status(404).json({ error: "Officer not found" });

  const d = new Date(date);
  const dayName = DAYS_ORDER[d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1];
  const monday = getMondayOf(d);
  const cycleWeek = computeCycleWeek(config.cycleStartDate, monday, config.teamCount);

  // Read effective duties (override > leave > cycle) BEFORE touching the overrides
  const [existingOverrides, existingLeaves] = await Promise.all([
    db.select().from(rosterOverridesTable).where(eq(rosterOverridesTable.date, date)),
    db.select().from(rosterLeavesTable).where(eq(rosterLeavesTable.date, date)),
  ]);
  const getEffective = (id: string, cycleDuty: string): string => {
    const ov = existingOverrides.find((o) => o.officerId === id);
    if (ov) return ov.duty;
    const lv = existingLeaves.find((l) => l.officerId === id);
    if (lv) return lv.leaveType;
    return cycleDuty;
  };
  const requesterDuty = getEffective(requesterId, getDutyFromCycle(requester.unitCode, date) ?? getDutyForSlotInWeek(requester.teamSlot, cycleWeek, dayName, config.teamCount));
  const targetDuty    = getEffective(targetId,    getDutyFromCycle(target.unitCode,    date) ?? getDutyForSlotInWeek(target.teamSlot,    cycleWeek, dayName, config.teamCount));

  const swap: RosterSwap = {
    id: randomUUID(),
    requesterId, requesterName: requester.name,
    targetId, targetName: target.name,
    date, requesterDuty, targetDuty, reason,
    status: "APPROVED", reviewerName: caller?.officerName ?? caller?.username ?? null,
    createdAt: new Date(), reviewedAt: new Date(),
    type: null, phName: null,
  };

  await db.transaction(async (tx) => {
    // Immediately apply overrides for BOTH officers — each gets the other's duty
    await tx
      .delete(rosterOverridesTable)
      .where(
        and(
          inArray(rosterOverridesTable.officerId, [requesterId, targetId]),
          eq(rosterOverridesTable.date, date),
        ),
      );
    await tx.insert(rosterOverridesTable).values([
      { officerId: requesterId, date, duty: targetDuty, swappedWithOfficerName: target.name },
      { officerId: targetId, date, duty: requesterDuty, swappedWithOfficerName: requester.name },
    ]);
    await tx.insert(rosterSwapsTable).values(swap);
  });

  return res.json(swap);
});

rosterPlanRouter.put("/roster-plan/swaps/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const { approved, reviewerName } = req.body as { approved: boolean; reviewerName: string };
  const [swap] = await db
    .update(rosterSwapsTable)
    .set({ status: approved ? "APPROVED" : "REJECTED", reviewerName, reviewedAt: new Date() })
    .where(eq(rosterSwapsTable.id, id))
    .returning();
  if (!swap) return res.status(404).json({ error: "not found" });

  if (approved) {
    const officers = await loadOfficers();
    const requester = officers.find((o) => o.id === swap.requesterId);
    const target = officers.find((o) => o.id === swap.targetId);
    if (requester && target) {
      await db.transaction(async (tx) => {
        await tx
          .delete(rosterOverridesTable)
          .where(
            and(
              inArray(rosterOverridesTable.officerId, [swap.requesterId, swap.targetId]),
              eq(rosterOverridesTable.date, swap.date),
            ),
          );
        await tx.insert(rosterOverridesTable).values([
          { officerId: swap.requesterId, date: swap.date, duty: swap.targetDuty, swappedWithOfficerName: target.name },
          { officerId: swap.targetId, date: swap.date, duty: swap.requesterDuty, swappedWithOfficerName: requester.name },
        ]);
      });
    }
  }

  return res.json(swap);
});

rosterPlanRouter.delete("/roster-plan/swaps/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const deleted = await db.delete(rosterSwapsTable).where(eq(rosterSwapsTable.id, id)).returning();
  if (deleted.length === 0) return res.status(404).json({ error: "not found" });
  const [target] = deleted;

  // Always revert duty overrides for both officers — overrides are written on swap creation,
  // not just on approval, so they exist for PENDING and REJECTED swaps too.
  await db
    .delete(rosterOverridesTable)
    .where(
      and(
        inArray(rosterOverridesTable.officerId, [target.requesterId, target.targetId]),
        eq(rosterOverridesTable.date, target.date),
      ),
    );

  return res.json({ success: true, message: "Swap deleted" });
});

// ── Day Override Events ───────────────────────────────────────────────────────

const OVERRIDE_DUTY_SET = new Set([
  "ND","DAY","PD","OFF","REST","TO","VL","SL","OIL","FCL","NS","CCL",
  "AMTO","PMTO","AMMA","PMMA","UL","ML","BL","CSL","SPL","PPTW",
]);

// Leave/absence codes that should create a corresponding leave entry when used as an override
const OVERRIDE_LEAVE_SET = new Set([
  "AMC","AMMA","AMOVL","AMTO","BL","C","CCL","CSL","FCL","HL",
  "MA","MC","ML","NS","OIL","OVL","PCL","PMC","PMMA","PMOVL","PMTO",
  "PPTW","SL","SLWOMC","SPL","TO","UL","VL",
]);

// POST /api/roster-plan/overrides/bulk — visual editor bulk-save
rosterPlanRouter.post("/roster-plan/overrides/bulk", requireManager, async (req, res) => {
  const { date, overrides: entries } = req.body as {
    date: string;
    overrides: Array<{
      officerId: string;
      duty: string;
      coveredByOfficerName?: string;
      crossPostedToUnit?: string;
      targetDuty?: string;
      vehicle?: string;
      overtimeHours?: string;
      comment?: string;
    }>;
  };
  if (!date || !Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: "date and overrides[] required" });
    return;
  }

  // Resolve who is making this edit
  const mid = req.session?.managerId;
  const caller = mid ? getManager(mid) : null;
  const madeBy     = caller?.username;
  const madeByName = caller?.officerName ?? caller?.username;
  const madeAt     = new Date();

  const officerIds = [...new Set(entries.map((e) => e.officerId))];
  const allOfficers = await loadOfficers();
  const officerMap = new Map(allOfficers.map((o) => [o.id, o]));

  await db.transaction(async (tx) => {
    // Save duty overrides
    await tx
      .delete(rosterOverridesTable)
      .where(and(inArray(rosterOverridesTable.officerId, officerIds), eq(rosterOverridesTable.date, date)));
    await tx.insert(rosterOverridesTable).values(
      entries.map((e) => ({
        officerId: e.officerId,
        date,
        duty: e.duty,
        coveredByOfficerName: e.coveredByOfficerName ?? null,
        crossPostedToUnit: e.crossPostedToUnit ?? null,
        targetDuty: e.targetDuty ?? null,
        vehicle: e.vehicle ?? null,
        overtimeHours: e.overtimeHours ?? null,
        comment: e.comment ?? null,
        madeBy: madeBy ?? null,
        madeByName: madeByName ?? null,
        madeAt,
      })),
    );

    // Sync leave entries: leave code → upsert; non-leave → remove override-sourced entry
    for (const e of entries) {
      if (OVERRIDE_LEAVE_SET.has(e.duty)) {
        const officerName = officerMap.get(e.officerId)?.name ?? e.officerId;
        await tx
          .insert(rosterLeavesTable)
          .values({
            id: randomUUID(),
            officerId: e.officerId,
            officerName,
            date,
            leaveType: e.duty,
            coveringOfficerName: e.coveredByOfficerName ?? null,
            coveringOfficerId: null,
            source: "override",
          })
          .onConflictDoUpdate({
            target: [rosterLeavesTable.officerId, rosterLeavesTable.date],
            set: { leaveType: e.duty, coveringOfficerName: e.coveredByOfficerName ?? null, coveringOfficerId: null, source: "override" },
          });
      } else {
        // Excel > Master is the authoritative record — clear ALL leaves for this officer
        // on this date (regardless of source) when a non-leave duty is explicitly set.
        await tx
          .delete(rosterLeavesTable)
          .where(and(eq(rosterLeavesTable.officerId, e.officerId), eq(rosterLeavesTable.date, date)));
      }
    }
  });

  res.json({ applied: entries.length });
});

// POST /api/roster-plan/ph-extract-sunday/:date — OIL Monday: extract preceding Sunday's
// target roster (DAY/PD officers) and save as ph-roster-ref rows for the in-lieu date.
rosterPlanRouter.post("/roster-plan/ph-extract-sunday/:date", requireManager, async (req, res) => {
  const { date } = req.params as { date: string };

  const oilDate = new Date(date + "T00:00:00Z");
  if (oilDate.getUTCDay() !== 1) {
    res.status(400).json({ error: "Date must be a Monday (OIL day)." });
    return;
  }

  // Preceding Sunday
  const sundayDate = new Date(oilDate.getTime() - 24 * 60 * 60 * 1000);
  const sundayStr = sundayDate.toISOString().slice(0, 10);

  // Copy the Sunday's ph-roster-ref rows to the OIL Monday date.
  // The OIL roster = same officers who worked PH on Sunday (they earned OIL).
  const sundayRows = await db
    .select()
    .from(phRosterRefTable)
    .where(eq(phRosterRefTable.date, sundayStr));

  if (sundayRows.length === 0) {
    res.status(404).json({ error: `No PH roster found for ${sundayStr}. Configure Sunday's PH roster first.` });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(phRosterRefTable).where(eq(phRosterRefTable.date, date));
    await tx.insert(phRosterRefTable).values(
      sundayRows.map((row) => ({
        date,
        rowIndex: row.rowIndex,
        subCatchment: row.subCatchment,
        shift: row.shift,
        scheduledName: row.scheduledName,
        actualName: row.actualName,
        remarks: row.remarks,
      })),
    );
  });

  res.json({ ok: true, extractedCount: sundayRows.length, sundayDate: sundayStr });
});

// ── Shared PH-apply logic ────────────────────────────────────────────────────
// Applies PH ref roster duties as Master overrides, idempotent. Exported so
// phRoster.ts's PUT /ph-roster-ref/:date can call it directly after saving
// ref rows — the save and the Master-override sync happen atomically in one
// request, instead of requiring a second frontend call to
// POST /roster-plan/ph-apply/:date (which still exists too, for a manual
// re-apply without re-saving the roster).
export async function applyPHRoster(
  date: string,
  madeBy?: string | null,
  madeByName?: string | null,
  options?: { isOilMonday?: boolean },
): Promise<{ applied: number; phDutyCount: number; oilCount: number } | { error: string }> {
  const refRows = await db.select().from(phRosterRefTable).where(eq(phRosterRefTable.date, date));
  if (refRows.length === 0) {
    return { error: "No PH roster data found for this date. Generate the PH roster first." };
  }

  const referenceDate = new Date(date + "T00:00:00Z");

  // OIL Monday = PH fell on the preceding Sunday → following Monday is the
  // statutory OIL day. A bare "is it a Monday" check would mislabel a
  // genuine Monday PH (e.g. National Day landing on a Monday) as OIL — only
  // treat it as OIL Monday if the preceding Sunday itself has ph-roster-ref
  // rows, or the caller explicitly says so (the PH page knows this without
  // needing the Sunday rows to still exist).
  let isOilMonday = options?.isOilMonday;
  if (isOilMonday === undefined) {
    const sundayOfOil = new Date(referenceDate.getTime() - 24 * 60 * 60 * 1000);
    const sundayOfOilStr = sundayOfOil.toISOString().slice(0, 10);
    const sundayRows = await db
      .select({ date: phRosterRefTable.date })
      .from(phRosterRefTable)
      .where(eq(phRosterRefTable.date, sundayOfOilStr))
      .limit(1);
    isOilMonday = referenceDate.getUTCDay() === 1 && sundayRows.length > 0;
  }

  // Map: officer name (lowercase) → PH shift. Use actualName when set (the
  // officer who truly worked the PH) — fall back to scheduledName only when
  // actualName is absent/blank.
  const phDutyMap = new Map<string, string>();
  // A scheduled/actual mismatch is a cover relationship. Both sides of it
  // need a Master row written — the scheduled officer's row must show who
  // covered them, and the covering officer's row must show which unit they
  // covered (see CONTEXT.md's "one-directional fields, watch for it" note;
  // this was previously only ever written onto one side).
  const coveredByMap = new Map<string, string>();
  const coveringUnitMap = new Map<string, string>();
  for (const row of refRows) {
    const scheduledName = row.scheduledName?.trim() ?? "";
    const actualName = row.actualName?.trim() || scheduledName;
    if (actualName) phDutyMap.set(actualName.toLowerCase(), row.shift ?? "");

    if (!isOilMonday && scheduledName && actualName && scheduledName.toLowerCase() !== actualName.toLowerCase()) {
      coveredByMap.set(scheduledName.toLowerCase(), actualName);
      if (row.subCatchment) coveringUnitMap.set(actualName.toLowerCase(), row.subCatchment);
    }
  }

  await ensureCycleCacheLoaded();
  const config = await loadConfig();
  const officers = await loadOfficers();
  const officersInRotation = officers.filter(o => o.active && o.teamSlot <= config.teamCount);

  const monday = getMondayOf(referenceDate);
  const cycleWeek = computeCycleWeek(config.cycleStartDate, monday, config.teamCount);
  const dayOffset = Math.round((referenceDate.getTime() - monday.getTime()) / (24 * 60 * 60 * 1000));
  const day = DAYS_ORDER[dayOffset] ?? "Mon";
  const madeAt = new Date();

  const newOverrides: (typeof rosterOverridesTable.$inferInsert)[] = [];

  for (const officer of officersInRotation) {
    const targetDuty = getDutyFromCycle(officer.unitCode, date)
      ?? getDutyForSlotInWeek(officer.teamSlot, cycleWeek, day, config.teamCount);
    const nameLower = officer.name.trim().toLowerCase();
    const coveredBy = coveredByMap.get(nameLower) ?? null;
    const coveringUnit = coveringUnitMap.get(nameLower);
    const coverIsAwayFromHome = coveringUnit !== undefined && coveringUnit !== officer.unitCode;

    if (phDutyMap.has(nameLower)) {
      // OIL Monday: actual PH workers → OIL on Monday.
      // Normal PH: actual workers → their PH shift.
      const duty = isOilMonday ? "OIL" : phDutyMap.get(nameLower)!;
      newOverrides.push({
        officerId: officer.id, date, duty, targetDuty,
        crossPostedToUnit: coverIsAwayFromHome ? coveringUnit! : null,
        coveredByOfficerName: coveredBy,
        madeBy: madeBy ?? null, madeByName: madeByName ?? null, madeAt,
      });
    } else if (coveredBy || targetDuty === "DAY" || targetDuty === "PD" || targetDuty === "ND") {
      // A covered scheduled slot always needs a Master row, even if the
      // scheduled officer's own target was REST/OFF or they're also working
      // another PH slot elsewhere. Keep REST/OFF as-is in that case;
      // otherwise a non-ref officer on a working shift is OIL on the holiday.
      const duty = coveredBy && (targetDuty === "REST" || targetDuty === "OFF") ? targetDuty : "OIL";
      newOverrides.push({
        officerId: officer.id, date, duty, targetDuty,
        coveredByOfficerName: coveredBy,
        madeBy: madeBy ?? null, madeByName: madeByName ?? null, madeAt,
      });
    }
  }

  const officerMap = new Map(officersInRotation.map(o => [o.id, o]));

  await db.transaction(async (tx) => {
    // Fully replace overrides for this date (idempotent)
    await tx.delete(rosterOverridesTable).where(eq(rosterOverridesTable.date, date));
    if (newOverrides.length > 0) await tx.insert(rosterOverridesTable).values(newOverrides);

    // Sync leave records — clear override-sourced leaves for this date, then add OIL entries
    await tx
      .delete(rosterLeavesTable)
      .where(and(eq(rosterLeavesTable.date, date), eq(rosterLeavesTable.source, "override")));
    const oilLeaves = newOverrides
      .filter((o) => o.duty === "OIL")
      .map((o) => ({
        id: randomUUID(),
        officerId: o.officerId,
        officerName: officerMap.get(o.officerId)?.name ?? o.officerId,
        date,
        leaveType: "OIL",
        source: "override",
      }));
    if (oilLeaves.length > 0) await tx.insert(rosterLeavesTable).values(oilLeaves);
  });

  return { applied: newOverrides.length, phDutyCount: refRows.length, oilCount: newOverrides.filter(o => o.duty === "OIL").length };
}

// POST /api/roster-plan/ph-apply/:date — manual re-apply, without re-saving the ref roster.
rosterPlanRouter.post("/roster-plan/ph-apply/:date", requireManager, async (req, res) => {
  const { date } = req.params as { date: string };
  const mid = req.session?.managerId;
  const caller = mid ? getManager(mid) : null;

  const result = await applyPHRoster(date, caller?.username, caller?.officerName ?? caller?.username);
  if ("error" in result) {
    res.status(404).json(result);
    return;
  }
  res.json({ ok: true, ...result });
});

// GET /api/roster-plan/overrides — list all active visual-editor overrides
rosterPlanRouter.get("/roster-plan/overrides", requireManager, async (_req, res) => {
  const overrides = await loadAllOverrides();
  const officers = await loadOfficers();
  const officerMap = new Map(officers.map((o) => [o.id, o]));
  const result = overrides.map((ov) => {
    const officer = officerMap.get(ov.officerId);
    return {
      ...ov,
      officerName: officer?.name ?? ov.officerId,
      unitCode: officer?.unitCode ?? "",
      catchment: officer?.catchment ?? "",
    };
  });
  res.json(result);
});

// DELETE /api/roster-plan/overrides/:officerId/:date — undo a single officer's override
rosterPlanRouter.delete("/roster-plan/overrides/:officerId/:date", requireManager, async (req, res) => {
  const { officerId, date } = req.params as { officerId: string; date: string };
  await db
    .delete(rosterOverridesTable)
    .where(and(eq(rosterOverridesTable.officerId, officerId), eq(rosterOverridesTable.date, date)));
  await db
    .delete(rosterLeavesTable)
    .where(
      and(
        eq(rosterLeavesTable.officerId, officerId),
        eq(rosterLeavesTable.date, date),
        eq(rosterLeavesTable.source, "override"),
      ),
    );
  res.json({ success: true });
});

// DELETE /api/roster-plan/history/clear — clears the application log
// (leave-requests) only.
//
// Used to also support mode=all, which additionally wiped leaves + overrides
// + swaps system-wide — i.e. the actual committed roster data, for every
// officer and every date, with no backup and no confirmation beyond a
// client-side typed string. Removed entirely (not just tightened) per
// .scratch/replit-resync-2026-09-21/issues/19 — Replit's own team reached the
// same conclusion and removed the equivalent feature on their side. If a
// bulk-undo capability is ever needed again, it should be a real
// backup-before-delete flow, not an unconditional system-wide truncate.
rosterPlanRouter.delete("/roster-plan/history/clear", requireManager, async (req, res) => {
  const mid = req.session?.managerId;
  const caller = mid ? getManager(mid) : null;
  if (!caller || (caller.role !== "admin" && caller.role !== "manager")) {
    res.status(403).json({ error: "Admin or manager access required" });
    return;
  }

  await db.delete(leaveRequestsTable);
  res.json({ success: true });
});

rosterPlanRouter.get("/roster-plan/day-overrides", requireManager, async (_req, res) => {
  res.json(await loadDayOverrides());
});

rosterPlanRouter.post("/roster-plan/day-overrides", requireManager, async (req, res) => {
  const mid = req.session?.managerId;
  const caller = mid ? getManager(mid) : null;
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { date, text } = req.body as { date: string; text: string };
  if (!date || !text?.trim()) {
    res.status(400).json({ error: "date and text required" }); return;
  }

  const officers = (await loadOfficers()).filter(o => o.active && o.teamSlot && o.name);
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  const applied: { officerId: string; officerName: string; duty: string }[] = [];
  const seenIds = new Set<string>();

  for (const officer of officers) {
    if (seenIds.has(officer.id)) continue;
    const firstName = officer.name.split(/\s+/)[0].toLowerCase();
    const fullName = officer.name.toLowerCase();
    for (const line of lines) {
      const ll = line.toLowerCase();
      if (ll.includes(fullName) || (firstName.length >= 3 && ll.includes(firstName))) {
        const words = line.toUpperCase().split(/[\s,:()/\-&|]+/);
        const duty = words.find(w => OVERRIDE_DUTY_SET.has(w));
        if (duty) {
          applied.push({ officerId: officer.id, officerName: officer.name, duty });
          seenIds.add(officer.id);
        }
        break;
      }
    }
  }

  const eventId = randomUUID();
  const submittedAt = new Date();

  await db.transaction(async (tx) => {
    // Write duty overrides for matched officers
    if (seenIds.size > 0) {
      await tx
        .delete(rosterOverridesTable)
        .where(and(inArray(rosterOverridesTable.officerId, [...seenIds]), eq(rosterOverridesTable.date, date)));
    }
    if (applied.length > 0) {
      await tx.insert(rosterOverridesTable).values(
        applied.map((a) => ({ officerId: a.officerId, date, duty: a.duty })),
      );
    }

    await tx.insert(rosterDayOverridesTable).values({
      id: eventId,
      date,
      text: text.trim(),
      submittedBy: caller.officerName ?? caller.username,
      submittedAt,
    });
    if (applied.length > 0) {
      await tx.insert(rosterDayOverrideApplicationsTable).values(
        applied.map((a) => ({ dayOverrideId: eventId, officerId: a.officerId, officerName: a.officerName, duty: a.duty })),
      );
    }
  });

  res.json({
    id: eventId,
    date,
    text: text.trim(),
    applied,
    submittedBy: caller.officerName ?? caller.username,
    submittedAt,
  });
});

rosterPlanRouter.delete("/roster-plan/day-overrides/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const [event] = await db
    .delete(rosterDayOverridesTable)
    .where(eq(rosterDayOverridesTable.id, id))
    .returning();
  if (!event) { res.status(404).json({ error: "not found" }); return; }

  // Remove the overrides that were applied by this event
  const applications = await db
    .select()
    .from(rosterDayOverrideApplicationsTable)
    .where(eq(rosterDayOverrideApplicationsTable.dayOverrideId, event.id));
  const appliedIds = [...new Set(applications.map((a) => a.officerId))];
  if (appliedIds.length > 0) {
    await db
      .delete(rosterOverridesTable)
      .where(and(inArray(rosterOverridesTable.officerId, appliedIds), eq(rosterOverridesTable.date, event.date)));
  }
  await db
    .delete(rosterDayOverrideApplicationsTable)
    .where(eq(rosterDayOverrideApplicationsTable.dayOverrideId, event.id));

  res.json({ success: true });
});

// ── Brief import ──────────────────────────────────────────────────────────────

// POST /api/roster-plan/import-brief
// Accepts a structured brief (parsed client-side) and writes overrides + leaves for the date.
// Read-before-write: only writes an override/leave when the incoming value
// differs from the officer's current effective state (override → leave →
// cycle → generator, via getOfficerEffectiveDutyForDate). An unchanged
// officer keeps their existing entry untouched — re-importing the same
// brief twice is a no-op for anyone who hasn't actually changed.
rosterPlanRouter.post("/roster-plan/import-brief", requireManager, async (req, res) => {
  const { date, assignments, off, leave } = req.body as {
    date: string;
    assignments?: Array<{
      unitCode: string;
      vehicle?: string;
      officers: string[];
      duty: string;
      coveringUnitCode?: string; // OT col was a unit code → cross-posted to this unit
    }>;
    off?: string[];
    leave?: Array<{
      name: string;
      targetDuty?: string;
      leaveType: string;
      coveringOfficerName?: string; // OT col was an officer name
      coveringUnitCode?: string;    // OT col was a unit code (rare for leave rows)
    }>;
  };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Invalid or missing date" }); return;
  }

  // Caller identity for "applied by" metadata on new leave entries.
  const callerMid = req.session?.managerId;
  const caller = callerMid ? getManager(callerMid) : null;
  const callerName = caller?.officerName ?? caller?.username ?? undefined;
  const importedAt = new Date();

  const officers = (await loadOfficers()).filter(o => o.active);
  const config = await loadConfig();
  const [existingOverrides, existingLeaves] = await Promise.all([
    loadOverridesForDates([date]),
    loadLeavesForDates([date]),
  ]);
  const overridesForDate = new Map(existingOverrides.map((o) => [o.officerId, o]));
  const leavesForDate = new Map(existingLeaves.map((l) => [l.officerId, l]));

  const norm      = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const normLoose = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

  function editDist(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
  }

  function findOfficer(name: string): Officer | undefined {
    const n = norm(name); const nl = normLoose(name);
    return (
      officers.find(o => norm(o.name) === n)       ||
      officers.find(o => normLoose(o.name) === nl)  ||
      officers.find(o => norm(o.name).includes(n))  ||
      officers.find(o => n.includes(norm(o.name)))  ||
      // Edit-distance fallback: allow up to 2 character differences
      officers.reduce<{ o: Officer | undefined; d: number }>(
        (best, o) => { const d = editDist(n, norm(o.name)); return d < best.d ? { o, d } : best; },
        { o: undefined, d: 3 }
      ).o
    );
  }

  // Seeded with every existing override/leave for this date so an officer
  // untouched by this import keeps their current entry — only entries that
  // actually change get overwritten below.
  const ovMap = new Map<string, typeof rosterOverridesTable.$inferInsert>(
    existingOverrides.map((o) => [o.officerId, o]),
  );
  const lvMap = new Map<string, typeof rosterLeavesTable.$inferInsert>(
    existingLeaves.map((l) => [l.officerId, l]),
  );

  const applied: Array<{ officerName: string; duty: string; unit: string }> = [];
  const skipped: string[] = [];
  const unmatched: string[] = [];

  const markUnmatched = (name: string) => {
    if (!unmatched.includes(name)) unmatched.push(name);
  };

  // Unit assignment rows
  for (const asgn of assignments ?? []) {
    for (const officerName of asgn.officers) {
      const o = findOfficer(officerName);
      if (!o) { markUnmatched(officerName); continue; }

      const importVehicle = asgn.vehicle ?? null;
      // OT col = unit code → this officer is cross-posted to that unit;
      // fall back to inferring it from the unit the row was listed under.
      const importXPost = asgn.coveringUnitCode
        ?? (o.unitCode !== asgn.unitCode ? asgn.unitCode : null);

      const cur = getOfficerEffectiveDutyForDate(o, date, overridesForDate, leavesForDate, config);
      if (cur.duty === asgn.duty && cur.vehicle === importVehicle && cur.crossPostedUnit === importXPost) {
        skipped.push(o.name);
        continue;
      }

      ovMap.set(o.id, {
        officerId: o.id, date,
        duty:       asgn.duty,
        targetDuty: asgn.duty,
        vehicle: importVehicle,
        crossPostedToUnit: importXPost,
      });
      applied.push({ officerName: o.name, duty: asgn.duty, unit: asgn.unitCode });
    }
  }

  // OFF section
  for (const name of off ?? []) {
    const o = findOfficer(name);
    if (!o) { markUnmatched(name); continue; }

    const cur = getOfficerEffectiveDutyForDate(o, date, overridesForDate, leavesForDate, config);
    if (cur.duty === "OFF") { skipped.push(o.name); continue; }

    ovMap.set(o.id, { officerId: o.id, date, duty: "OFF", targetDuty: "OFF" });
    applied.push({ officerName: o.name, duty: "OFF", unit: o.unitCode });
  }

  // LEAVE section — also creates/updates leave entries
  for (const entry of leave ?? []) {
    const o = findOfficer(entry.name);
    if (!o) { markUnmatched(entry.name); continue; }

    // OT col: officer name → coveredBy; unit code → crossPostedToUnit (rare)
    const coveringOfficer = entry.coveringOfficerName ? findOfficer(entry.coveringOfficerName) : undefined;
    const resolvedCoveringName = coveringOfficer?.name ?? entry.coveringOfficerName ?? null;
    const coveringUnit = entry.coveringUnitCode ?? null;

    const cur = getOfficerEffectiveDutyForDate(o, date, overridesForDate, leavesForDate, config);
    if (cur.duty === entry.leaveType && cur.coveringName === resolvedCoveringName && cur.crossPostedUnit === coveringUnit) {
      skipped.push(o.name);
      continue; // lvMap already has the existing leave entry — nothing to do
    }

    ovMap.set(o.id, {
      officerId: o.id, date,
      duty: entry.leaveType,
      // targetDuty is intentionally omitted — the schedule API derives it from the
      // officer's cycle, so the "target" column always shows the scheduled duty,
      // not the leave code.
      coveredByOfficerName: resolvedCoveringName,
      crossPostedToUnit: coveringUnit,
    });

    // Preserve the existing id/appliedBy/appliedAt if this officer already
    // had a leave entry for this date — a re-import must never erase who
    // originally applied it or mint a new row id for the same leave.
    const existingLv = lvMap.get(o.id);
    lvMap.set(o.id, {
      id: existingLv?.id ?? randomUUID(),
      officerId:           o.id,
      officerName:         o.name,
      date,
      leaveType:           entry.leaveType,
      coveringOfficerId:   coveringOfficer?.id ?? existingLv?.coveringOfficerId ?? null,
      coveringOfficerName: resolvedCoveringName,
      source: "import-brief",
      appliedBy: existingLv?.appliedBy ?? callerName ?? null,
      appliedAt: existingLv?.appliedAt ?? importedAt,
    });
    applied.push({ officerName: o.name, duty: entry.leaveType, unit: o.unitCode });
  }

  const overrideValues = [...ovMap.values()];
  const leaveValues = [...lvMap.values()];

  await db.transaction(async (tx) => {
    // ovMap/lvMap were seeded with every existing entry for this date, so
    // their final values are the complete, correct set — replace the whole
    // date rather than trying to diff row-by-row.
    await tx.delete(rosterOverridesTable).where(eq(rosterOverridesTable.date, date));
    if (overrideValues.length > 0) await tx.insert(rosterOverridesTable).values(overrideValues);

    await tx.delete(rosterLeavesTable).where(eq(rosterLeavesTable.date, date));
    if (leaveValues.length > 0) await tx.insert(rosterLeavesTable).values(leaveValues);
  });

  res.json({
    success: true,
    applied: applied.map((a) => a.officerName),
    changed: applied.length,
    skipped: skipped.length,
    unmatched,
    date,
  });
});

// DELETE /api/roster-plan/import-brief — revert a previous import by removing
// all overrides and leaves for the supplied date list.
rosterPlanRouter.delete("/roster-plan/import-brief", requireManager, async (req, res) => {
  const { dates } = req.body as { dates?: string[] };
  if (!Array.isArray(dates) || dates.length === 0) {
    res.status(400).json({ error: "dates array required" }); return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(rosterOverridesTable).where(inArray(rosterOverridesTable.date, dates));
    await tx.delete(rosterLeavesTable).where(inArray(rosterLeavesTable.date, dates));
  });
  res.json({ success: true, cleared: dates.length });
});
