import { Router } from "express";
import { eq, lt, desc } from "drizzle-orm";
import {
  db,
  rosterOverridesTable,
  rosterLeavesTable,
  rosterVehicleDefaultsTable,
  rosterVehicleArrangementsTable,
  type Officer,
  type RosterOverride,
  type RosterLeave,
} from "@workspace/db";
import { requireManager } from "./auth.js";
import {
  ensureCycleCacheLoaded,
  getOfficerEffectiveDutyForDate,
  loadOfficers,
  loadConfig,
} from "./rosterPlan.js";

export const vehicleArrangementRouter = Router();

// ── Ownership defaults ────────────────────────────────────────────────────────
// Seed set ported verbatim from Replit's HARDCODED_VEHICLE_PLACEMENTS — the
// 17 fleet plates and the subcatchment each "belongs to" absent any saved
// override. BU4, PJ4, KG4 have no vehicle and must always borrow.
const HARDCODED_VEHICLE_DEFAULTS: Record<string, string> = {
  TST0004A: "BU1",
  TST0009A: "BU2",
  TST0003A: "BU3",
  TST0008A: "BU5",
  TST0014A: "PJ1",
  TST0017A: "PJ2",
  TST0016A: "PJ3",
  TST0015A: "WK1",
  TST0012A: "WK2",
  TST0013A: "WK3",
  TST0002A: "CP1",
  TST0005A: "CP2",
  TST0007A: "CP3",
  TST0001A: "CP4",
  TST0011A: "KG1",
  TST0010A: "KG2",
  TST0006A: "KG3",
};

async function loadVehicleDefaults(): Promise<Record<string, string>> {
  const rows = await db.select().from(rosterVehicleDefaultsTable);
  const merged = { ...HARDCODED_VEHICLE_DEFAULTS };
  for (const r of rows) merged[r.plate] = r.location;
  return merged;
}

// GET /api/vehicle-arrangement/defaults — persistent ownership defaults
vehicleArrangementRouter.get("/vehicle-arrangement/defaults", requireManager, async (_req, res) => {
  const defaults = await loadVehicleDefaults();
  const placements = Object.entries(defaults).map(([plate, location]) => ({ plate, location }));
  res.json({ placements });
});

// POST /api/vehicle-arrangement/defaults — set the ownership unit for one plate
vehicleArrangementRouter.post("/vehicle-arrangement/defaults", requireManager, async (req, res) => {
  const { plate, location } = req.body as { plate?: string; location?: string };
  if (!plate || !location) {
    res.status(400).json({ error: "plate and location required" });
    return;
  }
  await db
    .insert(rosterVehicleDefaultsTable)
    .values({ plate, location })
    .onConflictDoUpdate({ target: rosterVehicleDefaultsTable.plate, set: { location } });
  res.json({ ok: true, plate, location });
});

// ── Duty resolution for a date (mirrors rosterPlan.ts's per-officer resolver) ──
const DUTY_RANK: Record<string, number> = { PD: 3, DAY: 2, ND: 1 };

async function resolveDutiesForDate(date: string): Promise<{
  officers: Officer[];
  resolved: { officer: Officer; duty: string; crossPostedTo: string | null }[];
}> {
  await ensureCycleCacheLoaded();
  const [allOfficers, config, overrides, leaves] = await Promise.all([
    loadOfficers(),
    loadConfig(),
    db.select().from(rosterOverridesTable).where(eq(rosterOverridesTable.date, date)),
    db.select().from(rosterLeavesTable).where(eq(rosterLeavesTable.date, date)),
  ]);
  const officers = allOfficers.filter((o) => o.active);
  const ovIndex = new Map<string, RosterOverride>(overrides.map((o) => [o.officerId, o]));
  const lvIndex = new Map<string, RosterLeave>(leaves.map((l) => [l.officerId, l]));
  const resolved = officers.map((officer) => {
    const eff = getOfficerEffectiveDutyForDate(officer, date, ovIndex, lvIndex, config);
    return { officer, duty: eff.duty, crossPostedTo: eff.crossPostedUnit };
  });
  return { officers, resolved };
}

/** Highest-priority duty (PD > DAY > ND) held by each unit's home crew on a date.
 *  Cross-posted-away officers don't count toward their home unit. */
async function getUnitDutiesForDate(date: string): Promise<Record<string, string>> {
  const { resolved } = await resolveDutiesForDate(date);
  const unitDuty: Record<string, string> = {};
  for (const r of resolved) {
    if (r.crossPostedTo) continue; // posted away — not at home unit
    const existing = unitDuty[r.officer.unitCode];
    if (existing === undefined || (DUTY_RANK[r.duty] ?? 0) > (DUTY_RANK[existing] ?? 0)) {
      unitDuty[r.officer.unitCode] = r.duty;
    }
  }
  return unitDuty;
}

// ── Vehicle cascade — three-tier priority, single pass ──────────────────────────
// Ported from Replit's backend applyVehicleCascade (rosterPlan.ts:2526+), the
// newer of Replit's two implementations — see vehicle-allocation-priority.md
// for the CP3↔KG1 reciprocal-borrowing rule this encodes.
//
//   PD / DAY   → recipients only (never donate)
//   ND         → recipients AND donors: receives from non-working when spare,
//                donates to PD/DAY only after non-working donors are exhausted
//   non-working (OFF, REST, any leave code, AWAY) → donors only, PD/DAY first
//
// Donation search order for each PD/DAY recipient:
//   (1) paired CP3 ↔ KG1 unit  (2) non-working same-catchment
//   (3) non-working same-watershed  (4) ND same-catchment
//   (5) ND same-watershed  (6) non-working cross-watershed  (7) ND cross-watershed
const WATERSHED_WESTERN = new Set(["BU", "PJ", "WK"]);
const WATERSHED_EASTERN = new Set(["CP", "KG"]);
function unitPrefix(unitCode: string): string {
  return unitCode.replace(/\d+$/, "");
}
function pairedVehicleUnit(unitCode: string): string | null {
  return unitCode === "CP3" ? "KG1" : unitCode === "KG1" ? "CP3" : null;
}

export function applyVehicleCascade(
  unitDuty: Record<string, string>,
  unitPlate: Record<string, string>,
): Record<string, string> {
  const effective = { ...unitPlate };
  const claimed = new Set<string>();

  const isWorking = (duty: string | undefined): boolean => duty === "PD" || duty === "DAY" || duty === "ND";

  const allUnits = Array.from(new Set([...Object.keys(unitDuty), ...Object.keys(effective)]));

  const find = (candidates: string[], pred: (u: string) => boolean): string | null =>
    candidates.find(pred) ?? null;

  const donate = (donor: string, recipient: string): void => {
    effective[recipient] = effective[donor];
    delete effective[donor];
    claimed.add(donor);
  };

  const isNonWorkingDonor = (u: string): boolean => !claimed.has(u) && !!effective[u] && !isWorking(unitDuty[u]);
  const isNDDonor = (u: string): boolean => !claimed.has(u) && !!effective[u] && unitDuty[u] === "ND";

  const needVehicle = allUnits
    .filter((u) => (unitDuty[u] === "PD" || unitDuty[u] === "DAY") && !effective[u])
    .sort((a, b) => (unitDuty[a] === "PD" ? 0 : 1) - (unitDuty[b] === "PD" ? 0 : 1));

  for (const unit of needVehicle) {
    const px = unitPrefix(unit);
    const myW = WATERSHED_WESTERN.has(px) ? WATERSHED_WESTERN : WATERSHED_EASTERN;
    const xW = WATERSHED_WESTERN.has(px) ? WATERSHED_EASTERN : WATERSHED_WESTERN;
    const pairedUnit = pairedVehicleUnit(unit);

    const donor =
      (pairedUnit ? find([pairedUnit], isNonWorkingDonor) : null) ??
      (pairedUnit ? find([pairedUnit], isNDDonor) : null) ??
      find(allUnits.filter((u) => unitPrefix(u) === px && u !== unit), isNonWorkingDonor) ??
      find(allUnits.filter((u) => myW.has(unitPrefix(u)) && unitPrefix(u) !== px), isNonWorkingDonor) ??
      find(allUnits.filter((u) => unitPrefix(u) === px && u !== unit), isNDDonor) ??
      find(allUnits.filter((u) => myW.has(unitPrefix(u)) && unitPrefix(u) !== px), isNDDonor) ??
      find(allUnits.filter((u) => xW.has(unitPrefix(u))), isNonWorkingDonor) ??
      find(allUnits.filter((u) => xW.has(unitPrefix(u))), isNDDonor);

    if (donor) donate(donor, unit);
  }

  for (const ndUnit of allUnits.filter((u) => unitDuty[u] === "ND" && !effective[u])) {
    const px = unitPrefix(ndUnit);
    const myW = WATERSHED_WESTERN.has(px) ? WATERSHED_WESTERN : WATERSHED_EASTERN;
    const xW = WATERSHED_WESTERN.has(px) ? WATERSHED_EASTERN : WATERSHED_WESTERN;
    const pairedUnit = pairedVehicleUnit(ndUnit);

    const donor =
      (pairedUnit ? find([pairedUnit], isNonWorkingDonor) : null) ??
      find(allUnits.filter((u) => unitPrefix(u) === px && u !== ndUnit), isNonWorkingDonor) ??
      find(allUnits.filter((u) => myW.has(unitPrefix(u)) && unitPrefix(u) !== px), isNonWorkingDonor) ??
      find(allUnits.filter((u) => xW.has(unitPrefix(u))), isNonWorkingDonor);

    if (donor) donate(donor, ndUnit);
  }

  return effective;
}

// ── Fallback placements for a date with no saved arrangement ────────────────────
// Rules (ported from Replit's buildFallbackPlacements):
//   1. Maintenance persists forward until manually cleared.
//   2. A vehicle stays with its holding unit if that unit was still working
//      (PD/DAY/ND) on the most recent prior *saved* date — consecutive-duty
//      continuity, teams keep the same vehicle across a shift stretch.
//   3. Otherwise (holding unit was off) the vehicle resets to its ownership
//      default, freeing it for the cascade to redistribute.
async function buildFallbackPlacements(date: string): Promise<{ plate: string; location: string }[]> {
  const defaults = await loadVehicleDefaults();
  const base: Record<string, string> = { ...defaults };

  const [priorDateRow] = await db
    .select({ date: rosterVehicleArrangementsTable.date })
    .from(rosterVehicleArrangementsTable)
    .where(lt(rosterVehicleArrangementsTable.date, date))
    .orderBy(desc(rosterVehicleArrangementsTable.date))
    .limit(1);

  if (priorDateRow) {
    const priorDate = priorDateRow.date;
    const mostRecent = await db
      .select()
      .from(rosterVehicleArrangementsTable)
      .where(eq(rosterVehicleArrangementsTable.date, priorDate));
    const priorUnitDuties = await getUnitDutiesForDate(priorDate);
    const WORKING = new Set(["PD", "DAY", "ND"]);

    for (const { plate, location } of mostRecent) {
      if (location === "maintenance") {
        base[plate] = "maintenance";
      } else if (location === "home") {
        base[plate] = "home";
      } else if (WORKING.has(priorUnitDuties[location] ?? "")) {
        base[plate] = location;
      }
      // else: unit was off — base[plate] stays at ownership default
    }
  }

  return Object.entries(base).map(([plate, location]) => ({ plate, location }));
}

// GET /api/vehicle-arrangement?date=YYYY-MM-DD
vehicleArrangementRouter.get("/vehicle-arrangement", requireManager, async (req, res) => {
  const date = (req.query.date as string | undefined)?.slice(0, 10);
  if (!date) {
    res.status(400).json({ error: "date required" });
    return;
  }
  const rows = await db.select().from(rosterVehicleArrangementsTable).where(eq(rosterVehicleArrangementsTable.date, date));
  if (rows.length > 0) {
    res.json({ date, placements: rows.map((r) => ({ plate: r.plate, location: r.location })), isDefault: false });
    return;
  }
  const fallback = await buildFallbackPlacements(date);
  res.json({ date, placements: fallback, isDefault: true });
});

// POST /api/vehicle-arrangement — full replace of one date's placements
vehicleArrangementRouter.post("/vehicle-arrangement", requireManager, async (req, res) => {
  const { date: rawDate, placements } = req.body as {
    date?: string;
    placements?: { plate: string; location: string }[];
  };
  const date = rawDate?.slice(0, 10);
  if (!date || !Array.isArray(placements)) {
    res.status(400).json({ error: "date and placements array required" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(rosterVehicleArrangementsTable).where(eq(rosterVehicleArrangementsTable.date, date));
    if (placements.length > 0) {
      await tx.insert(rosterVehicleArrangementsTable).values(
        placements.map((p) => ({ date, plate: p.plate, location: p.location })),
      );
    }
  });
  res.json({ ok: true, date, placements });
});

// GET /api/vehicle-arrangement/officer-map?date=YYYY-MM-DD
// Returns { [officerId]: plate } — at most one WORKING officer per effective
// unit ever receives a plate (see .local/tasks/unique-daily-vehicle-assignment.md
// in the Replit source: a real gap identified there but never actually shipped —
// ported here as the fix rather than the shared-per-unit-plate behavior that's
// still live on Replit today). Officers on leave/OFF/REST never show a vehicle,
// and if more than one officer at a unit is somehow working the same date
// (rare override edge case), only the higher-duty / lower-crewPosition one
// gets it — never two officers pointing at the same physical plate.
//
// Not currently called by any frontend (checked roster-dashboard, manager.ts,
// crew.ts — none reference it; VehicleArrangement.tsx keeps its own mirrored
// copy of the cascade for its live preview instead). Built to support
// per-officer vehicle resolution once something needs it — e.g. the live map
// or crew location-tracking disambiguating which of a unit's two officers is
// in the vehicle. Confirmed correct as of 2026-09-08 QA
// (.scratch/roster-qa/issues/), just orphaned — don't assume dead code, but
// don't be surprised it has no caller either.
vehicleArrangementRouter.get("/vehicle-arrangement/officer-map", requireManager, async (req, res) => {
  const date = (req.query.date as string | undefined)?.slice(0, 10);
  if (!date) {
    res.status(400).json({ error: "date required" });
    return;
  }

  const savedRows = await db.select().from(rosterVehicleArrangementsTable).where(eq(rosterVehicleArrangementsTable.date, date));
  const { resolved } = await resolveDutiesForDate(date);

  // ── 1. Starting unit → plate map ─────────────────────────────────────────
  const unitPlate: Record<string, string> = {};
  if (savedRows.length > 0) {
    for (const { plate, location } of savedRows) {
      if (location && !unitPlate[location]) unitPlate[location] = plate;
    }
  } else {
    const defaults = await loadVehicleDefaults();
    for (const [plate, unit] of Object.entries(defaults)) {
      if (!unitPlate[unit]) unitPlate[unit] = plate;
    }
  }

  // ── 2. unitDuty: duty of officers actually at their home unit ───────────
  const unitDuty: Record<string, string> = {};
  for (const r of resolved) {
    if (r.crossPostedTo) continue;
    const existing = unitDuty[r.officer.unitCode];
    if (existing === undefined || (DUTY_RANK[r.duty] ?? 0) > (DUTY_RANK[existing] ?? 0)) {
      unitDuty[r.officer.unitCode] = r.duty;
    }
  }
  // Units holding a vehicle but with no remaining home officer (all cross-posted
  // away) are a non-working donor of last resort.
  for (const unit of Object.keys(unitPlate)) {
    if (unitDuty[unit] === undefined) unitDuty[unit] = "AWAY";
  }
  // ── 3. Overlay cross-post destinations as recipients ─────────────────────
  for (const r of resolved) {
    if (!r.crossPostedTo) continue;
    const incomingRank = DUTY_RANK[r.duty] ?? 0;
    const existingRank = DUTY_RANK[unitDuty[r.crossPostedTo]] ?? 0;
    if (incomingRank > existingRank) unitDuty[r.crossPostedTo] = r.duty;
  }

  // ── 4. Cascade only automatic (unsaved) arrangements ─────────────────────
  const effective = savedRows.length > 0 ? unitPlate : applyVehicleCascade(unitDuty, unitPlate);

  // ── 5. Resolve at most one working officer per effective unit ────────────
  const WORKING = new Set(["PD", "DAY", "ND"]);
  const byUnit = new Map<string, { officer: Officer; duty: string }[]>();
  for (const r of resolved) {
    if (!WORKING.has(r.duty)) continue; // OFF/REST/leave never get a vehicle
    const unit = r.crossPostedTo ?? r.officer.unitCode;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit)!.push({ officer: r.officer, duty: r.duty });
  }
  const officerMap: Record<string, string> = {};
  for (const [unit, list] of byUnit) {
    const plate = effective[unit];
    if (!plate) continue;
    list.sort(
      (a, b) =>
        (DUTY_RANK[b.duty] ?? 0) - (DUTY_RANK[a.duty] ?? 0) ||
        a.officer.crewPosition - b.officer.crewPosition ||
        a.officer.id.localeCompare(b.officer.id),
    );
    officerMap[list[0].officer.id] = plate;
  }
  res.json({ date, officerMap });
});
