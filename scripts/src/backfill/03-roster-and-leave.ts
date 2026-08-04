import { sql } from "drizzle-orm";
import {
  db,
  officersTable,
  rosterConfigTable,
  rosterMaintenanceVehiclesTable,
  rosterCycleMetaTable,
  rosterCycleDutiesTable,
  rosterOverridesTable,
  rosterLeavesTable,
  rosterSwapsTable,
  leaveRequestsTable,
  leaveTypesTable,
  LEAVE_TYPE_CODES,
} from "@workspace/db";
import { readJson } from "./lib/read";
import type { DomainReport, TableReport } from "./lib/report";

// ── Source JSON shapes (artifacts/api-server/data/*.json) ────────────────────

interface RosterOfficerJson {
  id: string;
  name: string;
  unitCode: string;
  vehicle: string;
  catchment: string;
  teamSlot: number;
  crewPosition: number;
}

interface RosterConfigJson {
  teamCount: number;
  cycleStartDate: string;
  maintenanceVehicles: string[];
}

interface RosterCycleJson {
  cycleStartDate: string;
  cycleLengthDays: number;
  excelStartDate: string;
  officers: { vehicle: string; unit: string; name: string; duties: { target: string; actual: string }[] }[];
}

interface LeaveEntryJson {
  id: string;
  officerId: string;
  officerName: string;
  date: string;
  leaveType: string;
  coveringOfficerId?: string;
  coveringOfficerName?: string;
}

interface DutyOverrideJson {
  officerId: string;
  date: string;
  duty: string;
  coveredByOfficerName?: string;
  targetDuty?: string;
  crossPostedToUnit?: string;
  vehicle?: string;
  overtimeHours?: string;
  swappedWithOfficerName?: string;
  madeBy?: string;
  madeByName?: string;
  madeAt?: string;
  _coverFor?: string;
}

interface RosterSwapJson {
  id: string;
  requesterId: string;
  requesterName: string;
  targetId: string;
  targetName: string;
  date: string;
  requesterDuty: string;
  targetDuty: string;
  reason?: string;
  status: string;
  reviewerName?: string;
  createdAt: string;
  reviewedAt?: string;
}

interface LeaveRequestJson {
  id: string;
  officerId: string;
  officerName: string;
  officerCatchment: string;
  date: string;
  leaveType: string;
  reason?: string;
  coverOfficerId?: string;
  coverOfficerName?: string;
  coverStatus?: string;
  coverRespondedAt?: string;
  coverDeclineReason?: string;
  icAccountId?: string;
  icName?: string;
  icStatus?: string;
  icReviewedAt?: string;
  icNote?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastEditedBy?: string;
  lastEditedOn?: string;
  committedLeaveId?: string;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function backfillRosterAndLeave(dryRun: boolean): Promise<DomainReport> {
  const tables: TableReport[] = [];
  const warnings: string[] = [];

  // ── leave_types: reference data, not sourced from any JSON file — seeded
  // from the schema's LEAVE_TYPE_CODES constant. Must exist before any
  // roster_leaves/leave_requests row can be inserted (both FK leave_type
  // into this table). ─────────────────────────────────────────────────────
  if (!dryRun) {
    await db
      .insert(leaveTypesTable)
      .values(LEAVE_TYPE_CODES.map((code) => ({ code })))
      .onConflictDoNothing();
  }
  tables.push({ table: "leave_types", sourceCount: LEAVE_TYPE_CODES.length, upserted: dryRun ? 0 : LEAVE_TYPE_CODES.length });

  // ── officers ─────────────────────────────────────────────────────────────
  const officers = readJson<RosterOfficerJson[]>("roster-officers.json", []);
  if (!dryRun && officers.length > 0) {
    await db
      .insert(officersTable)
      .values(officers)
      .onConflictDoUpdate({
        target: officersTable.id,
        set: {
          name: sql`excluded.name`,
          unitCode: sql`excluded.unit_code`,
          vehicle: sql`excluded.vehicle`,
          catchment: sql`excluded.catchment`,
          teamSlot: sql`excluded.team_slot`,
          crewPosition: sql`excluded.crew_position`,
        },
      });
  }
  tables.push({ table: "officers", sourceCount: officers.length, upserted: dryRun ? 0 : officers.length });

  // ── roster_config + roster_maintenance_vehicles ─────────────────────────
  const rosterConfig = readJson<RosterConfigJson | null>("roster-config.json", null);
  if (rosterConfig) {
    if (!dryRun) {
      await db.transaction(async (tx) => {
        await tx
          .insert(rosterConfigTable)
          .values({ id: 1, teamCount: rosterConfig.teamCount, cycleStartDate: rosterConfig.cycleStartDate })
          .onConflictDoUpdate({
            target: rosterConfigTable.id,
            set: { teamCount: rosterConfig.teamCount, cycleStartDate: rosterConfig.cycleStartDate },
          });
        await tx.delete(rosterMaintenanceVehiclesTable);
        if (rosterConfig.maintenanceVehicles.length > 0) {
          await tx.insert(rosterMaintenanceVehiclesTable).values(rosterConfig.maintenanceVehicles.map((vehicle) => ({ vehicle })));
        }
      });
    }
  }
  tables.push({ table: "roster_config", sourceCount: rosterConfig ? 1 : 0, upserted: dryRun || !rosterConfig ? 0 : 1 });
  tables.push({
    table: "roster_maintenance_vehicles",
    sourceCount: rosterConfig?.maintenanceVehicles.length ?? 0,
    upserted: dryRun ? 0 : rosterConfig?.maintenanceVehicles.length ?? 0,
  });

  // ── roster_cycle_meta + roster_cycle_duties ─────────────────────────────
  const rosterCycle = readJson<RosterCycleJson | null>("roster-cycle.json", null);
  let dutyRowCount = 0;
  if (rosterCycle) {
    // Dedup by unit — both crew positions on a unit share the same duty
    // array (confirmed in rosterPlan.ts). Validate that assumption rather
    // than silently trusting it.
    const byUnit = new Map<string, { target: string; actual: string }[]>();
    for (const o of rosterCycle.officers) {
      const existing = byUnit.get(o.unit);
      if (!existing) {
        byUnit.set(o.unit, o.duties);
      } else if (JSON.stringify(existing) !== JSON.stringify(o.duties)) {
        warnings.push(`roster-cycle.json: unit ${o.unit} has crew members with differing duty arrays — kept the first one seen`);
      }
    }

    const dutyRows: (typeof rosterCycleDutiesTable.$inferInsert)[] = [];
    for (const [unitCode, duties] of byUnit) {
      duties.forEach((d, i) => {
        dutyRows.push({ unitCode, date: addDays(rosterCycle.cycleStartDate, i), targetDuty: d.target, actualDuty: d.actual });
      });
    }
    dutyRowCount = dutyRows.length;

    // Orphan check: every (unit, name) pair in roster-cycle.json should
    // match a real officer. The duties table itself is unit-keyed (not
    // officer-keyed — duty resolution matches by unit code, per the roster
    // & leave schema ticket), so this is a validation-only check, not
    // something that changes what gets written.
    const officerKey = (unit: string, name: string) => `${unit}::${name.trim().toLowerCase()}`;
    const knownOfficers = new Set(officers.map((o) => officerKey(o.unitCode, o.name)));
    const seenPairs = new Set<string>();
    const orphans: string[] = [];
    for (const o of rosterCycle.officers) {
      const key = officerKey(o.unit, o.name);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      if (!knownOfficers.has(key)) orphans.push(`${o.unit}/${o.name}`);
    }
    if (orphans.length > 0) {
      warnings.push(`roster-cycle.json: ${orphans.length} (unit, name) pair(s) have no matching officer: ${orphans.join(", ")}`);
    }

    if (!dryRun) {
      await db.transaction(async (tx) => {
        await tx
          .insert(rosterCycleMetaTable)
          .values({ id: 1, cycleStartDate: rosterCycle.cycleStartDate, cycleLengthDays: rosterCycle.cycleLengthDays, excelStartDate: rosterCycle.excelStartDate })
          .onConflictDoUpdate({
            target: rosterCycleMetaTable.id,
            set: { cycleStartDate: rosterCycle.cycleStartDate, cycleLengthDays: rosterCycle.cycleLengthDays, excelStartDate: rosterCycle.excelStartDate },
          });
        // Chunk the bulk insert — thousands of rows in one VALUES list is fine
        // for Postgres param limits here, but chunking keeps this safe as the
        // cycle window grows.
        const CHUNK = 500;
        for (let i = 0; i < dutyRows.length; i += CHUNK) {
          const chunk = dutyRows.slice(i, i + CHUNK);
          await tx
            .insert(rosterCycleDutiesTable)
            .values(chunk)
            .onConflictDoUpdate({
              target: [rosterCycleDutiesTable.unitCode, rosterCycleDutiesTable.date],
              set: { targetDuty: sql`excluded.target_duty`, actualDuty: sql`excluded.actual_duty` },
            });
        }
      });
    }
  }
  tables.push({ table: "roster_cycle_meta", sourceCount: rosterCycle ? 1 : 0, upserted: dryRun || !rosterCycle ? 0 : 1 });
  tables.push({ table: "roster_cycle_duties", sourceCount: dutyRowCount, upserted: dryRun ? 0 : dutyRowCount });

  // ── roster_leaves / roster_overrides / roster_swaps / leave_requests ────
  // All currently empty ([]) in the git-committed export, but handled
  // generically so a live pull with real data at cutover time still works.
  const leaves = readJson<LeaveEntryJson[]>("roster-leaves.json", []);
  if (!dryRun && leaves.length > 0) {
    await db
      .insert(rosterLeavesTable)
      .values(leaves.map((l) => ({
        id: l.id,
        officerId: l.officerId,
        officerName: l.officerName,
        date: l.date,
        leaveType: l.leaveType,
        coveringOfficerId: l.coveringOfficerId ?? null,
        coveringOfficerName: l.coveringOfficerName ?? null,
      })))
      .onConflictDoUpdate({
        target: [rosterLeavesTable.officerId, rosterLeavesTable.date],
        set: {
          leaveType: sql`excluded.leave_type`,
          coveringOfficerId: sql`excluded.covering_officer_id`,
          coveringOfficerName: sql`excluded.covering_officer_name`,
        },
      });
  }
  tables.push({ table: "roster_leaves", sourceCount: leaves.length, upserted: dryRun ? 0 : leaves.length });

  const overrides = readJson<DutyOverrideJson[]>("roster-overrides.json", []);
  if (!dryRun && overrides.length > 0) {
    await db
      .insert(rosterOverridesTable)
      .values(overrides.map((o) => ({
        officerId: o.officerId,
        date: o.date,
        duty: o.duty,
        coveredByOfficerName: o.coveredByOfficerName ?? null,
        targetDuty: o.targetDuty ?? null,
        crossPostedToUnit: o.crossPostedToUnit ?? null,
        vehicle: o.vehicle ?? null,
        overtimeHours: o.overtimeHours ?? null,
        swappedWithOfficerName: o.swappedWithOfficerName ?? null,
        madeBy: o.madeBy ?? null,
        madeByName: o.madeByName ?? null,
        madeAt: o.madeAt ? new Date(o.madeAt) : null,
        coverForOfficerId: o._coverFor ?? null,
      })))
      .onConflictDoUpdate({
        target: [rosterOverridesTable.officerId, rosterOverridesTable.date],
        set: {
          duty: sql`excluded.duty`,
          coveredByOfficerName: sql`excluded.covered_by_officer_name`,
          targetDuty: sql`excluded.target_duty`,
          crossPostedToUnit: sql`excluded.cross_posted_to_unit`,
          vehicle: sql`excluded.vehicle`,
          overtimeHours: sql`excluded.overtime_hours`,
          swappedWithOfficerName: sql`excluded.swapped_with_officer_name`,
          madeBy: sql`excluded.made_by`,
          madeByName: sql`excluded.made_by_name`,
          madeAt: sql`excluded.made_at`,
          coverForOfficerId: sql`excluded.cover_for_officer_id`,
        },
      });
  }
  tables.push({ table: "roster_overrides", sourceCount: overrides.length, upserted: dryRun ? 0 : overrides.length });

  const swaps = readJson<RosterSwapJson[]>("roster-swaps.json", []);
  if (!dryRun && swaps.length > 0) {
    await db
      .insert(rosterSwapsTable)
      .values(swaps.map((s) => ({
        id: s.id,
        requesterId: s.requesterId,
        requesterName: s.requesterName,
        targetId: s.targetId,
        targetName: s.targetName,
        date: s.date,
        requesterDuty: s.requesterDuty,
        targetDuty: s.targetDuty,
        reason: s.reason ?? null,
        status: s.status,
        reviewerName: s.reviewerName ?? null,
        createdAt: new Date(s.createdAt),
        reviewedAt: s.reviewedAt ? new Date(s.reviewedAt) : null,
      })))
      .onConflictDoUpdate({ target: rosterSwapsTable.id, set: { status: sql`excluded.status`, reviewedAt: sql`excluded.reviewed_at` } });
  }
  tables.push({ table: "roster_swaps", sourceCount: swaps.length, upserted: dryRun ? 0 : swaps.length });

  const leaveRequests = readJson<LeaveRequestJson[]>("leave-requests.json", []);
  if (!dryRun && leaveRequests.length > 0) {
    await db
      .insert(leaveRequestsTable)
      .values(leaveRequests.map((r) => ({
        id: r.id,
        officerId: r.officerId,
        officerName: r.officerName,
        officerCatchment: r.officerCatchment,
        date: r.date,
        leaveType: r.leaveType,
        reason: r.reason ?? null,
        coverOfficerId: r.coverOfficerId ?? null,
        coverOfficerName: r.coverOfficerName ?? null,
        coverStatus: r.coverStatus ?? null,
        coverRespondedAt: r.coverRespondedAt ? new Date(r.coverRespondedAt) : null,
        coverDeclineReason: r.coverDeclineReason ?? null,
        icAccountId: r.icAccountId ?? null,
        icName: r.icName ?? null,
        icStatus: r.icStatus ?? null,
        icReviewedAt: r.icReviewedAt ? new Date(r.icReviewedAt) : null,
        icNote: r.icNote ?? null,
        status: r.status,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
        lastEditedBy: r.lastEditedBy ?? null,
        lastEditedOn: r.lastEditedOn ? new Date(r.lastEditedOn) : null,
        committedLeaveId: r.committedLeaveId ?? null,
      })))
      .onConflictDoUpdate({ target: leaveRequestsTable.id, set: { status: sql`excluded.status`, updatedAt: sql`excluded.updated_at` } });
  }
  tables.push({ table: "leave_requests", sourceCount: leaveRequests.length, upserted: dryRun ? 0 : leaveRequests.length });

  return { domain: "03 roster & leave", tables, warnings };
}
