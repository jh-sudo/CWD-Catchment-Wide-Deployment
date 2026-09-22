import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, ne, isNotNull, inArray } from "drizzle-orm";
import { requireManager } from "./auth.js";
import type { ManagerAccount } from "./auth.js";
import { getManager } from "./auth.js";
import { sendToCrewOfficer } from "./push.js";
import {
  db,
  officersTable,
  rosterOverridesTable,
  rosterLeavesTable,
  leaveRequestsTable,
  rosterCycleMetaTable,
  rosterCycleDutiesTable,
  type Officer,
} from "@workspace/db";

// ── Types ─────────────────────────────────────────────────────────────────────
export type LeaveRequestStatus =
  | "PENDING_COVER"   // submitted, waiting for cover officer to accept
  | "PENDING_IC"      // cover accepted, waiting for IC to approve
  | "APPROVED"        // IC approved → committed to leaves
  | "REJECTED"        // IC rejected
  | "CANCELLED";      // requester cancelled

export interface LeaveRequest {
  id: string;
  // Requester (crew)
  officerId: string;
  officerName: string;
  officerCatchment: string;
  // Leave details
  date: string;
  leaveType: string;
  reason?: string;
  // Cover officer
  coverOfficerId?: string;
  coverOfficerName?: string;
  coverStatus?: "PENDING" | "ACCEPTED" | "DECLINED";
  coverRespondedAt?: string;
  coverDeclineReason?: string;
  // IC approval
  icAccountId?: string;
  icName?: string;
  icStatus?: "PENDING" | "APPROVED" | "REJECTED";
  icReviewedAt?: string;
  icNote?: string;
  // Metadata
  status: LeaveRequestStatus;
  createdAt: string;
  updatedAt: string;
  lastEditedBy?: string;
  lastEditedOn?: string;
  // Reference to committed leave entry (after approval)
  committedLeaveId?: string;
  // "Chain of cover" — set when this request's officer was themselves
  // currently covering someone else; references that ORIGINAL absent
  // officer. .scratch/replit-resync-2026-09-21/issues/25.
  replacementForOfficerId?: string;
}

function toApiRequest(row: typeof leaveRequestsTable.$inferSelect): LeaveRequest {
  return {
    id: row.id,
    officerId: row.officerId,
    officerName: row.officerName,
    officerCatchment: row.officerCatchment,
    date: row.date,
    leaveType: row.leaveType,
    reason: row.reason ?? undefined,
    coverOfficerId: row.coverOfficerId ?? undefined,
    coverOfficerName: row.coverOfficerName ?? undefined,
    coverStatus: (row.coverStatus as LeaveRequest["coverStatus"]) ?? undefined,
    coverRespondedAt: row.coverRespondedAt?.toISOString(),
    coverDeclineReason: row.coverDeclineReason ?? undefined,
    icAccountId: row.icAccountId ?? undefined,
    icName: row.icName ?? undefined,
    icStatus: (row.icStatus as LeaveRequest["icStatus"]) ?? undefined,
    icReviewedAt: row.icReviewedAt?.toISOString(),
    icNote: row.icNote ?? undefined,
    status: row.status as LeaveRequestStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastEditedBy: row.lastEditedBy ?? undefined,
    lastEditedOn: row.lastEditedOn?.toISOString(),
    committedLeaveId: row.committedLeaveId ?? undefined,
    replacementForOfficerId: row.replacementForOfficerId ?? undefined,
  };
}

async function loadOfficers(): Promise<Officer[]> {
  return db.select().from(officersTable);
}

// ── Scheduled duty lookup (Excel cycle only — no generator fallback, matching
// the original file's behavior). Not cached like rosterPlan.ts's
// ensureCycleCacheLoaded()/getDutyFromCycle() — this file's endpoints are
// low-frequency admin/crew actions, not the hot summary-rendering path. ──────
async function getScheduledDuty(unitCode: string, dateStr: string): Promise<string | null> {
  const [meta] = await db.select().from(rosterCycleMetaTable).where(eq(rosterCycleMetaTable.id, 1));
  if (!meta) return null;
  const startMs = new Date(meta.cycleStartDate + "T00:00:00Z").getTime();
  const dateMs = new Date(dateStr + "T00:00:00Z").getTime();
  if (dateMs < startMs) return null;
  const dayIndex = Math.floor((dateMs - startMs) / 86_400_000) % meta.cycleLengthDays;
  const wrappedDate = new Date(startMs + dayIndex * 86_400_000).toISOString().slice(0, 10);
  const [row] = await db
    .select()
    .from(rosterCycleDutiesTable)
    .where(and(eq(rosterCycleDutiesTable.unitCode, unitCode), eq(rosterCycleDutiesTable.date, wrappedDate)));
  return row?.targetDuty ?? null;
}

// ── Helper: get calling account ───────────────────────────────────────────────
function getCallerAccount(req: any): ManagerAccount | null {
  const mid = req.session?.managerId;
  if (!mid) return null;
  return getManager(mid) ?? null;
}

// ── Router ────────────────────────────────────────────────────────────────────
export const leaveRequestRouter = Router();

// GET /api/leave-requests  — list, filtered by role
leaveRequestRouter.get("/leave-requests", requireManager, async (req, res) => {
  const caller = getCallerAccount(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const rows = await db.select().from(leaveRequestsTable);
  let requests = rows.map(toApiRequest);

  if (caller.role === "crew") {
    // Crew sees only their own requests
    requests = requests.filter(r => r.officerId === caller.officerId);
  } else if (caller.role === "ic") {
    // IC sees requests from their catchments AND requests where they are the cover officer
    const catchments = caller.catchments ?? [];
    requests = requests.filter(r =>
      catchments.includes(r.officerCatchment) ||
      r.coverOfficerId === caller.officerId
    );
  }
  // admin/manager sees all

  const sortKey = (r: LeaveRequest) => r.lastEditedOn ?? r.updatedAt ?? r.createdAt;
  res.json(requests.sort((a, b) => sortKey(b).localeCompare(sortKey(a))));
});

// GET /api/leave-requests/pending-cover — requests I need to respond to as cover
leaveRequestRouter.get("/leave-requests/pending-cover", requireManager, async (req, res) => {
  const caller = getCallerAccount(req);
  if (!caller || !caller.officerId) { res.json([]); return; }

  const rows = await db
    .select()
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.coverOfficerId, caller.officerId), eq(leaveRequestsTable.coverStatus, "PENDING")));
  res.json(rows.map(toApiRequest));
});

// GET /api/leave-requests/pending-ic — requests waiting for IC approval in my catchments
leaveRequestRouter.get("/leave-requests/pending-ic", requireManager, async (req, res) => {
  const caller = getCallerAccount(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  if (caller.role !== "ic" && caller.role !== "admin" && caller.role !== "manager") {
    res.json([]); return;
  }

  const rows = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.status, "PENDING_IC"));
  let requests = rows.map(toApiRequest);

  if (caller.role === "ic") {
    const catchments = caller.catchments ?? [];
    requests = requests.filter(r => catchments.includes(r.officerCatchment));
  }

  res.json(requests);
});

// POST /api/leave-requests — Any approved account may apply leave for an officer.
// Crew accounts apply for their own linked officer; managers/IC/admin may specify any officerId.
// Applied leave is immediately approved and committed (no pending workflow).
leaveRequestRouter.post("/leave-requests", requireManager, async (req, res) => {
  const caller = getCallerAccount(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { date, leaveType, reason, coverOfficerId } = req.body as {
    date: string;
    leaveType: string;
    reason?: string;
    coverOfficerId?: string;
  };

  if (!date || !leaveType) {
    res.status(400).json({ error: "date and leaveType required" }); return;
  }

  // Duty codes (ND/DAY/PD/OFF/REST) are direct overrides — not leave records.
  // They must not set onLeave or create a leave request entry.
  const DUTY_CODES = new Set(["ND", "DAY", "PD", "OFF", "REST"]);

  const officers = await loadOfficers();

  // Resolve the officer being put on leave (body.officerId or caller's linked officer)
  let officerId = caller.officerId;
  let officerName = caller.officerName;

  const bodyOfficerId = (req.body as any).officerId as string | undefined;
  if (bodyOfficerId) {
    const bodyOfficer = officers.find(o => o.id === bodyOfficerId);
    if (!bodyOfficer) { res.status(404).json({ error: "Officer not found" }); return; }
    // All management roles (admin/manager/ic) may apply leave for any officer
    officerId = bodyOfficer.id;
    officerName = bodyOfficer.name;
  }

  if (!officerId) {
    res.status(400).json({ error: "No officer specified or linked to your account" }); return;
  }

  const officer = officers.find(o => o.id === officerId);
  if (!officer) { res.status(404).json({ error: "Officer not found" }); return; }

  // Duty codes: direct override only — no leave record, no onLeave flag, no brackets
  if (DUTY_CODES.has(leaveType)) {
    await db.transaction(async (tx) => {
      await tx
        .delete(rosterOverridesTable)
        .where(and(eq(rosterOverridesTable.officerId, officer.id), eq(rosterOverridesTable.date, date)));
      await tx.insert(rosterOverridesTable).values({ officerId: officer.id, date, duty: leaveType });
    });
    res.json({ success: true, type: "duty_override", duty: leaveType, officerId: officer.id, officerName: officer.name, date });
    return;
  }

  let coverOfficer: Officer | undefined;
  let coverOfficerName: string | undefined;
  if (coverOfficerId) {
    if (coverOfficerId === officerId) {
      res.status(400).json({ error: "An officer cannot cover their own leave" }); return;
    }
    coverOfficer = officers.find(o => o.id === coverOfficerId);
    if (!coverOfficer) { res.status(404).json({ error: "Cover officer not found" }); return; }
    coverOfficerName = coverOfficer.name;
  }

  // "Chain of cover" — if this officer is themselves currently covering
  // someone else's leave on this date, granting them leave too would leave
  // that other post uncovered again unless a replacement takes over. Find
  // that original leave record (if any) so the validation and the
  // cover-officer assignment below can target it instead of this officer's
  // own (usually non-existent, since they're on duty) required-cover check.
  // .scratch/replit-resync-2026-09-21/issues/25.
  const [activeCoveredLeave] = await db
    .select()
    .from(rosterLeavesTable)
    .where(and(eq(rosterLeavesTable.date, date), eq(rosterLeavesTable.coveringOfficerId, officerId), ne(rosterLeavesTable.officerId, officerId)));
  const coveredPositionOfficer = activeCoveredLeave
    ? officers.find(o => o.id === activeCoveredLeave.officerId)
    : undefined;

  // Cover-officer validation — without this, any approved account could
  // apply DAY/PD leave with no cover at all (a silently unfilled shift), or
  // assign a cover officer who is themselves working, already on leave, or
  // already covering someone else that date. Found via a Replit-resync diff
  // triage (.scratch/replit-resync-2026-09-21/issues/03).
  let requiredCoverDuty: string | null = null;
  {
    const utcDay = new Date(date + "T00:00:00Z").getUTCDay();
    const isWeekend = utcDay === 0 || utcDay === 6;
    const absentDuty = await getScheduledDuty(officer.unitCode, date);
    const coveredPositionDuty = coveredPositionOfficer
      ? await getScheduledDuty(coveredPositionOfficer.unitCode, date)
      : null;
    requiredCoverDuty = coveredPositionDuty ?? absentDuty;

    if (!coverOfficer && (!!activeCoveredLeave || absentDuty === "DAY" || absentDuty === "PD")) {
      res.status(400).json({
        error: activeCoveredLeave
          ? `You are covering ${activeCoveredLeave.officerName}; choose a replacement cover officer`
          : "A cover officer is required for DAY/PD duty",
      });
      return;
    }

    if (coverOfficer) {
      const coverDuty = await getScheduledDuty(coverOfficer.unitCode, date);
      const eligible = isWeekend
        ? coverDuty === "OFF" || coverDuty === "REST"
        : coverDuty === "ND" || coverDuty === "OFF";
      if (!eligible) {
        res.status(400).json({
          error: `${coverOfficer.name} is not available to cover on ${date} (scheduled ${coverDuty})`,
        });
        return;
      }
      const [selfOnLeave] = await db
        .select({ id: rosterLeavesTable.id })
        .from(rosterLeavesTable)
        .where(and(eq(rosterLeavesTable.date, date), eq(rosterLeavesTable.officerId, coverOfficer.id)));
      if (selfOnLeave) {
        res.status(409).json({ error: `${coverOfficer.name} is already on leave on ${date}` }); return;
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
        res.status(409).json({ error: `${coverOfficer.name} is already covering another officer on ${date}` });
        return;
      }
    }
  }

  // Prevent duplicate for same officer + date
  const existingRows = await db
    .select()
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.officerId, officerId), eq(leaveRequestsTable.date, date)));
  const existing = existingRows.find(r =>
    r.status === "PENDING_COVER" || r.status === "PENDING_IC" || r.status === "APPROVED"
  );
  if (existing) {
    res.status(409).json({ error: "A leave entry already exists for this officer on that date" }); return;
  }

  const now = new Date();
  const leaveEntryId = randomUUID();
  const requestId = randomUUID();
  const callerName = caller.officerName ?? caller.username;
  // Who the new cover officer actually ends up covering — the chain target
  // when this is a chain-of-cover handoff, otherwise this officer.
  const coveredOfficerId = activeCoveredLeave?.officerId ?? officer.id;

  try {
    await db.transaction(async (tx) => {
      // Directly commit as APPROVED — management is the approving authority.
      // When this is a chain-of-cover handoff, this leave record's own
      // covering fields stay null — the cover officer is recorded against
      // the ORIGINAL leave record (activeCoveredLeave) instead, updated below.
      await tx
        .insert(rosterLeavesTable)
        .values({
          id: leaveEntryId,
          officerId: officer.id,
          officerName: officer.name,
          date,
          leaveType,
          coveringOfficerId: activeCoveredLeave ? null : (coverOfficerId ?? null),
          coveringOfficerName: activeCoveredLeave ? null : (coverOfficerName ?? null),
        })
        .onConflictDoUpdate({
          target: [rosterLeavesTable.officerId, rosterLeavesTable.date],
          set: {
            leaveType,
            coveringOfficerId: activeCoveredLeave ? null : (coverOfficerId ?? null),
            coveringOfficerName: activeCoveredLeave ? null : (coverOfficerName ?? null),
          },
        });

      // Chain of cover: hand the covering assignment off to the new cover
      // officer on the ORIGINAL leave record. .scratch/replit-resync-2026-09-21/issues/25.
      if (activeCoveredLeave && coverOfficer) {
        await tx
          .update(rosterLeavesTable)
          .set({ coveringOfficerId: coverOfficer.id, coveringOfficerName: coverOfficer.name })
          .where(eq(rosterLeavesTable.id, activeCoveredLeave.id));
      }

      // Write duty override: actual leave code so summary builder shows correct absence type.
      // Clear any previous override for this slot first (matches original replace-not-merge
      // behavior), then recreate it with the leave type.
      await tx
        .delete(rosterOverridesTable)
        .where(and(eq(rosterOverridesTable.officerId, officer.id), eq(rosterOverridesTable.date, date)));
      // Clear any override currently covering officer.id's post, and (if
      // chained) any override currently covering the chain target's post —
      // e.g. this officer's own now-stale "covering X" override, about to
      // be replaced by the new cover officer's override below.
      await tx
        .delete(rosterOverridesTable)
        .where(
          and(
            eq(rosterOverridesTable.date, date),
            inArray(rosterOverridesTable.coverForOfficerId, [officer.id, coveredOfficerId]),
          ),
        );

      await tx.insert(rosterOverridesTable).values({
        officerId: officer.id,
        date,
        duty: leaveType,
        coveredByOfficerName: coverOfficerName ?? null,
      });

      // Override the covering officer's duty to match the covered position's
      // scheduled (cycle) duty — the chain target's when chained, otherwise
      // this officer's own — so they're displayed as working that unit's
      // shift (e.g. DAY), not their own home cycle duty (e.g. REST or ND).
      if (coverOfficer && requiredCoverDuty && requiredCoverDuty !== "OFF" && requiredCoverDuty !== "REST") {
        await tx
          .insert(rosterOverridesTable)
          .values({ officerId: coverOfficer.id, date, duty: requiredCoverDuty, coverForOfficerId: coveredOfficerId })
          .onConflictDoUpdate({
            target: [rosterOverridesTable.officerId, rosterOverridesTable.date],
            set: { duty: requiredCoverDuty, coverForOfficerId: coveredOfficerId },
          });
      }

      await tx.insert(leaveRequestsTable).values({
        id: requestId,
        officerId: officer.id,
        officerName: officer.name,
        officerCatchment: officer.catchment,
        date,
        leaveType,
        reason: reason ?? null,
        coverOfficerId: coverOfficerId ?? null,
        coverOfficerName: coverOfficerName ?? null,
        coverStatus: coverOfficerId ? "ACCEPTED" : null,
        replacementForOfficerId: activeCoveredLeave?.officerId ?? null,
        icAccountId: caller.id,
        icName: callerName,
        icStatus: "APPROVED",
        icReviewedAt: now,
        status: "APPROVED",
        committedLeaveId: leaveEntryId,
        createdAt: now,
        updatedAt: now,
        lastEditedBy: callerName,
        lastEditedOn: now,
      });
    });
  } catch (err) {
    const pgCode = (err as { code?: string } | null)?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "A leave entry already exists for this officer on that date" });
      return;
    }
    if (pgCode === "23503") {
      res.status(400).json({ error: `Unknown leaveType "${leaveType}"` });
      return;
    }
    throw err;
  }

  const [requestRow] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, requestId));
  const request = toApiRequest(requestRow);

  // Notify the officer that their leave has been applied
  sendToCrewOfficer(officer.id, {
    title: "Leave Applied",
    body: `Your ${leaveType} on ${date} has been applied${coverOfficerName ? ` · Cover: ${coverOfficerName}` : ""}.`,
    tag: `leave-applied-${officer.id}-${date}`,
    url: "/roster/my-applications",
  }).catch(() => {});

  res.json(request);
});

// POST /api/leave-requests/:id/cover-respond — cover officer accepts or declines
leaveRequestRouter.post("/leave-requests/:id/cover-respond", requireManager, async (req, res) => {
  const caller = getCallerAccount(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [request] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, req.params.id as string));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }

  // Only the named cover officer (or admin/manager) can respond
  const isAuthorised =
    caller.role === "admin" || caller.role === "manager" ||
    (caller.officerId && caller.officerId === request.coverOfficerId);
  if (!isAuthorised) {
    res.status(403).json({ error: "Not authorised to respond to this cover request" }); return;
  }

  if (request.status !== "PENDING_COVER") {
    res.status(400).json({ error: `Request is in state ${request.status}, cannot respond to cover` }); return;
  }

  const { accepted, declineReason } = req.body as { accepted: boolean; declineReason?: string };
  const now = new Date();
  const coverCallerName = caller.officerName ?? caller.username;

  const patch = accepted
    ? {
        coverStatus: "ACCEPTED",
        coverRespondedAt: now,
        status: "PENDING_IC",
        updatedAt: now,
        lastEditedBy: coverCallerName,
        lastEditedOn: now,
      }
    : {
        coverStatus: "DECLINED",
        coverRespondedAt: now,
        coverDeclineReason: declineReason ?? null,
        status: "PENDING_COVER",  // stays pending — requester must pick another cover
        updatedAt: now,
        lastEditedBy: coverCallerName,
        lastEditedOn: now,
      };

  const [updated] = await db
    .update(leaveRequestsTable)
    .set(patch)
    .where(eq(leaveRequestsTable.id, request.id))
    .returning();
  res.json(toApiRequest(updated));
});

// POST /api/leave-requests/:id/cover-change — requester changes cover officer after decline
leaveRequestRouter.post("/leave-requests/:id/cover-change", requireManager, async (req, res) => {
  const caller = getCallerAccount(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [request] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, req.params.id as string));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }

  const isAuthorised =
    caller.role === "admin" || caller.role === "manager" ||
    (caller.officerId && caller.officerId === request.officerId);
  if (!isAuthorised) {
    res.status(403).json({ error: "Not authorised" }); return;
  }

  const { coverOfficerId } = req.body as { coverOfficerId: string };
  const [coverOfficer] = await db.select().from(officersTable).where(eq(officersTable.id, coverOfficerId));
  if (!coverOfficer) { res.status(404).json({ error: "Cover officer not found" }); return; }

  const now = new Date();
  const changeCallerName = caller.officerName ?? caller.username;

  const [updated] = await db
    .update(leaveRequestsTable)
    .set({
      coverOfficerId: coverOfficer.id,
      coverOfficerName: coverOfficer.name,
      coverStatus: "PENDING",
      coverRespondedAt: null,
      coverDeclineReason: null,
      status: "PENDING_COVER",
      updatedAt: now,
      lastEditedBy: changeCallerName,
      lastEditedOn: now,
    })
    .where(eq(leaveRequestsTable.id, request.id))
    .returning();
  res.json(toApiRequest(updated));
});

// POST /api/leave-requests/:id/ic-review — IC approves or rejects
leaveRequestRouter.post("/leave-requests/:id/ic-review", requireManager, async (req, res) => {
  const caller = getCallerAccount(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  if (caller.role !== "ic" && caller.role !== "admin" && caller.role !== "manager") {
    res.status(403).json({ error: "IC or admin access required" }); return;
  }

  const [request] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, req.params.id as string));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }

  // IC can only approve requests in their catchments
  if (caller.role === "ic") {
    const catchments = caller.catchments ?? [];
    if (!catchments.includes(request.officerCatchment)) {
      res.status(403).json({ error: "This request is outside your catchment" }); return;
    }
  }

  if (request.status !== "PENDING_IC") {
    res.status(400).json({ error: `Request is in state ${request.status}, not pending IC review` }); return;
  }

  const { approved, note } = req.body as { approved: boolean; note?: string };
  const now = new Date();
  const icCallerName = caller.officerName ?? caller.username;

  if (approved) {
    const leaveEntryId = randomUUID();
    const coveringOfficerId = request.coverStatus === "ACCEPTED" ? (request.coverOfficerId ?? undefined) : undefined;
    const coveringOfficerName = request.coverStatus === "ACCEPTED" ? (request.coverOfficerName ?? undefined) : undefined;

    const allOfficers = await loadOfficers();
    const absentOfficer = allOfficers.find(o => o.id === request.officerId);
    const coverOfficerIC = coveringOfficerId ? allOfficers.find(o => o.id === coveringOfficerId) : undefined;
    const scheduledDuty = (coverOfficerIC && absentOfficer)
      ? await getScheduledDuty(absentOfficer.unitCode, request.date)
      : null;

    await db.transaction(async (tx) => {
      // Commit to the leave entries
      await tx
        .insert(rosterLeavesTable)
        .values({
          id: leaveEntryId,
          officerId: request.officerId,
          officerName: request.officerName,
          date: request.date,
          leaveType: request.leaveType,
          coveringOfficerId: coveringOfficerId ?? null,
          coveringOfficerName: coveringOfficerName ?? null,
        })
        .onConflictDoUpdate({
          target: [rosterLeavesTable.officerId, rosterLeavesTable.date],
          set: { leaveType: request.leaveType, coveringOfficerId: coveringOfficerId ?? null, coveringOfficerName: coveringOfficerName ?? null },
        });

      // Write a duty override so the schedule view shows LEAVE for this officer on this date.
      // Also set the covering officer's duty to the absent officer's scheduled (cycle) duty.
      await tx
        .delete(rosterOverridesTable)
        .where(and(eq(rosterOverridesTable.officerId, request.officerId), eq(rosterOverridesTable.date, request.date)));
      if (coverOfficerIC) {
        await tx
          .delete(rosterOverridesTable)
          .where(
            and(
              eq(rosterOverridesTable.officerId, coverOfficerIC.id),
              eq(rosterOverridesTable.date, request.date),
              isNotNull(rosterOverridesTable.coverForOfficerId),
            ),
          );
      }
      await tx.insert(rosterOverridesTable).values({ officerId: request.officerId, date: request.date, duty: "LEAVE" });
      if (coverOfficerIC && absentOfficer && scheduledDuty && scheduledDuty !== "OFF" && scheduledDuty !== "REST") {
        await tx
          .insert(rosterOverridesTable)
          .values({ officerId: coverOfficerIC.id, date: request.date, duty: scheduledDuty, coverForOfficerId: absentOfficer.id })
          .onConflictDoUpdate({
            target: [rosterOverridesTable.officerId, rosterOverridesTable.date],
            set: { duty: scheduledDuty, coverForOfficerId: absentOfficer.id },
          });
      }

      await tx
        .update(leaveRequestsTable)
        .set({
          icAccountId: caller.id,
          icName: icCallerName,
          icStatus: "APPROVED",
          icReviewedAt: now,
          icNote: note ?? null,
          status: "APPROVED",
          committedLeaveId: leaveEntryId,
          updatedAt: now,
          lastEditedBy: icCallerName,
          lastEditedOn: now,
        })
        .where(eq(leaveRequestsTable.id, request.id));
    });

    sendToCrewOfficer(request.officerId, {
      title: "Leave Approved ✓",
      body: `Your ${request.leaveType} on ${request.date} has been approved by ${icCallerName}.`,
      tag: `leave-approved-${request.officerId}-${request.date}`,
      url: "/roster/my-applications",
    }).catch(() => {});
  } else {
    await db
      .update(leaveRequestsTable)
      .set({
        icAccountId: caller.id,
        icName: icCallerName,
        icStatus: "REJECTED",
        icReviewedAt: now,
        icNote: note ?? null,
        status: "REJECTED",
        updatedAt: now,
        lastEditedBy: icCallerName,
        lastEditedOn: now,
      })
      .where(eq(leaveRequestsTable.id, request.id));

    sendToCrewOfficer(request.officerId, {
      title: "Leave Update",
      body: `Your ${request.leaveType} on ${request.date} was not approved${note ? ` · ${note}` : ""}.`,
      tag: `leave-rejected-${request.officerId}-${request.date}`,
      url: "/roster/my-applications",
    }).catch(() => {});
  }

  const [updated] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, request.id));
  res.json(toApiRequest(updated));
});

// DELETE /api/leave-requests/:id — cancel (requester or admin)
leaveRequestRouter.delete("/leave-requests/:id", requireManager, async (req, res) => {
  const caller = getCallerAccount(req);
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [request] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, req.params.id as string));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }

  const isAuthorised =
    caller.role === "admin" || caller.role === "manager" || caller.role === "ic" ||
    (caller.officerId && caller.officerId === request.officerId);
  if (!isAuthorised) {
    res.status(403).json({ error: "Not authorised" }); return;
  }

  await db.transaction(async (tx) => {
    if (request.status === "APPROVED") {
      // Remove the committed leave entry
      if (request.committedLeaveId) {
        await tx.delete(rosterLeavesTable).where(eq(rosterLeavesTable.id, request.committedLeaveId));
      }
      // Chain of cover: cancelling a handoff means this officer resumes
      // covering the original absent officer — hand the covering assignment
      // back to them on the original leave record.
      // .scratch/replit-resync-2026-09-21/issues/25.
      if (request.replacementForOfficerId) {
        await tx
          .update(rosterLeavesTable)
          .set({ coveringOfficerId: request.officerId, coveringOfficerName: request.officerName })
          .where(
            and(
              eq(rosterLeavesTable.officerId, request.replacementForOfficerId),
              eq(rosterLeavesTable.date, request.date),
            ),
          );
      }
      // Remove the absent officer's override AND any auto-generated cover override
      await tx
        .delete(rosterOverridesTable)
        .where(and(eq(rosterOverridesTable.officerId, request.officerId), eq(rosterOverridesTable.date, request.date)));
      await tx
        .delete(rosterOverridesTable)
        .where(
          and(
            eq(rosterOverridesTable.date, request.date),
            eq(rosterOverridesTable.coverForOfficerId, request.replacementForOfficerId ?? request.officerId),
          ),
        );
      if (request.replacementForOfficerId) {
        // Recreate the resumed coverer's duty override for the original
        // covered position, if their current duty isn't already OFF/REST.
        const officers = await loadOfficers();
        const originalOfficer = officers.find(o => o.id === request.replacementForOfficerId);
        const resumedCoverer = officers.find(o => o.id === request.officerId);
        const duty = originalOfficer ? await getScheduledDuty(originalOfficer.unitCode, request.date) : null;
        if (resumedCoverer && duty && duty !== "OFF" && duty !== "REST") {
          await tx.insert(rosterOverridesTable).values({
            officerId: resumedCoverer.id,
            date: request.date,
            duty,
            coverForOfficerId: request.replacementForOfficerId,
          });
        }
      }
    }

    // Fully remove the request record so it disappears from the audit log
    await tx.delete(leaveRequestsTable).where(eq(leaveRequestsTable.id, request.id));
  });

  res.json({ success: true });
});
