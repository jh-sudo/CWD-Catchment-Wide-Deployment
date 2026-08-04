/**
 * Data backfill & cutover — migrates the git-committed JSON "database"
 * (artifacts/api-server/data/*.json) into the Postgres schema.
 *
 * Repeatable/idempotent (upsert per table) — safe to re-run. See
 * .scratch/govpaas-migration/issues/11-data-backfill-cutover.md for the
 * design decisions this implements.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill              # real run
 *   pnpm --filter @workspace/scripts run backfill -- --dry-run # report only, no writes
 *
 * Requires DATABASE_URL to point at the target Postgres instance.
 *
 * Run order matters: roster & leave (03) seeds `officers` before core ops
 * state (02) inserts `managers` (officer_id FK) and before inspections &
 * push (05) inserts `push_subscriptions` (officer_id FK).
 */
import type { PgTable } from "drizzle-orm/pg-core";
import {
  db,
  pool,
  leaveTypesTable,
  officersTable,
  rosterConfigTable,
  rosterMaintenanceVehiclesTable,
  rosterCycleMetaTable,
  rosterCycleDutiesTable,
  rosterLeavesTable,
  rosterOverridesTable,
  rosterSwapsTable,
  leaveRequestsTable,
  appConfigTable,
  managersTable,
  crmsCasesTable,
  crmsCommentsTable,
  wlsReadingsTable,
  deploymentTeamsTable,
  deploymentSettingsTable,
  deploymentLocationsTable,
  deploymentAssignmentsTable,
  phRosterRefTable,
  phHrBallotStateTable,
  phRotationStateTable,
  phFaqTable,
  vapidKeysTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { backfillRosterAndLeave } from "./03-roster-and-leave";
import { backfillCoreOpsState } from "./02-core-ops-state";
import { backfillPhRoster } from "./04-ph-roster";
import { backfillInspectionsAndPush } from "./05-inspections-push";
import { printDomainReport, type DomainReport } from "./lib/report";

const dryRun = process.argv.includes("--dry-run");

// Maps TableReport.table names (used across all four domain scripts) to
// their Drizzle table object, for the post-run row-count validation pass.
// Tables with no source data (ph_roster_overrides, ph_ballot, inspections*)
// are intentionally omitted — nothing to validate.
const TABLE_REGISTRY: Record<string, PgTable> = {
  leave_types: leaveTypesTable,
  officers: officersTable,
  roster_config: rosterConfigTable,
  roster_maintenance_vehicles: rosterMaintenanceVehiclesTable,
  roster_cycle_meta: rosterCycleMetaTable,
  roster_cycle_duties: rosterCycleDutiesTable,
  roster_leaves: rosterLeavesTable,
  roster_overrides: rosterOverridesTable,
  roster_swaps: rosterSwapsTable,
  leave_requests: leaveRequestsTable,
  app_config: appConfigTable,
  managers: managersTable,
  crms_cases: crmsCasesTable,
  crms_comments: crmsCommentsTable,
  wls_readings: wlsReadingsTable,
  deployment_teams: deploymentTeamsTable,
  deployment_settings: deploymentSettingsTable,
  deployment_locations: deploymentLocationsTable,
  deployment_assignments: deploymentAssignmentsTable,
  ph_roster_ref: phRosterRefTable,
  ph_hr_ballot_state: phHrBallotStateTable,
  ph_rotation_state: phRotationStateTable,
  ph_faq: phFaqTable,
  vapid_keys: vapidKeysTable,
  push_subscriptions: pushSubscriptionsTable,
};

async function validate(reports: DomainReport[]): Promise<string[]> {
  const mismatches: string[] = [];
  for (const report of reports) {
    for (const t of report.tables) {
      const table = TABLE_REGISTRY[t.table];
      if (!table) continue; // no source data for this table — nothing to validate
      const rows = await db.select().from(table);
      if (rows.length !== t.sourceCount) {
        mismatches.push(`${t.table}: source had ${t.sourceCount} row(s), table now has ${rows.length} row(s)`);
      }
    }
  }
  return mismatches;
}

async function main(): Promise<void> {
  console.log(`\nBackfill run — ${dryRun ? "DRY RUN (no writes)" : "LIVE (writing to Postgres)"}\n`);

  const reports: DomainReport[] = [];
  // 03 first: seeds officers + leave_types, which 02 and 05 FK into.
  reports.push(await backfillRosterAndLeave(dryRun));
  reports.push(await backfillCoreOpsState(dryRun));
  reports.push(await backfillPhRoster(dryRun));
  reports.push(await backfillInspectionsAndPush(dryRun));

  for (const r of reports) printDomainReport(r, dryRun);

  const allWarnings = reports.flatMap((r) => r.warnings);

  if (!dryRun) {
    console.log("\n── Validation (row counts vs source) ──");
    const mismatches = await validate(reports);
    if (mismatches.length === 0) {
      console.log("  ✅  All table row counts match their source.");
    } else {
      for (const m of mismatches) console.log(`  ❌  ${m}`);
    }
    allWarnings.push(...mismatches);
  }

  if (allWarnings.length > 0) {
    console.log(`\n${allWarnings.length} warning(s)/mismatch(es) — review before cutover.\n`);
  } else {
    console.log("\nNo warnings.\n");
  }

  await pool.end();
  process.exit(allWarnings.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("\nBackfill failed:", err);
  process.exit(1);
});
