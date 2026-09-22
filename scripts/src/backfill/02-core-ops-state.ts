import { sql } from "drizzle-orm";
import {
  db,
  managersTable,
  crmsCasesTable,
  crmsCommentsTable,
  wlsReadingsTable,
  deploymentTeamsTable,
  deploymentSettingsTable,
  deploymentLocationsTable,
  deploymentAssignmentsTable,
} from "@workspace/db";
import { readJson } from "./lib/read";
import type { DomainReport, TableReport } from "./lib/report";

// ── Source JSON shapes ────────────────────────────────────────────────────────

interface ConfigJson {
  managerPin: string;
  crewPin: string;
}

interface ManagerJson {
  id: string;
  username: string;
  passwordHash: string;
  role: string;
  approved: boolean;
  createdAt: string;
  officerId?: string;
  officerName?: string;
  catchments?: string[];
  pendingReset?: { passwordHash: string; requestedAt: string };
}

interface CrmsCommentJson {
  commentId: string;
  vehicleId: string;
  unitCode: string;
  text: string;
  createdAt: string;
}

interface CrmsCaseJson {
  id: string;
  caseNumber: string;
  isWog: boolean;
  fpName: string;
  fpContact: string;
  address: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  locationName: string;
  details: string;
  status: string;
  assignedVehicleId?: string;
  assignedUnitCode?: string;
  comments?: CrmsCommentJson[];
  receivedAt: string;
  acknowledgedAt?: string;
  fpUpdatedAt?: string;
  assistanceProvidedAt?: string;
  resolvedAt?: string;
  floodAssessment?: string;
  updateProvidedToFP?: string;
  reportedBy: string;
}

interface WlsReadingJson {
  stationId: string;
  rawLevel: string;
  alertLevel: string;
  direction: string;
  waterLevelM: number | null;
  copeM: number | null;
  criticalM: number | null;
  locationName: string;
  timestamp: string;
  receivedAt: string;
  senderName?: string;
  messageType: string;
}

interface RosterTeamJson {
  id: string;
  vehicleId: string;
  unitCode: string;
  vehicleNumber: string;
  partner: string;
  shift: string;
}

interface LocationJson {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  region?: string;
  priority?: number;
}

interface AssignmentJson {
  vehicleId: string;
  vehicleNumber: string;
  unitCode: string;
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  assignedAt: string;
  status: string;
  assignedBy?: string;
  previousLocationId?: string;
  previousLocationName?: string;
}

interface StateJson {
  roster: RosterTeamJson[];
  activeShifts: string[];
  activeTeams: string[];
  customLocations: [string, LocationJson][];
  assignments: AssignmentJson[];
}

export async function backfillCoreOpsState(dryRun: boolean): Promise<DomainReport> {
  const tables: TableReport[] = [];
  const warnings: string[] = [];

  // ── app_config (manager/crew PINs) ──────────────────────────────────────
  // Deliberately NOT migrated. Replit's live PINs are still the same
  // known/documented default (123456/1234) most accounts never changed away
  // from — see the external-API confidentiality audit,
  // .scratch/replit-resync-2026-09-21/issues/37. Carrying that value forward
  // would start GOV PaaS production on an already-compromised credential, so
  // this domain leaves no app_config row behind on purpose. `seedAdmin()`
  // (artifacts/api-server/src/routes/auth.ts) already generates a fresh
  // random PIN pair on first boot whenever no app_config row exists — the
  // same path a brand-new install takes — so nothing needs to be duplicated
  // here, just skipped.
  const config = readJson<ConfigJson | null>("config.json", null);
  tables.push({ table: "app_config", sourceCount: config ? 1 : 0, upserted: 0 });
  if (config) {
    warnings.push(
      "manager/crew PINs intentionally NOT migrated from Replit's config.json (known/documented default) — " +
      "seedAdmin() will generate a fresh random pair on this deployment's first boot; retrieve it from that boot's logs",
    );
  }

  // ── managers ─────────────────────────────────────────────────────────────
  const managers = readJson<ManagerJson[]>("managers.json", []);
  if (!dryRun && managers.length > 0) {
    await db
      .insert(managersTable)
      .values(managers.map((m) => ({
        id: m.id,
        username: m.username,
        passwordHash: m.passwordHash,
        role: m.role,
        approved: m.approved,
        createdAt: new Date(m.createdAt),
        officerId: m.officerId ?? null,
        officerName: m.officerName ?? null,
        catchments: m.catchments?.length ? m.catchments : null,
        pendingResetPasswordHash: m.pendingReset?.passwordHash ?? null,
        pendingResetRequestedAt: m.pendingReset?.requestedAt ? new Date(m.pendingReset.requestedAt) : null,
      })))
      .onConflictDoUpdate({
        target: managersTable.id,
        set: {
          username: sql`excluded.username`,
          passwordHash: sql`excluded.password_hash`,
          role: sql`excluded.role`,
          approved: sql`excluded.approved`,
          officerId: sql`excluded.officer_id`,
          officerName: sql`excluded.officer_name`,
          catchments: sql`excluded.catchments`,
          pendingResetPasswordHash: sql`excluded.pending_reset_password_hash`,
          pendingResetRequestedAt: sql`excluded.pending_reset_requested_at`,
        },
      });
  }
  tables.push({ table: "managers", sourceCount: managers.length, upserted: dryRun ? 0 : managers.length });
  // officerId FK -> officers: flag any manager linked to an officer id that
  // doesn't exist (officers are seeded by the roster & leave domain, which
  // must run before this one).
  if (managers.some((m) => m.officerId)) {
    warnings.push("managers.json has officer-linked accounts — verify roster & leave domain ran first (officers FK)");
  }

  // ── crms_cases / crms_comments ──────────────────────────────────────────
  const crmsCases = readJson<CrmsCaseJson[]>("crms.json", []);
  const crmsComments = crmsCases.flatMap((c) => (c.comments ?? []).map((cm) => ({ ...cm, caseId: c.id })));
  if (!dryRun && crmsCases.length > 0) {
    await db.transaction(async (tx) => {
      await tx
        .insert(crmsCasesTable)
        .values(crmsCases.map((c) => ({
          id: c.id,
          caseNumber: c.caseNumber,
          isWog: c.isWog,
          fpName: c.fpName,
          fpContact: c.fpContact,
          address: c.address,
          postalCode: c.postalCode,
          lat: c.lat,
          lng: c.lng,
          locationName: c.locationName,
          details: c.details,
          status: c.status,
          assignedVehicleId: c.assignedVehicleId ?? null,
          assignedUnitCode: c.assignedUnitCode ?? null,
          receivedAt: new Date(c.receivedAt),
          acknowledgedAt: c.acknowledgedAt ? new Date(c.acknowledgedAt) : null,
          fpUpdatedAt: c.fpUpdatedAt ? new Date(c.fpUpdatedAt) : null,
          assistanceProvidedAt: c.assistanceProvidedAt ? new Date(c.assistanceProvidedAt) : null,
          resolvedAt: c.resolvedAt ? new Date(c.resolvedAt) : null,
          floodAssessment: c.floodAssessment ?? null,
          updateProvidedToFp: c.updateProvidedToFP ?? null,
          reportedBy: c.reportedBy,
        })))
        .onConflictDoUpdate({ target: crmsCasesTable.id, set: { status: sql`excluded.status` } });

      if (crmsComments.length > 0) {
        await tx
          .insert(crmsCommentsTable)
          .values(crmsComments.map((cm) => ({
            commentId: cm.commentId,
            caseId: cm.caseId,
            vehicleId: cm.vehicleId,
            unitCode: cm.unitCode,
            text: cm.text,
            createdAt: new Date(cm.createdAt),
          })))
          .onConflictDoNothing();
      }
    });
  }
  tables.push({ table: "crms_cases", sourceCount: crmsCases.length, upserted: dryRun ? 0 : crmsCases.length });
  tables.push({ table: "crms_comments", sourceCount: crmsComments.length, upserted: dryRun ? 0 : crmsComments.length });

  // ── wls_readings ─────────────────────────────────────────────────────────
  // Source shape is Array.from(Map.entries()) — [stationId, WLSReading][].
  const wlsEntries = readJson<[string, WlsReadingJson][]>("wls.json", []);
  if (!dryRun && wlsEntries.length > 0) {
    // The SMS-embedded "timestamp" field is free-form text with no guarantee
    // it parses to a real date — same issue as wls.ts's live ingest path,
    // same fallback (receivedAt is always a valid ISO string).
    const parseTimestamp = (raw: string, fallback: string): Date => {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? new Date(fallback) : d;
    };
    await db
      .insert(wlsReadingsTable)
      .values(wlsEntries.map(([stationId, r]) => ({
        stationId,
        rawLevel: r.rawLevel,
        alertLevel: r.alertLevel,
        direction: r.direction,
        waterLevelM: r.waterLevelM,
        copeM: r.copeM,
        criticalM: r.criticalM,
        locationName: r.locationName,
        timestamp: parseTimestamp(r.timestamp, r.receivedAt),
        receivedAt: new Date(r.receivedAt),
        senderName: r.senderName ?? null,
        messageType: r.messageType,
      })))
      .onConflictDoUpdate({ target: wlsReadingsTable.stationId, set: { rawLevel: sql`excluded.raw_level`, alertLevel: sql`excluded.alert_level` } });
  }
  tables.push({ table: "wls_readings", sourceCount: wlsEntries.length, upserted: dryRun ? 0 : wlsEntries.length });

  // ── deployments domain: deployment_teams / settings / locations / assignments ──
  const state = readJson<StateJson | null>("state.json", null);
  if (state) {
    if (!dryRun) {
      await db.transaction(async (tx) => {
        if (state.roster.length > 0) {
          await tx
            .insert(deploymentTeamsTable)
            .values(state.roster)
            .onConflictDoUpdate({
              target: deploymentTeamsTable.id,
              set: {
                vehicleId: sql`excluded.vehicle_id`,
                unitCode: sql`excluded.unit_code`,
                vehicleNumber: sql`excluded.vehicle_number`,
                partner: sql`excluded.partner`,
                shift: sql`excluded.shift`,
              },
            });
        }

        // deploymentDate was never persisted in state.json (in-memory only in
        // the original app) — no source value exists. Defaulting to today;
        // this is a mutable "today's deployment date" setting the app
        // overwrites during normal use anyway.
        const today = new Date().toISOString().slice(0, 10);
        await tx
          .insert(deploymentSettingsTable)
          .values({ id: 1, activeShifts: state.activeShifts, activeTeams: state.activeTeams, deploymentDate: today })
          .onConflictDoUpdate({
            target: deploymentSettingsTable.id,
            set: { activeShifts: sql`excluded.active_shifts`, activeTeams: sql`excluded.active_teams` },
          });

        if (state.customLocations.length > 0) {
          await tx
            .insert(deploymentLocationsTable)
            .values(state.customLocations.map(([, loc]) => ({
              id: loc.id,
              name: loc.name,
              address: loc.address,
              lat: loc.lat,
              lng: loc.lng,
              region: loc.region ?? null,
              priority: loc.priority ?? null,
            })))
            .onConflictDoUpdate({
              target: deploymentLocationsTable.id,
              set: { name: sql`excluded.name`, address: sql`excluded.address`, lat: sql`excluded.lat`, lng: sql`excluded.lng` },
            });
        }

        if (state.assignments.length > 0) {
          await tx
            .insert(deploymentAssignmentsTable)
            .values(state.assignments.map((a) => ({
              vehicleId: a.vehicleId,
              vehicleNumber: a.vehicleNumber,
              unitCode: a.unitCode,
              locationId: a.locationId,
              locationName: a.locationName,
              lat: a.lat,
              lng: a.lng,
              assignedAt: new Date(a.assignedAt),
              status: a.status,
              assignedBy: a.assignedBy ?? null,
              previousLocationId: a.previousLocationId ?? null,
              previousLocationName: a.previousLocationName ?? null,
            })))
            .onConflictDoUpdate({ target: deploymentAssignmentsTable.vehicleId, set: { status: sql`excluded.status` } });
        }
      });
    }
    // Computed independent of dryRun (like every other warning in this
    // script) so `--dry-run` accurately previews what the live run would
    // report, instead of silently skipping this one warning.
    warnings.push(`deployment_settings.deployment_date has no source value in state.json — defaulted to today (${new Date().toISOString().slice(0, 10)})`);
  }
  tables.push({ table: "deployment_teams", sourceCount: state?.roster.length ?? 0, upserted: dryRun ? 0 : state?.roster.length ?? 0 });
  tables.push({ table: "deployment_settings", sourceCount: state ? 1 : 0, upserted: dryRun || !state ? 0 : 1 });
  tables.push({ table: "deployment_locations", sourceCount: state?.customLocations.length ?? 0, upserted: dryRun ? 0 : state?.customLocations.length ?? 0 });
  tables.push({ table: "deployment_assignments", sourceCount: state?.assignments.length ?? 0, upserted: dryRun ? 0 : state?.assignments.length ?? 0 });

  // deployment_entries / deployment_reassignment_history / deployment_vehicle_positions /
  // deployment_swap_requests / deployment_alerts / deployment_alert_acknowledgments:
  // purely in-memory in the original app, never written to state.json or any
  // other file — nothing to backfill (matches the schema ticket's finding).

  return { domain: "02 core ops state", tables, warnings };
}
