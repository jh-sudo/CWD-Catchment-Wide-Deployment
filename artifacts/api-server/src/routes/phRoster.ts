import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { requireManager, getManager } from "./auth.js";
import { applyPHRoster } from "./rosterPlan.js";
import {
  db,
  officersTable,
  rosterSwapsTable,
  phRosterRefTable,
  phRosterOverridesTable,
  phBallotTable,
  phFaqTable,
  phHrBallotStateTable,
  phRotationStateTable,
  phBuilderConfigTable,
  phBuilderPresetsTable,
} from "@workspace/db";
import {
  buildHRBallotPoolSummary,
  drawFromHRBallot as drawHRBallot,
  rebuildHRBallotPoolFromHistory,
  type HRBallotState,
  type HRBallotPoolState,
  type HRCycleColor,
  type HRPoolKind,
} from "../lib/hrBallot.js";

interface PHRefRow {
  rowIndex: number;
  subCatchment: string;
  shift: string;
  scheduledName: string;
  actualName: string;
  remarks?: string;
}

type PHRosterRef = Record<string, PHRefRow[]>;

async function loadAllPHRosterRef(): Promise<PHRosterRef> {
  const rows = await db.select().from(phRosterRefTable);
  const grouped: PHRosterRef = {};
  for (const r of rows) {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push({
      rowIndex: r.rowIndex,
      subCatchment: r.subCatchment ?? "",
      shift: r.shift ?? "",
      scheduledName: r.scheduledName ?? "",
      actualName: r.actualName ?? "",
      remarks: r.remarks ?? undefined,
    });
  }
  for (const date of Object.keys(grouped)) grouped[date].sort((a, b) => a.rowIndex - b.rowIndex);
  return grouped;
}

async function loadPHRosterRefForDate(date: string): Promise<PHRefRow[]> {
  const rows = await db.select().from(phRosterRefTable).where(eq(phRosterRefTable.date, date));
  return rows
    .map((r) => ({
      rowIndex: r.rowIndex,
      subCatchment: r.subCatchment ?? "",
      shift: r.shift ?? "",
      scheduledName: r.scheduledName ?? "",
      actualName: r.actualName ?? "",
      remarks: r.remarks ?? undefined,
    }))
    .sort((a, b) => a.rowIndex - b.rowIndex);
}

async function savePHRosterRefForDate(date: string, rows: PHRefRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(phRosterRefTable).where(eq(phRosterRefTable.date, date));
    if (rows.length > 0) {
      await tx.insert(phRosterRefTable).values(
        rows.map((r) => ({
          date,
          rowIndex: r.rowIndex,
          subCatchment: r.subCatchment,
          shift: r.shift,
          scheduledName: r.scheduledName,
          actualName: r.actualName,
          remarks: r.remarks ?? null,
        })),
      );
    }
  });
}

interface BallotEntry {
  id: string;
  unitCode: string;
  shift: string;
  officerName: string;
}

async function loadBallotForDate(date: string): Promise<BallotEntry[]> {
  const rows = await db.select().from(phBallotTable).where(eq(phBallotTable.date, date));
  return rows.map((r) => ({ id: r.id, unitCode: r.unitCode ?? "", shift: r.shift ?? "", officerName: r.officerName ?? "" }));
}

async function saveBallotForDate(date: string, entries: BallotEntry[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(phBallotTable).where(eq(phBallotTable.date, date));
    if (entries.length > 0) {
      await tx.insert(phBallotTable).values(
        entries.map((e) => ({ id: e.id, date, unitCode: e.unitCode, shift: e.shift, officerName: e.officerName })),
      );
    }
  });
}

const DEFAULT_FAQ = `PH Roster
3 PD and 3 DAY teams are scheduled for PH. Teams are balanced and no. of PH are evenly distributed yearly.

OIL (Off In Lieu)
OIL is only granted when a PH falls on a Sunday. The following Monday becomes an OIL day.
• OIL is NOT granted for other in-lieu days (e.g. Saturday PH → Monday is still a regular PH, not OIL)
• OIL must be utilised within 6 months. For officers ES13 and below, OIL can be encashed once the 6-month window has lapsed.

Scheduling of PH
PH are scheduled based on:
• No consecutive back-to-back PH
• No duplicate PH as of previous year*
• *With exception for racial holidays
• Officers on Target duty are scheduled to work and must deploy OIL

Special Case Scenario:
For PH that falls on Sunday — Batmon#
• PH Roster on Sunday: follows Sunday Target duty
• PH Roster on Monday (OIL): also follows the Sunday Target duty (not Monday's schedule)`;

type PHRosterOverrides = Record<string, Record<string, {
  actualOfficerName: string;
  actualOfficerId: string;
  swapDone: boolean;
  remarks: string;
}>>;

async function loadPHRosterOverridesForDate(date: string): Promise<PHRosterOverrides[string]> {
  const rows = await db.select().from(phRosterOverridesTable).where(eq(phRosterOverridesTable.date, date));
  const out: PHRosterOverrides[string] = {};
  for (const r of rows) {
    out[r.slotKey] = {
      actualOfficerName: r.actualOfficerName ?? "",
      actualOfficerId: r.actualOfficerId ?? "",
      swapDone: r.swapDone ?? false,
      remarks: r.remarks ?? "",
    };
  }
  return out;
}

async function savePHRosterOverridesForDate(date: string, overrides: PHRosterOverrides[string]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(phRosterOverridesTable).where(eq(phRosterOverridesTable.date, date));
    const entries = Object.entries(overrides);
    if (entries.length > 0) {
      await tx.insert(phRosterOverridesTable).values(
        entries.map(([slotKey, v]) => ({
          date,
          slotKey,
          actualOfficerName: v.actualOfficerName || null,
          actualOfficerId: v.actualOfficerId || null,
          swapDone: v.swapDone ?? false,
          remarks: v.remarks || null,
        })),
      );
    }
  });
}

async function loadFaq(): Promise<string> {
  const [row] = await db.select().from(phFaqTable).where(eq(phFaqTable.id, 1));
  return row?.text ?? DEFAULT_FAQ;
}

async function saveFaq(text: string): Promise<void> {
  await db
    .insert(phFaqTable)
    .values({ id: 1, text })
    .onConflictDoUpdate({ target: phFaqTable.id, set: { text } });
}

export const phRosterRouter = Router();

// GET /api/ph-roster-ref/counter — public aggregated PH duty counts per officer per year
// OIL-copy dates AND in-lieu dates are excluded; only actual (non-in-lieu) PH duties counted.
phRosterRouter.get("/ph-roster-ref/counter", async (_req, res) => {
  const all = await loadAllPHRosterRef();

  // Exclude both OIL-copy dates AND any date whose phName contains "(In Lieu)"
  // PH_YEAR_SLOTS covers 2027+; PH_DATE_NAMES covers all years including 2026.
  const excludedDates = new Set<string>();
  for (const slots of Object.values(PH_YEAR_SLOTS)) {
    for (const slot of slots) {
      if (slot.isOilCopy || slot.phName.includes("In Lieu")) excludedDates.add(slot.date);
    }
  }
  for (const [date, name] of Object.entries(PH_DATE_NAMES)) {
    if (name.includes("In Lieu")) excludedDates.add(date);
  }

  const counts: Record<string, Record<number, number>> = {};
  const detail: Record<string, Record<number, Array<{ date: string; phName: string }>>> = {};
  for (const [date, rows] of Object.entries(all)) {
    if (excludedDates.has(date)) continue;
    const year = parseInt(date.slice(0, 4), 10);
    const phName = PH_DATE_NAMES[date] ?? date;
    for (const row of rows) {
      const name = (row.scheduledName ?? "").trim();
      if (!name) continue;
      if (!counts[name]) counts[name] = {};
      counts[name][year] = (counts[name][year] ?? 0) + 1;
      if (!detail[name]) detail[name] = {};
      if (!detail[name][year]) detail[name][year] = [];
      if (!detail[name][year].some(e => e.date === date)) {
        detail[name][year].push({ date, phName });
      }
    }
  }

  res.json({ counts, detail });
});

// GET /api/ph-roster-ref/hr-ballot-pool — current HR ballot pool state (any logged-in user).
// Derived live from the scheduled PH roster (same derivation auto-allocate
// uses), not read from the persisted ph_hr_ballot_state row — that row is
// just what the last auto-allocate run wrote, and could drift from the live
// roster if a PH date's actualName was hand-edited afterward.
phRosterRouter.get("/ph-roster-ref/hr-ballot-pool", requireManager, async (_req, res) => {
  const ref = await loadAllPHRosterRef();
  const hrBallot = createHRBallotStateFromRoster(ref);
  res.json(buildHRBallotResponse(hrBallot, ref));
});

// PATCH /api/ph-roster-ref/hr-ballot-pool — pools are roster-derived and cannot be manually reset.
phRosterRouter.patch("/ph-roster-ref/hr-ballot-pool", requireManager, (req, res) => {
  const { poolKind } = req.body as { poolKind?: HRPoolKind };
  if (!isHRPoolKind(poolKind)) {
    res.status(400).json({ error: "poolKind must be 'puasa' or 'haji'." });
    return;
  }
  res.status(409).json({
    error: "Hari Raya ballot pools are derived from scheduled Puasa/Haji duties and refresh automatically only after every officer has served that specific holiday.",
  });
});

// These named routes must be registered before /ph-roster-ref/:date below,
// otherwise Express treats "builder-config" as a date parameter.
phRosterRouter.get("/ph-roster-ref/builder-config", requireManager, async (_req, res) => {
  res.json(await loadPHBuilderConfig());
});

phRosterRouter.put("/ph-roster-ref/builder-config", requireManager, async (req, res) => {
  try {
    const config = await loadValidatedPHBuilderConfig(req.body);
    await savePHBuilderConfig(config);
    res.json({ ok: true, config });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid PH Builder settings" });
  }
});

phRosterRouter.get("/ph-roster-ref/builder-presets", requireManager, async (_req, res) => {
  res.json({ presets: await loadPHBuilderPresets() });
});

phRosterRouter.post("/ph-roster-ref/builder-presets", requireManager, async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw new Error("Enter a name for these settings");
    if (name.length > 60) throw new Error("Settings name must be 60 characters or fewer");

    const config = await loadValidatedPHBuilderConfig(req.body?.config);
    const presets = await loadPHBuilderPresets();
    const existing = presets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const now = new Date().toISOString();
    const savedPreset: PHBuilderPreset = existing
      ? { ...existing, name, config, updatedAt: now }
      : { id: randomUUID(), name, config, updatedAt: now };

    await db
      .insert(phBuilderPresetsTable)
      .values(savedPreset)
      .onConflictDoUpdate({
        target: phBuilderPresetsTable.id,
        set: { name: savedPreset.name, config: savedPreset.config, updatedAt: savedPreset.updatedAt },
      });
    await savePHBuilderConfig(config);

    const nextPresets = existing
      ? presets.map((preset) => (preset.id === existing.id ? savedPreset : preset))
      : [savedPreset, ...presets];
    res.json({ ok: true, preset: savedPreset, presets: nextPresets, config });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not save PH Builder settings" });
  }
});

phRosterRouter.patch("/ph-roster-ref/builder-presets/:id", requireManager, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw new Error("Enter a name for these settings");
    if (name.length > 60) throw new Error("Settings name must be 60 characters or fewer");

    const presets = await loadPHBuilderPresets();
    const existing = presets.find((preset) => preset.id === id);
    if (!existing) {
      res.status(404).json({ error: "Saved PH Builder settings not found" });
      return;
    }
    const duplicate = presets.find(
      (preset) => preset.id !== id && preset.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) throw new Error("Another saved setting already uses that name");

    const updatedAt = new Date().toISOString();
    await db.update(phBuilderPresetsTable).set({ name, updatedAt }).where(eq(phBuilderPresetsTable.id, id));
    const renamedPreset = { ...existing, name, updatedAt };
    const nextPresets = presets.map((preset) => (preset.id === id ? renamedPreset : preset));
    res.json({ ok: true, preset: renamedPreset, presets: nextPresets });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not rename PH Builder settings" });
  }
});

phRosterRouter.delete("/ph-roster-ref/builder-presets/:id", requireManager, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const presets = await loadPHBuilderPresets();
    const existing = presets.find((preset) => preset.id === id);
    if (!existing) {
      res.status(404).json({ error: "Saved PH Builder settings not found" });
      return;
    }

    await db.delete(phBuilderPresetsTable).where(eq(phBuilderPresetsTable.id, id));
    const nextPresets = presets.filter((preset) => preset.id !== id);
    res.json({ ok: true, deletedPreset: existing, presets: nextPresets });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not delete PH Builder settings" });
  }
});

// GET /api/ph-roster-ref/:date — get reference rows for a date
phRosterRouter.get("/ph-roster-ref/:date", async (req, res) => {
  const { date } = req.params as { date: string };
  const rows = await loadPHRosterRefForDate(date);
  res.json({ rows });
});

// PUT /api/ph-roster-ref/:date — save updated ref rows (manager+). PH Roster
// is authoritative for Master Actual: saving immediately re-applies that
// date's Master overrides from the roster's actualName values in the SAME
// request (via applyPHRoster, shared with the manual re-apply endpoint), so
// an edited PH assignment can't leave a stale duty value behind in
// Excel > Master — this used to require a second, separately-fired frontend
// call to POST /roster-plan/ph-apply/:date.
phRosterRouter.put("/ph-roster-ref/:date", requireManager, async (req, res) => {
  const { date } = req.params as { date: string };
  const { rows, isOilMonday } = req.body as { rows?: unknown; isOilMonday?: unknown };

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "At least one PH roster row is required." });
    return;
  }

  const normalizedRows: PHRefRow[] = [];
  for (const [index, row] of rows.entries()) {
    const candidate = row as Partial<PHRefRow>;
    const subCatchment = typeof candidate.subCatchment === "string" ? candidate.subCatchment.trim() : "";
    const shift = typeof candidate.shift === "string" ? candidate.shift.trim().toUpperCase() : "";
    const scheduledName = typeof candidate.scheduledName === "string" ? candidate.scheduledName.trim() : "";
    const actualName = typeof candidate.actualName === "string" ? candidate.actualName.trim() : "";
    const remarks = typeof candidate.remarks === "string" ? candidate.remarks.trim() : "";

    if (!subCatchment || !scheduledName || !["PD", "DAY", "ND"].includes(shift)) {
      res.status(400).json({
        error: `Invalid PH roster row ${index + 1}. Unit, PD/DAY/ND shift, and scheduled officer are required.`,
      });
      return;
    }

    normalizedRows.push({
      rowIndex: typeof candidate.rowIndex === "number" ? candidate.rowIndex : index,
      subCatchment,
      shift,
      scheduledName,
      // A blank actual field means the scheduled officer worked — applyPHRoster
      // falls back to scheduledName when actualName is blank.
      actualName,
      ...(remarks ? { remarks } : {}),
    });
  }

  const scheduledNames = new Set<string>();
  const actualWorkerNames = new Set<string>();
  for (const row of normalizedRows) {
    const scheduledKey = row.scheduledName.toLowerCase();
    const actualKey = (row.actualName || row.scheduledName).toLowerCase();
    if (scheduledNames.has(scheduledKey)) {
      res.status(400).json({ error: `Duplicate scheduled officer "${row.scheduledName}" in the PH roster.` });
      return;
    }
    if (actualWorkerNames.has(actualKey)) {
      res.status(400).json({
        error: `Actual officer "${row.actualName || row.scheduledName}" cannot cover more than one PH roster row.`,
      });
      return;
    }
    scheduledNames.add(scheduledKey);
    actualWorkerNames.add(actualKey);
  }

  await savePHRosterRefForDate(date, normalizedRows);

  const mid = req.session?.managerId;
  const caller = mid ? getManager(mid) : null;
  // The PH page knows whether this is the Monday in lieu of a Sunday PH —
  // pass that through so applyPHRoster doesn't have to depend on the Sunday
  // reference rows still being present when the OIL roster is saved.
  const masterActual = await applyPHRoster(
    date,
    caller?.username,
    caller?.officerName ?? caller?.username,
    typeof isOilMonday === "boolean" ? { isOilMonday } : undefined,
  );
  if ("error" in masterActual) {
    res.status(500).json({
      error: "PH roster was saved, but Excel > Master Actual could not be updated.",
      detail: masterActual.error,
    });
    return;
  }

  res.json({ ok: true, rows: normalizedRows, masterActual });
});

// POST /api/ph-roster-ref/:date/swaps — record PH roster changes as swap entries (manager+)
// Idempotent: replaces existing PH_SWAP records for this date with the new set.
phRosterRouter.post("/ph-roster-ref/:date/swaps", requireManager, async (req, res) => {
  const { date } = req.params as { date: string };
  const mid = (req as any).session?.managerId;
  const { changes, phName, reviewerName } = req.body as {
    changes: Array<{ subCatchment: string; shift: string; scheduledName: string; actualName: string }>;
    phName: string;
    reviewerName?: string;
  };
  if (!Array.isArray(changes)) { res.status(400).json({ error: "changes array required" }); return; }

  // PH swaps are recorded by officer name, not id (the PH roster ref/ballot
  // tables are name-keyed) — but roster_swaps.requester_id/target_id are
  // NOT NULL FKs into officers(id). Resolve names to real officer ids;
  // changes that can't be resolved (unrecognised name) are skipped rather
  // than violating the FK.
  const officerRows = await db.select().from(officersTable);
  const byName = new Map(officerRows.map((o) => [o.name.trim().toLowerCase(), o]));

  const now = new Date();
  const reviewer = reviewerName ?? mid ?? null;
  const newSwaps: (typeof rosterSwapsTable.$inferInsert)[] = [];
  const skippedEntries: Array<{ scheduledName: string; actualName: string; unmatched: string[] }> = [];
  for (const c of changes) {
    const requester = byName.get(c.scheduledName.trim().toLowerCase());
    const target = byName.get(c.actualName.trim().toLowerCase());
    if (!requester || !target) {
      const unmatched: string[] = [];
      if (!requester) unmatched.push(c.scheduledName);
      if (!target) unmatched.push(c.actualName);
      skippedEntries.push({ scheduledName: c.scheduledName, actualName: c.actualName, unmatched });
      continue;
    }
    newSwaps.push({
      id: randomUUID(),
      requesterId: requester.id,
      requesterName: c.scheduledName,
      targetId: target.id,
      targetName: c.actualName,
      date,
      requesterDuty: c.shift,
      targetDuty: c.shift,
      // type/phName let the roster-dashboard frontend (ApplicationsManage.tsx)
      // distinguish a PH-import swap from a regular officer-initiated one —
      // subCatchment is recoverable by joining ph_roster_ref on (date,
      // scheduled/actual name) if ever needed, so it isn't stored here.
      reason: `PH Roster Change — ${phName}`,
      status: "APPROVED",
      reviewerName: reviewer,
      createdAt: now,
      reviewedAt: now,
      type: "PH",
      phName,
    });
  }

  await db.transaction(async (tx) => {
    // Remove existing PH swap records for this date (idempotent on re-save).
    await tx
      .delete(rosterSwapsTable)
      .where(and(eq(rosterSwapsTable.date, date), eq(rosterSwapsTable.type, "PH")));
    if (newSwaps.length > 0) await tx.insert(rosterSwapsTable).values(newSwaps);
  });

  res.json({ ok: true, count: newSwaps.length, skipped: skippedEntries.length, skippedEntries, phName });
});

// GET /api/ph-roster/:date — get overrides for a date
phRosterRouter.get("/ph-roster/:date", async (req, res) => {
  const { date } = req.params as { date: string };
  const overrides = await loadPHRosterOverridesForDate(date);
  res.json({ overrides });
});

// PUT /api/ph-roster/:date — save overrides for a date (manager+)
phRosterRouter.put("/ph-roster/:date", requireManager, async (req, res) => {
  const { date } = req.params as { date: string };
  const { overrides } = req.body as { overrides: Record<string, unknown> };
  if (!overrides || typeof overrides !== "object") {
    res.status(400).json({ error: "overrides object required" }); return;
  }
  await savePHRosterOverridesForDate(date, overrides as PHRosterOverrides[string]);
  res.json({ ok: true });
});

// GET /api/ph-ballot/:date — get ballot entries for a date
phRosterRouter.get("/ph-ballot/:date", async (req, res) => {
  const { date } = req.params as { date: string };
  const entries = await loadBallotForDate(date);
  res.json({ entries });
});

// POST /api/ph-ballot/:date/import — paste TSV: UNIT<tab>SHIFT<tab>OFFICER (manager+)
phRosterRouter.post("/ph-ballot/:date/import", requireManager, async (req, res) => {
  const { date } = req.params as { date: string };
  const { text } = req.body as { text: string };
  if (typeof text !== "string") { res.status(400).json({ error: "text required" }); return; }

  const entries: BallotEntry[] = [];
  const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\t/).map((p: string) => p.trim());
    if (parts.length < 3) continue;
    const [unitCode, shift, ...nameParts] = parts;
    const officerName = nameParts.join(" ").trim();
    if (!officerName || !unitCode || !shift) continue;
    const idx = entries.length;
    entries.push({
      id: `${date}-${idx}`,
      unitCode: unitCode.toUpperCase(),
      shift: shift.toUpperCase(),
      officerName,
    });
  }

  await saveBallotForDate(date, entries);
  res.json({ ok: true, count: entries.length });
});

// DELETE /api/ph-ballot/:date — clear ballot for a date (manager+)
phRosterRouter.delete("/ph-ballot/:date", requireManager, async (req, res) => {
  const { date } = req.params as { date: string };
  await db.delete(phBallotTable).where(eq(phBallotTable.date, date));
  res.json({ ok: true });
});

// ── PH Auto-Allocation Engine ──────────────────────────────────────────────────

interface PHSlot {
  date: string;
  phName: string;
  isOilCopy: boolean;
  copyFromDate?: string;
}

const PH_YEAR_SLOTS: Record<number, PHSlot[]> = {
  2026: [
    { date: "2026-01-01", phName: "New Year's Day",                        isOilCopy: false },
    { date: "2026-02-17", phName: "Chinese New Year Day 1",                isOilCopy: false },
    { date: "2026-02-18", phName: "Chinese New Year Day 2",                isOilCopy: false },
    { date: "2026-03-21", phName: "Hari Raya Puasa",                       isOilCopy: false },
    { date: "2026-04-03", phName: "Good Friday",                           isOilCopy: false },
    { date: "2026-05-01", phName: "Labour Day",                            isOilCopy: false },
    { date: "2026-05-27", phName: "Hari Raya Haji",                        isOilCopy: false },
    { date: "2026-05-31", phName: "Vesak Day",                             isOilCopy: false },
    { date: "2026-06-01", phName: "Vesak Day (In Lieu)",                   isOilCopy: true,  copyFromDate: "2026-05-31" },
    { date: "2026-08-09", phName: "National Day",                          isOilCopy: false },
    { date: "2026-08-10", phName: "National Day (In Lieu)",                isOilCopy: true,  copyFromDate: "2026-08-09" },
    { date: "2026-11-08", phName: "Deepavali",                             isOilCopy: false },
    { date: "2026-11-09", phName: "Deepavali (In Lieu)",                   isOilCopy: true,  copyFromDate: "2026-11-08" },
    { date: "2026-12-25", phName: "Christmas Day",                         isOilCopy: false },
  ],
  2027: [
    // 11 Public Holidays.  OIL only when the PH itself falls on a Sunday.
    // CNY Day 2 (7 Feb) falls on a Sunday → OIL on 8 Feb (Monday). Neither
    // Hari Raya date falls on a Sunday in 2027, so neither gets an in-lieu
    // day.
    //
    // Corrected 2026-09-08 (.scratch/roster-qa/issues/05) — this table
    // previously had CNY 2027 on 29-30 Jan with no in-lieu day, which was
    // wrong and disagreed with roster-dashboard's own SG_PH calendar
    // (PHHoliday.tsx), which has always had it correctly on 6-7 Feb + 8 Feb
    // in-lieu. auto-allocate's default targetYear is 2027, so this was
    // live-broken for the common no-args case, not just a stale comment —
    // it would generate a real PH roster on dates that aren't CNY at all
    // and silently skip the actual 6-8 Feb dates entirely.
    //
    // Hari Raya dates corrected 2026-09-21 (.scratch/replit-resync-2026-09-21/
    // issues/02) — this table previously had Hari Raya Puasa on 9 Mar (with
    // no in-lieu day) and Hari Raya Haji on 16 May + an in-lieu day on 17 May
    // (on the assumption 16 May fell on a Sunday). Verified against MOM's
    // official 18-June-2026 gazette (mom.gov.sg/newsroom/press-releases/2026/
    // 0618-public-holidays-for-2027): Hari Raya Puasa is 10 Mar 2027 (Wed),
    // Hari Raya Haji is 17 May 2027 (Mon) — neither is a Sunday, so there is
    // no in-lieu day for either. Same underlying mistake as the CNY bug
    // above: an independently-estimated lunar date that disagreed with the
    // later-published official calendar. If MOM's moon-sighting confirmation
    // ever shifts either date, this table (and usePHActuals.ts's SG_PH_META,
    // which must stay in sync) will need updating again.
    { date: "2027-01-01", phName: "New Year's Day",                        isOilCopy: false },
    { date: "2027-02-06", phName: "Chinese New Year Day 1",                isOilCopy: false },
    { date: "2027-02-07", phName: "Chinese New Year Day 2",                isOilCopy: false },
    { date: "2027-02-08", phName: "Chinese New Year Day 2 (In Lieu)",      isOilCopy: true,  copyFromDate: "2027-02-07" },
    { date: "2027-03-10", phName: "Hari Raya Puasa",                       isOilCopy: false },
    { date: "2027-03-26", phName: "Good Friday",                           isOilCopy: false },
    { date: "2027-05-01", phName: "Labour Day",                            isOilCopy: false },
    { date: "2027-05-17", phName: "Hari Raya Haji",                        isOilCopy: false },
    { date: "2027-05-20", phName: "Vesak Day",                             isOilCopy: false },
    { date: "2027-08-09", phName: "National Day",                          isOilCopy: false },
    { date: "2027-10-28", phName: "Deepavali",                             isOilCopy: false },
    { date: "2027-12-25", phName: "Christmas Day",                         isOilCopy: false },
  ],
  2028: [
    { date: "2028-01-01", phName: "New Year's Day",                        isOilCopy: false },
    { date: "2028-01-03", phName: "New Year's Day (In Lieu)",              isOilCopy: true,  copyFromDate: "2028-01-01" },
    { date: "2028-01-26", phName: "Chinese New Year Day 1",                isOilCopy: false },
    { date: "2028-01-27", phName: "Chinese New Year Day 2",                isOilCopy: false },
    { date: "2028-04-14", phName: "Good Friday",                           isOilCopy: false },
    { date: "2028-04-17", phName: "Hari Raya Puasa",                       isOilCopy: false },
    { date: "2028-05-01", phName: "Labour Day",                            isOilCopy: false },
    { date: "2028-05-25", phName: "Vesak Day",                             isOilCopy: false },
    { date: "2028-05-27", phName: "Hari Raya Haji",                        isOilCopy: false },
    { date: "2028-05-29", phName: "Hari Raya Haji (In Lieu)",              isOilCopy: true,  copyFromDate: "2028-05-27" },
    { date: "2028-08-09", phName: "National Day",                          isOilCopy: false },
    { date: "2028-10-16", phName: "Deepavali",                             isOilCopy: false },
    { date: "2028-12-25", phName: "Christmas Day",                         isOilCopy: false },
  ],
};

// Flat date → holiday name map for all years (counter drill-down)
const PH_DATE_NAMES: Record<string, string> = {
  "2025-01-01": "New Year's Day",
  "2025-01-29": "Chinese New Year Day 1",
  "2025-01-30": "Chinese New Year Day 2",
  "2025-03-31": "Hari Raya Puasa",
  "2025-04-18": "Good Friday",
  "2025-05-01": "Labour Day",
  "2025-05-12": "Vesak Day",
  "2025-06-07": "Hari Raya Haji",
  "2025-08-09": "National Day",
  "2025-10-20": "Deepavali",
  "2025-12-25": "Christmas Day",
  "2026-01-01": "New Year's Day",
  "2026-02-17": "Chinese New Year Day 1",
  "2026-02-18": "Chinese New Year Day 2",
  "2026-03-21": "Hari Raya Puasa",
  "2026-04-03": "Good Friday",
  "2026-05-01": "Labour Day",
  "2026-05-27": "Hari Raya Haji",
  "2026-05-31": "Vesak Day",
  "2026-06-01": "Vesak Day (In Lieu)",
  "2026-08-09": "National Day",
  "2026-08-10": "National Day (In Lieu)",
  "2026-11-08": "Deepavali",
  "2026-11-09": "Deepavali (In Lieu)",
  "2026-12-25": "Christmas Day",
  ...Object.fromEntries(Object.values(PH_YEAR_SLOTS).flat().map(s => [s.date, s.phName])),
};

// ── Rotation sequence (24-unit continuous loop, spec-defined) ────────────────
// CP1→KG1→BU1→PJ1→WK1→CP2→KG2→BU2→PJ2→WK2→CP3→KG3→BU3→PJ3→WK3→
// CP4→KG4→BU4→PJ4→CP4→KG4→BU4→PJ4→BU5 → repeats from CP1
// (CP4/KG4/BU4/PJ4 intentionally appear twice in the 24-unit cycle per spec)
const PH_ROTATION_SEQUENCE = [
  "CP1","KG1","BU1","PJ1","WK1",
  "CP2","KG2","BU2","PJ2","WK2",
  "CP3","KG3","BU3","PJ3","WK3",
  "CP4","KG4","BU4","PJ4",
  "CP4","KG4","BU4","PJ4",
  "BU5",
];
const PH_SEQ_LEN = PH_ROTATION_SEQUENCE.length; // 24

// Christmas 2026 ended on WK1 (index 4).  NY 2027 therefore starts at index 5 (CP2).
const PH_2027_ROT_START = 5;

// ── PH Builder — configurable/preset-driven layer over the generator above ──
// .scratch/replit-resync-2026-09-21/issues/31. A user-reorderable rotation
// pattern only makes sense with each unit appearing once — unlike
// PH_ROTATION_SEQUENCE above (which intentionally double-weights
// CP4/KG4/BU4/PJ4 "per spec"), the builder's pattern is deduplicated. This is
// a deliberate, user-approved change to that weighting when PH Builder is
// adopted, not an oversight.
export interface PHBuilderConfig {
  pattern: string[];
  consecutivePH: boolean;
  sameHolidayPreviousYear: boolean;
  excludedOfficers: string[];
  startYear: number;
}

export interface PHBuilderPreset {
  id: string;
  name: string;
  config: PHBuilderConfig;
  updatedAt: string;
}

function defaultPHBuilderConfig(): PHBuilderConfig {
  return {
    pattern: [...new Set(PH_ROTATION_SEQUENCE)],
    consecutivePH: true,
    sameHolidayPreviousYear: true,
    // Replit's own default seeded one specific officer's name here — not
    // meaningful outside their environment, so this repo starts with no
    // default exclusions instead.
    excludedOfficers: [],
    startYear: 2027,
  };
}

async function activeUnitCodes(): Promise<string[]> {
  const rows = await db.select({ unitCode: officersTable.unitCode }).from(officersTable).where(eq(officersTable.active, true));
  return [...new Set(
    rows.map((r) => r.unitCode?.trim().toUpperCase()).filter((u): u is string => !!u && u !== "TBC"),
  )];
}

function getPHRotationPattern(config: PHBuilderConfig): string[] {
  return config.pattern;
}

// Self-healing read: reconciles whatever pattern was last saved against the
// currently active units, so a roster change (a unit added/retired) doesn't
// leave the pattern silently out of sync with normalizePHBuilderConfig's
// "each active unit exactly once" invariant.
async function loadPHBuilderConfig(): Promise<PHBuilderConfig> {
  const [row, activeUnits] = await Promise.all([
    db.select().from(phBuilderConfigTable).where(eq(phBuilderConfigTable.id, 1)).then((rows) => rows[0]),
    activeUnitCodes(),
  ]);
  const defaults = defaultPHBuilderConfig();
  const requested = row?.pattern ?? [];
  const pattern = [...new Set([...requested, ...PH_ROTATION_SEQUENCE, ...activeUnits])]
    .filter((unit) => activeUnits.includes(unit));
  return {
    pattern: pattern.length >= 6 ? pattern : defaults.pattern,
    consecutivePH: row?.consecutivePH ?? defaults.consecutivePH,
    sameHolidayPreviousYear: row?.sameHolidayPreviousYear ?? defaults.sameHolidayPreviousYear,
    excludedOfficers: row?.excludedOfficers ?? defaults.excludedOfficers,
    startYear: row?.startYear ?? defaults.startYear,
  };
}

async function savePHBuilderConfig(config: PHBuilderConfig): Promise<void> {
  await db
    .insert(phBuilderConfigTable)
    .values({ id: 1, ...config })
    .onConflictDoUpdate({ target: phBuilderConfigTable.id, set: { ...config } });
}

// Shared by the builder-config PUT and builder-presets POST routes below —
// both need the same active-officer/unit sets to validate a submitted config.
async function loadValidatedPHBuilderConfig(rawConfig: unknown): Promise<PHBuilderConfig> {
  const officers = await db.select().from(officersTable).where(eq(officersTable.active, true));
  return normalizePHBuilderConfig(
    (rawConfig ?? {}) as Partial<PHBuilderConfig>,
    new Set(officers.map((o) => o.name)),
    new Set(officers.map((o) => o.unitCode?.trim().toUpperCase()).filter((u): u is string => !!u && u !== "TBC")),
  );
}

async function loadPHBuilderPresets(): Promise<PHBuilderPreset[]> {
  const rows = await db.select().from(phBuilderPresetsTable);
  return rows
    .map((r) => ({ id: r.id, name: r.name, config: r.config as PHBuilderConfig, updatedAt: r.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizePHBuilderConfig(
  input: Partial<PHBuilderConfig>,
  officerNames: Set<string>,
  activeUnits: Set<string>,
): PHBuilderConfig {
  const defaults = defaultPHBuilderConfig();
  const pattern = Array.isArray(input.pattern)
    ? input.pattern.map((value) => String(value).trim().toUpperCase()).filter(Boolean)
    : defaults.pattern;
  if (pattern.length !== activeUnits.size || new Set(pattern).size !== activeUnits.size || pattern.some((unit) => !activeUnits.has(unit))) {
    throw new Error(`Pattern must contain each of the ${activeUnits.size} active roster teams exactly once`);
  }
  const excludedOfficers = Array.isArray(input.excludedOfficers)
    ? [...new Set(input.excludedOfficers.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  const unknown = excludedOfficers.filter((name) => !officerNames.has(name));
  if (unknown.length) throw new Error(`Unknown officer: ${unknown.join(", ")}`);
  const startYear = Number(input.startYear ?? defaults.startYear);
  if (!Number.isInteger(startYear) || startYear < 2027) {
    throw new Error("Start year must be 2027 or later");
  }
  return {
    pattern,
    consecutivePH: input.consecutivePH !== false,
    sameHolidayPreviousYear: input.sameHolidayPreviousYear !== false,
    excludedOfficers,
    startYear,
  };
}

// ── Default officer pairs per unit (exactly 2 per unit, per spec) ─────────────
const UNIT_DEFAULTS: Record<string, [string, string]> = {
  "BU1": ["Officer-26",     "Officer-16" ],
  "BU2": ["Officer-11",  "Officer-04"],
  "BU3": ["Officer-14",   "Officer-30"   ],
  "BU4": ["Officer-22",  "Officer-31"    ],
  "BU5": ["Officer-08",    "Officer-19"    ],
  "PJ1": ["Officer-37",    "Officer-15" ],
  "PJ2": ["Officer-10",      "Officer-40"   ],
  "PJ3": ["Officer-25",  "Officer-20"    ],
  "PJ4": ["Officer-35",  "Officer-09"   ],
  "WK1": ["Officer-21",   "Officer-36" ],
  "WK2": ["Officer-23",  "Officer-33"    ],
  "WK3": ["Officer-28", "Officer-03"     ],
  "CP1": ["Officer-13",     "Officer-01"    ],
  "CP2": ["Officer-34",  "Officer-18"    ],
  "CP3": ["Officer-17",  "Officer-38"  ],
  "CP4": ["Officer-24", "Officer-29"  ],
  "KG1": ["Officer-07",    "Officer-39"   ],
  "KG2": ["Officer-27",    "Officer-05"    ],
  "KG3": ["Officer-01",    "Officer-32"  ],
  "KG4": ["Officer-12",   "Officer-06"   ],
};

// ── Racial/religious scheduling rules ────────────────────────────────────────
/** Never scheduled on CNY. Rule A & B do not apply to them for CNY. */
const CNY_EXCLUDED       = new Set(["Officer-04", "Officer-25", "Officer-09"]);
/** Never scheduled on Deepavali. Rule A & B do not apply to Officer-10 for Deepavali. */
const DEEPAVALI_EXCLUDED = new Set(["Officer-10"]);
/** Always in the last 4 DAY slots of every Hari Raya; bypass all rules. */
const HR_FIXED_DAY       = ["Officer-10", "Officer-04", "Officer-25", "Officer-09"] as const;

// ── Muslim officer pool for Hari Raya ballot ──────────────────────────────────
// All Muslim officers in exhaustion-cycle order (full restart list)
const ALL_MUSLIM_OFFICERS: readonly string[] = [
  "Officer-07","Officer-14","Officer-40","Officer-39","Officer-22","Officer-35","Officer-03","Officer-37",
  "Officer-15","Officer-24","Officer-23","Officer-11","Officer-36","Officer-19","Officer-26","Officer-31",
  "Officer-08","Officer-32","Officer-28","Officer-18","Officer-06","Officer-13","Officer-30",
  "Officer-16","Officer-33","Officer-20","Officer-21","Officer-34","Officer-17","Officer-38",
  "Officer-29","Officer-27","Officer-05","Officer-01","Officer-12",
];

// Non-Muslim (fixed DAY slots, never balloted): Officer-10, Officer-04, Officer-25, Officer-09
// — reuses HR_FIXED_DAY above rather than a second identical constant.
const HR_FIXED_OFFICERS = HR_FIXED_DAY;

function getHRPoolKind(phName: string): HRPoolKind | null {
  if (/hari raya puasa/i.test(phName)) return "puasa";
  if (/hari raya haji/i.test(phName)) return "haji";
  return null;
}

function isHRPoolKind(value: unknown): value is HRPoolKind {
  return value === "puasa" || value === "haji";
}

/**
 * For every Hari Raya date in `ref`, records which Muslim officers were
 * scheduled for each holiday that calendar year, keyed by the OPPOSITE
 * holiday so the caller can exclude "already did the other one this year"
 * candidates from a given draw.
 */
function buildHRCrossHolidayExclusions(ref: PHRosterRef): Map<string, ReadonlySet<string>> {
  const assignmentsByYear = new Map<number, Record<HRPoolKind, Set<string>>>();
  const getAssignments = (year: number) => {
    let assignments = assignmentsByYear.get(year);
    if (!assignments) {
      assignments = { puasa: new Set(), haji: new Set() };
      assignmentsByYear.set(year, assignments);
    }
    return assignments;
  };

  for (const [date, rows] of Object.entries(ref)) {
    const kind = getHRPoolKind(PH_DATE_NAMES[date] ?? "");
    if (!kind) continue;
    const assignments = getAssignments(Number(date.slice(0, 4)));
    for (const row of rows) {
      if (ALL_MUSLIM_OFFICERS.includes(row.scheduledName)) {
        assignments[kind].add(row.scheduledName);
      }
    }
  }

  const exclusionsByDate = new Map<string, ReadonlySet<string>>();
  for (const date of Object.keys(ref)) {
    const kind = getHRPoolKind(PH_DATE_NAMES[date] ?? "");
    if (!kind) continue;
    const otherKind: HRPoolKind = kind === "puasa" ? "haji" : "puasa";
    exclusionsByDate.set(date, new Set(getAssignments(Number(date.slice(0, 4)))[otherKind]));
  }
  return exclusionsByDate;
}

function buildPoolFromRoster(
  kind: HRPoolKind,
  ref: PHRosterRef,
  excludedDates: ReadonlySet<string>,
  excludedNamesByDate: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): HRBallotPoolState {
  const historicalDraws = Object.entries(ref)
    .filter(([date]) => date >= "2025-01-01" && !excludedDates.has(date))
    .filter(([date]) => getHRPoolKind(PH_DATE_NAMES[date] ?? "") === kind)
    .map(([date, rows]) => ({ date, officers: rows.map((row) => row.scheduledName) }));
  return rebuildHRBallotPoolFromHistory(historicalDraws, ALL_MUSLIM_OFFICERS, excludedNamesByDate).poolState;
}

/**
 * Derives the current two-pool HR ballot state from the actual scheduled PH
 * roster — never from a possibly-stale saved pool. `excludedDates` lets a
 * partial regeneration exclude the dates it's about to overwrite so they're
 * drawn from the correct remaining pool rather than double-counted.
 */
function createHRBallotStateFromRoster(
  ref: PHRosterRef,
  excludedDates: ReadonlySet<string> = new Set(),
  excludedNamesByDate?: ReadonlyMap<string, ReadonlySet<string>>,
): HRBallotState {
  const crossHolidayExclusions = excludedNamesByDate ?? buildHRCrossHolidayExclusions(ref);
  return {
    version: 3,
    pools: {
      puasa: buildPoolFromRoster("puasa", ref, excludedDates, crossHolidayExclusions),
      haji: buildPoolFromRoster("haji", ref, excludedDates, crossHolidayExclusions),
    },
  };
}

function buildHRBallotResponse(state: HRBallotState, ref: PHRosterRef) {
  const allTracked = [...ALL_MUSLIM_OFFICERS, ...HR_FIXED_OFFICERS];
  const histories: Record<HRPoolKind, Record<string, Record<string, HRCycleColor>>> = { puasa: {}, haji: {} };
  const yearSet = new Set<string>();

  for (const kind of ["puasa", "haji"] as const) {
    for (const name of allTracked) histories[kind][name] = {};
  }

  for (const [date, phName] of Object.entries(PH_DATE_NAMES)) {
    const kind = getHRPoolKind(phName);
    if (!kind) continue;
    const year = date.slice(0, 4);
    yearSet.add(year);
    for (const row of ref[date] ?? []) {
      const name = row.scheduledName;
      if (name && histories[kind][name] !== undefined) {
        histories[kind][name][year] = state.pools[kind].drawHistory[date]?.[name] ?? "green";
      }
    }
  }

  const makePoolResponse = (kind: HRPoolKind) => {
    const summary = buildHRBallotPoolSummary(state.pools[kind], ALL_MUSLIM_OFFICERS);
    return { ...summary, officerYears: histories[kind], totalTracked: allTracked.length };
  };

  return {
    version: state.version,
    pools: { puasa: makePoolResponse("puasa"), haji: makePoolResponse("haji") },
    allMuslimOfficers: [...ALL_MUSLIM_OFFICERS],
    fixedOfficers: [...HR_FIXED_OFFICERS],
    years: [...yearSet].sort(),
  };
}

/**
 * PH Auto-Allocate — builds the full PH roster for a given year.
 *
 * ─ SCENARIO 1 (General PHs: NY, GF, Labour, Vesak, National Day, Christmas) ─
 *   Step 1 — Assign the 2 default officers of each of the 6 rotation units.
 *   Step 2 — Remove officers violating Rule A or Rule B.
 *   Step 3 — Fill empty slots from the full officer pool, lowest PH count first.
 *
 *   Rule A: officer was on the IMMEDIATELY PRECEDING PH in the calendar.
 *   Rule B: officer worked the same PH name in the prior year.
 *   Priority when rules conflict with ±1 equal distribution:
 *     1. Rule A + Rule B + ±1 distribution.
 *     2. Disregard Rule B; keep Rule A + ±1.
 *     3. Disregard Rule B + ±1; keep Rule A only.
 *     4. Last resort: any unassigned officer.
 *
 * ─ SCENARIO 2a — CNY (Day 1 & 2) ────────────────────────────────────────────
 *   12 slots filled from non-Chinese pool (Officer-04, Officer-25, Officer-09 excluded).
 *   Rule A & B apply normally to everyone else. Equal distribution maintained.
 *
 * ─ SCENARIO 2b — Hari Raya Puasa & Haji ─────────────────────────────────────
 *   8 slots from Muslim exhaustion ballot (6 PD + 2 DAY).
 *   Last 4 DAY slots: Officer-10, Officer-04, Officer-25, Officer-09 (fixed, no Rule A/B).
 *   Sub-catchment labels come from the rotation sequence (6 units as normal).
 *
 * ─ SCENARIO 2c — Deepavali ───────────────────────────────────────────────────
 *   12 slots filled from non-Hindu pool (Officer-10 excluded).
 *   Rule A & B apply normally to everyone else. Equal distribution maintained.
 *
 * ─ OIL (in-lieu copies) ──────────────────────────────────────────────────────
 *   Rows copied verbatim from the source date.
 *   Rotation does NOT advance. Rows do NOT count toward PH count or rules.
 *
 * Pure function — all persisted state (prior years' ref data, rotation
 * cursor, HR ballot pool, PH Builder config) is loaded by the caller and
 * passed in; nothing here touches the database directly.
 */
function autoAllocate(
  officers: { name: string; unitCode: string }[],
  slots: PHSlot[],
  savedRef: PHRosterRef,
  rotState: Record<number, number>,
  builderConfig: PHBuilderConfig,
): { result: PHRosterRef; hrBallot: HRBallotState; rotIdx: number; targetYear: number } {

  const rotationPattern = getPHRotationPattern(builderConfig);
  const sequenceLength = rotationPattern.length;
  const staffExceptions = new Set(builderConfig.excludedOfficers);

  // ── All active, non-excluded officer names ───────────────────────────
  const allOfficers = officers
    .filter(o => o.unitCode && o.unitCode.toUpperCase() !== "TBC" && !staffExceptions.has(o.name))
    .map(o => o.name);

  // ── Target year ──────────────────────────────────────────────────────
  const targetYear = parseInt(
    slots.find(s => !s.isOilCopy)?.date.slice(0, 4) ?? "2027", 10);

  // ── Rotation starting index ──────────────────────────────────────────
  let rotIdx: number;
  if (targetYear === 2027) {
    rotIdx = PH_2027_ROT_START;
  } else {
    rotIdx = rotState[targetYear - 1] ?? PH_2027_ROT_START;
  }

  // ── Rule B: prior year PH history ───────────────────────────────────
  const priorYearPH = new Map<string, Set<string>>();
  for (const [date, rows] of Object.entries(savedRef)) {
    if (parseInt(date.slice(0, 4), 10) !== targetYear - 1) continue;
    const pn = PH_DATE_NAMES[date] ?? "";
    if (!pn || pn.includes("In Lieu")) continue;
    for (const row of rows) {
      const name = (row.scheduledName ?? "").trim();
      if (!name) continue;
      if (!priorYearPH.has(name)) priorYearPH.set(name, new Set());
      priorYearPH.get(name)!.add(pn);
    }
  }

  // ── Rule B tiebreaker: officers blocked from more PHs this year get fill
  //    priority when PH counts are equal. Prevents officers with many Rule B
  //    blocks (fewer natural opportunities) losing tiebreaks to roster order.
  const nonOilPhNames = new Set(slots.filter(s => !s.isOilCopy).map(s => s.phName));
  const ruleB2027Blocks = new Map<string, number>();
  for (const o of allOfficers) {
    const worked = priorYearPH.get(o) ?? new Set<string>();
    let blocks = 0;
    for (const ph of worked) if (nonOilPhNames.has(ph)) blocks++;
    ruleB2027Blocks.set(o, blocks);
  }

  // ── Runtime tracking ─────────────────────────────────────────────────
  const phCount = new Map<string, number>();
  const getCount = (n: string) => phCount.get(n) ?? 0;
  /** Officers assigned to the immediately preceding PH (Rule A). */
  let prevPHOfficers = new Set<string>();

  const trackAssignment = (names: string[]) => {
    for (const n of names) phCount.set(n, getCount(n) + 1);
    prevPHOfficers = new Set(names);
  };

  // ── Independent Hari Raya ballot pools ───────────────────────────────
  // Rebuilding from all completed Hari Raya duties keeps the two independent
  // pools fair if a future year is regenerated: dates being generated are
  // deliberately excluded so they are drawn from the correct remaining pool.
  const generatedDates = new Set(slots.filter(slot => !slot.isOilCopy).map(slot => slot.date));
  const excludedNamesByDate = buildHRCrossHolidayExclusions(savedRef);
  const hrBallot = createHRBallotStateFromRoster(savedRef, generatedDates, excludedNamesByDate);
  for (const kind of ["puasa", "haji"] as const) {
    if (!hrBallot.pools[kind].initialized) {
      hrBallot.pools[kind].pool = [...ALL_MUSLIM_OFFICERS];
      hrBallot.pools[kind].initialized = true;
    }
  }

  // Tracks Hari Raya allocations by holiday and calendar year, for the
  // same-year cross-holiday exclusion (an officer drawn for Puasa can't also
  // be drawn for Haji that year). Starts with saved rows not being
  // regenerated, then grows as this run creates new rows, so a partial
  // regeneration obeys the same rule as a full annual generation.
  const hrAssignmentsByYear = new Map<number, Record<HRPoolKind, Set<string>>>();
  const getHRAssignments = (year: number) => {
    let assignments = hrAssignmentsByYear.get(year);
    if (!assignments) {
      assignments = { puasa: new Set(), haji: new Set() };
      hrAssignmentsByYear.set(year, assignments);
    }
    return assignments;
  };
  const recordHRAssignment = (date: string, kind: HRPoolKind, names: readonly string[]) => {
    const assignments = getHRAssignments(Number(date.slice(0, 4)));
    for (const name of names) {
      if (ALL_MUSLIM_OFFICERS.includes(name)) assignments[kind].add(name);
    }
  };
  for (const [date, rows] of Object.entries(savedRef)) {
    if (generatedDates.has(date)) continue;
    const kind = getHRPoolKind(PH_DATE_NAMES[date] ?? "");
    if (!kind) continue;
    recordHRAssignment(date, kind, rows.map(row => row.scheduledName));
  }

  /**
   * Ballot n officers from one holiday-specific HR exhaustion pool. A true
   * random draw (not sequential); auto-refreshes from the full Muslim list
   * when exhausted, excluding officers already drawn for the OTHER Hari Raya
   * holiday this same calendar year.
   */
  const drawFromHRBallot = (kind: HRPoolKind, date: string, n: number): string[] => {
    const assignments = getHRAssignments(Number(date.slice(0, 4)));
    const otherKind: HRPoolKind = kind === "puasa" ? "haji" : "puasa";
    return drawHRBallot(hrBallot, kind, date, n, ALL_MUSLIM_OFFICERS, Math.random, assignments[otherKind])
      .map(entry => entry.name);
  };

  // ── PH type helpers ──────────────────────────────────────────────────
  const isCNY = (ph: string) => /chinese new year/i.test(ph);
  const isDp  = (ph: string) => /deepavali/i.test(ph);

  // ── Rule checks ──────────────────────────────────────────────────────
  const failsRuleA = (n: string)              => builderConfig.consecutivePH && prevPHOfficers.has(n);
  const failsRuleB = (n: string, ph: string)  => builderConfig.sameHolidayPreviousYear && (priorYearPH.get(n)?.has(ph) ?? false);

  // ── Pick up to n officers from candidates ────────────────────────────
  // Lowest PH count first.  Fallback tiers (per spec):
  //   T1: Rule A ✓  Rule B ✓  ±1 ✓
  //   T2: Rule A ✓  Rule B ✓  (no ±1 check)
  //   T3: Rule A ✓  (Rule B disregarded)
  //   T4: no constraints (absolute last resort)
  const pick = (
    candidates: string[],
    phName: string,
    exclude: Set<string>,
    n: number,
  ): string[] => {
    const result: string[] = [];
    const used = new Set(exclude);
    const sorted = [...candidates].sort((a, b) => {
      const countDiff = getCount(a) - getCount(b);
      if (countDiff !== 0) return countDiff;
      // Tiebreak: more Rule B blocks → higher fill priority (fewer natural slots)
      return (ruleB2027Blocks.get(b) ?? 0) - (ruleB2027Blocks.get(a) ?? 0);
    });
    const minAll = () => (allOfficers.length ? Math.min(...allOfficers.map(getCount)) : 0);

    for (let i = 0; i < n; i++) {
      const floor = minAll();
      const found =
        sorted.find(o => !used.has(o) && !failsRuleA(o) && !failsRuleB(o, phName) && getCount(o) <= floor + 1) ??
        sorted.find(o => !used.has(o) && !failsRuleA(o) && !failsRuleB(o, phName)) ??
        sorted.find(o => !used.has(o) && !failsRuleA(o)) ??
        sorted.find(o => !used.has(o));
      if (found) { result.push(found); used.add(found); }
    }
    return result;
  };

  // ── Get 6 consecutive units from rotation ────────────────────────────
  const getUnits = (idx: number): string[] =>
    Array.from({ length: 6 }, (_, i) => rotationPattern[(idx + i) % sequenceLength]);

  // ── Build PHRefRow array from unit/shift/officer pairs ───────────────
  const makeRows = (units: string[], pairs: string[][]): PHRefRow[] => {
    const rows: PHRefRow[] = [];
    let ri = 0;
    for (let u = 0; u < 6; u++) {
      const shift = u < 3 ? "PD" : "DAY";
      for (const name of pairs[u]) {
        rows.push({ rowIndex: ri++, subCatchment: units[u], shift,
          scheduledName: name, actualName: name });
      }
    }
    return rows;
  };

  // ── Scenario 1: General PH ────────────────────────────────────────────
  const allocateGeneral = (units: string[], phName: string): PHRefRow[] => {
    const usedThisPH = new Set<string>();
    const pairs: string[][] = [];

    for (let u = 0; u < 6; u++) {
      const defaults: string[] = [...(UNIT_DEFAULTS[units[u]] ?? [])];

      // Step 2: remove Rule A violators
      let eligible = defaults.filter(n => !failsRuleA(n));
      // Step 2: remove Rule B violators (keep all if all fail — "only if unable")
      const rbPass = eligible.filter(n => !failsRuleB(n, phName));
      if (rbPass.length > 0) eligible = rbPass;

      // Dedup against officers already assigned earlier in this PH
      eligible = eligible.filter(n => !usedThisPH.has(n)).slice(0, 2);

      // Step 3: fill remaining slots from full pool
      const assigned = [...eligible];
      if (assigned.length < 2) {
        const fill = pick(allOfficers, phName, new Set([...usedThisPH, ...assigned]), 2 - assigned.length);
        assigned.push(...fill);
      }
      for (const n of assigned) usedThisPH.add(n);
      pairs.push(assigned);
    }
    return makeRows(units, pairs);
  };

  // ── Scenario 2a/2c: CNY / Deepavali (defaults-first, exclude racial list) ──
  // Same flow as allocateGeneral but:
  //   - unit defaults are pre-filtered: excluded officers are skipped
  //   - fill pool is also restricted to non-excluded officers
  const allocateRacial = (
    units: string[],
    phName: string,
    excluded: Set<string>,
  ): PHRefRow[] => {
    const pool = allOfficers.filter(n => !excluded.has(n));
    const usedThisPH = new Set<string>();
    const pairs: string[][] = [];

    for (let u = 0; u < 6; u++) {
      // Unit defaults minus racially-excluded officers
      const defaults = (UNIT_DEFAULTS[units[u]] ?? []).filter(n => !excluded.has(n));

      // Apply Rule A
      let eligible = defaults.filter(n => !failsRuleA(n));
      // Apply Rule B (keep all if all fail)
      const rbPass = eligible.filter(n => !failsRuleB(n, phName));
      if (rbPass.length > 0) eligible = rbPass;

      // Dedup against already-assigned officers this PH
      eligible = eligible.filter(n => !usedThisPH.has(n)).slice(0, 2);

      // Fill remaining slots from eligible pool (lowest count first)
      const assigned = [...eligible];
      if (assigned.length < 2) {
        const fill = pick(pool, phName, new Set([...usedThisPH, ...assigned]), 2 - assigned.length);
        assigned.push(...fill);
      }
      for (const n of assigned) usedThisPH.add(n);
      pairs.push(assigned);
    }
    return makeRows(units, pairs);
  };

  // ── Scenario 2b: Hari Raya ────────────────────────────────────────────
  const allocateHariRaya = (units: string[], kind: HRPoolKind, date: string): PHRefRow[] => {
    const balloted = drawFromHRBallot(kind, date, 8); // 6 PD + 2 DAY
    recordHRAssignment(date, kind, balloted);
    const pairs: string[][] = [
      balloted.slice(0, 2),                          // unit 0  PD
      balloted.slice(2, 4),                          // unit 1  PD
      balloted.slice(4, 6),                          // unit 2  PD
      balloted.slice(6, 8),                          // unit 3  DAY
      [HR_FIXED_DAY[0], HR_FIXED_DAY[1]],            // unit 4  DAY  Officer-10, Officer-04
      [HR_FIXED_DAY[2], HR_FIXED_DAY[3]],            // unit 5  DAY  Officer-25, Officer-09
    ];
    return makeRows(units, pairs);
  };

  // ── Main loop ─────────────────────────────────────────────────────────
  const result: PHRosterRef = {};

  for (const slot of slots) {
    // OIL / in-lieu: copy rows verbatim; rotation does NOT advance; not tracked
    if (slot.isOilCopy && slot.copyFromDate) {
      result[slot.date] = (result[slot.copyFromDate] ?? []).map(r => ({ ...r }));
      continue;
    }

    const { date, phName } = slot;
    const units = getUnits(rotIdx);
    rotIdx = (rotIdx + 6) % sequenceLength;

    let rows: PHRefRow[];
    const hrPoolKind = getHRPoolKind(phName);
    if      (hrPoolKind)    rows = allocateHariRaya(units, hrPoolKind, date);
    else if (isCNY(phName)) rows = allocateRacial(units, phName, CNY_EXCLUDED);
    else if (isDp(phName))  rows = allocateRacial(units, phName, DEEPAVALI_EXCLUDED);
    else                    rows = allocateGeneral(units, phName);

    result[date] = rows;
    trackAssignment(rows.map(r => r.scheduledName).filter(Boolean));
  }

  // ── Post-allocation rebalance: bring count spread to ≤ 1 ─────────────────
  // Swaps under-assigned officers into PHs by replacing over-assigned ones.
  // Respects: racial exclusions, Rule A, HR ballot integrity.
  // Does NOT relax racial exclusions (Officer-10/CNY/Deepavali rules remain hard).
  {
    const nonOilSlots = slots.filter(s => !s.isOilCopy);

    // Per-PH racial exclusion map
    const phExclMap = new Map<string, Set<string>>();
    for (const slot of nonOilSlots) {
      const excl = new Set<string>();
      if (isCNY(slot.phName)) CNY_EXCLUDED.forEach(n => excl.add(n));
      if (isDp(slot.phName))  DEEPAVALI_EXCLUDED.forEach(n => excl.add(n));
      phExclMap.set(slot.date, excl);
    }

    for (let round = 0; round < 20; round++) {
      const countsArr = allOfficers.map(getCount);
      const minC = Math.min(...countsArr);
      const maxC = Math.max(...countsArr);
      if (maxC - minC <= 1) break;

      // Build preceding-PH workers map fresh each round (swaps may shift it)
      const precWorkersMap = new Map<string, Set<string>>();
      let prevW = new Set<string>();
      for (const slot of nonOilSlots) {
        precWorkersMap.set(slot.date, new Set(prevW));
        const r = result[slot.date] ?? [];
        prevW = new Set(r.map(row => row.scheduledName).filter(Boolean) as string[]);
      }

      // Under-assigned: at minC, sorted by Rule B block count descending (most constrained first)
      const underAssigned = allOfficers
        .filter(n => getCount(n) === minC)
        .sort((a, b) => (ruleB2027Blocks.get(b) ?? 0) - (ruleB2027Blocks.get(a) ?? 0));

      let swappedThisRound = false;

      for (const candidate of underAssigned) {
        for (const slot of nonOilSlots) {
          const { date, phName } = slot;
          const rows = result[date];
          if (!rows) continue;

          // Skip HR days — ballot-managed, don't touch
          if (getHRPoolKind(phName)) continue;

          // Already in this PH
          if (rows.some(r => r.scheduledName === candidate)) continue;

          // Racially excluded
          if (phExclMap.get(date)?.has(candidate)) continue;

          // Rule A: candidate must not have worked the preceding PH
          if (builderConfig.consecutivePH && precWorkersMap.get(date)?.has(candidate)) continue;

          // Find highest-count officer in this PH we can replace (must be at maxC)
          const victim = rows
            .filter(r => !!r.scheduledName && getCount(r.scheduledName) >= maxC)
            .sort((a, b) => getCount(b.scheduledName!) - getCount(a.scheduledName!))[0];

          if (!victim) continue;

          const victimName = victim.scheduledName!;

          // Perform the swap
          victim.scheduledName = candidate;
          victim.actualName    = candidate;
          phCount.set(candidate,  getCount(candidate)  + 1);
          phCount.set(victimName, getCount(victimName) - 1);

          swappedThisRound = true;
          break; // one swap per candidate per round; re-evaluate after
        }

        if (swappedThisRound) break; // one swap per round; re-check min/max
      }

      if (!swappedThisRound) break; // no eligible swap found; stop
    }
  }

  return { result, hrBallot, rotIdx, targetYear };
}

// Generation-time safety nets, run after autoAllocate() returns and before
// persisting — throw rather than silently persist a roster that violates
// either invariant. Ported from Replit's assertNoHRCrossHolidayDoubleDuty /
// assertBalancedPHCounts. .scratch/replit-resync-2026-09-21/issues/07.
function assertNoHRCrossHolidayDoubleDuty(generated: PHRosterRef, slots: PHSlot[]): void {
  const puasaDate = slots.find((s) => !s.isOilCopy && s.phName === "Hari Raya Puasa")?.date;
  const hajiDate = slots.find((s) => !s.isOilCopy && s.phName === "Hari Raya Haji")?.date;
  if (!puasaDate || !hajiDate) return;
  const namesOn = (date: string) =>
    new Set(
      (generated[date] ?? [])
        .map((r) => (r.actualName || r.scheduledName || "").trim())
        .filter(Boolean),
    );
  const both = [...namesOn(puasaDate)].filter((n) => namesOn(hajiDate).has(n));
  if (both.length > 0) {
    throw new Error(
      `Generated roster assigns ${both.join(", ")} to both Hari Raya Puasa and Hari Raya Haji in the same year — refusing to save.`,
    );
  }
}

function assertBalancedPHCounts(generated: PHRosterRef, slots: PHSlot[], eligibleNames: string[]): void {
  const eligible = new Set(eligibleNames);
  const counts = new Map<string, number>(eligibleNames.map((n) => [n, 0]));
  const ineligibleAssigned = new Set<string>();
  for (const slot of slots) {
    if (slot.isOilCopy) continue; // in-lieu rows duplicate the original PH's names — would double-count
    for (const row of generated[slot.date] ?? []) {
      const name = (row.actualName || row.scheduledName || "").trim();
      if (!name) continue;
      if (!eligible.has(name)) { ineligibleAssigned.add(name); continue; }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (ineligibleAssigned.size > 0) {
    throw new Error(
      `Generated roster assigns PH duty to ineligible officer(s): ${[...ineligibleAssigned].join(", ")} — refusing to save.`,
    );
  }
  const values = [...counts.values()];
  if (values.length === 0) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // autoAllocate's own swap loop already tries to reach exactly this state
  // (balanced within 1) and only gives up when it truly can't improve
  // further — a violation here indicates a genuine generation bug, not a
  // normal edge case.
  if (max - min > 1) {
    throw new Error(
      `Generated roster's PH-duty counts are unbalanced (min ${min}, max ${max}) — refusing to save.`,
    );
  }
}

// POST /api/ph-roster-ref/auto-allocate — generate PH roster for a year (manager+)
phRosterRouter.post("/ph-roster-ref/auto-allocate", requireManager, async (req, res) => {
  const { targetYear = 2027, dryRun = false } = req.body as {
    targetYear?: number;
    dryRun?: boolean;
    // ballotSeed is no longer used by the rotation engine; accepted but ignored for backward compat
    ballotSeed?: number;
  };

  const slots = PH_YEAR_SLOTS[Number(targetYear)];
  if (!slots) {
    res.status(400).json({ error: `No PH data for year ${targetYear}. Supported: ${Object.keys(PH_YEAR_SLOTS).join(", ")}` });
    return;
  }

  // Deactivated officers are excluded from future PH-duty eligibility, but this
  // has no effect on reading past ph_roster_ref history for Rule A/B lookback —
  // that history is keyed by name, not officers.id.
  const officerRows = await db.select().from(officersTable).where(eq(officersTable.active, true));
  const officers = officerRows.map((o) => ({ name: o.name, unitCode: o.unitCode }));
  if (officers.length === 0) {
    res.status(400).json({ error: "No officers found — set up roster first." });
    return;
  }

  const [savedRef, rotStateRows, builderConfig] = await Promise.all([
    loadAllPHRosterRef(),
    db.select().from(phRotationStateTable),
    loadPHBuilderConfig(),
  ]);
  const rotState: Record<number, number> = {};
  for (const r of rotStateRows) rotState[r.year] = r.cursorIndex;

  // Note: the HR ballot pool is no longer loaded here as an autoAllocate
  // input — it's derived fresh from savedRef inside autoAllocate itself
  // (createHRBallotStateFromRoster), which is more robust than trusting a
  // possibly-stale saved pool. The persisted ph_hr_ballot_state row below is
  // written for GET /ph-roster-ref/hr-ballot-pool to read without re-deriving.
  const { result: generated, hrBallot, rotIdx, targetYear: yr } = autoAllocate(officers, slots, savedRef, rotState, builderConfig);

  try {
    const staffExceptions = new Set(builderConfig.excludedOfficers);
    const eligibleNames = officers
      .filter((o) => o.unitCode && o.unitCode.toUpperCase() !== "TBC" && !staffExceptions.has(o.name))
      .map((o) => o.name);
    assertNoHRCrossHolidayDoubleDuty(generated, slots);
    assertBalancedPHCounts(generated, slots, eligibleNames);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }

  if (!dryRun) {
    await db.transaction(async (tx) => {
      // Remove all existing entries for this year before writing new ones
      await tx
        .delete(phRosterRefTable)
        .where(and(gte(phRosterRefTable.date, `${yr}-01-01`), lte(phRosterRefTable.date, `${yr}-12-31`)));

      const rows: (typeof phRosterRefTable.$inferInsert)[] = [];
      for (const [date, refRows] of Object.entries(generated)) {
        for (const r of refRows) {
          rows.push({
            date,
            rowIndex: r.rowIndex,
            subCatchment: r.subCatchment,
            shift: r.shift,
            scheduledName: r.scheduledName,
            actualName: r.actualName,
            remarks: r.remarks ?? null,
          });
        }
      }
      if (rows.length > 0) await tx.insert(phRosterRefTable).values(rows);

      // Persist HR ballot pool state and rotation end index only on real runs
      await tx
        .insert(phHrBallotStateTable)
        .values({ id: 1, pools: hrBallot.pools })
        .onConflictDoUpdate({
          target: phHrBallotStateTable.id,
          set: { pools: hrBallot.pools },
        });

      await tx
        .insert(phRotationStateTable)
        .values({ year: yr, cursorIndex: rotIdx })
        .onConflictDoUpdate({ target: phRotationStateTable.year, set: { cursorIndex: rotIdx } });
    });
  }

  res.json({
    ok: true,
    targetYear: yr,
    generatedCount: Object.keys(generated).length,
    generatedDates: Object.keys(generated).sort(),
    dryRun,
  });
});

// POST /api/ph-roster-ref/realign-subcatchments — repair PH sub-catchment
// labels without changing the officers, shifts, or remarks already saved on
// a row. Adapted from Replit's version, not copied verbatim: that source
// derived each year's rotation start purely from the calendar (walking
// PH_YEAR_SLOTS forward from a 2026 anchor), specifically to avoid trusting
// a mutable cursor across partial regenerations. This repo's autoAllocate()
// above doesn't use that model — it anchors 2027 at PH_2027_ROT_START and
// reads phRotationStateTable's persisted cursor for every other year. This
// route has to match THAT exact logic, not Replit's, or it would relabel
// rows to a rotation position that disagrees with what a future
// auto-allocate run for the same dates would produce — the opposite of what
// a repair tool should do.
phRosterRouter.post("/ph-roster-ref/realign-subcatchments", requireManager, async (req, res) => {
  const { fromDate } = req.body as { fromDate?: string };
  if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    res.status(400).json({ error: "fromDate (YYYY-MM-DD) required" });
    return;
  }

  const [rotStateRows, builderConfig] = await Promise.all([
    db.select().from(phRotationStateTable),
    loadPHBuilderConfig(),
  ]);
  const rotState: Record<number, number> = {};
  for (const r of rotStateRows) rotState[r.year] = r.cursorIndex;
  const yearStart = (year: number): number =>
    year === 2027 ? PH_2027_ROT_START : (rotState[year - 1] ?? PH_2027_ROT_START);
  const rotationPattern = getPHRotationPattern(builderConfig);
  const sequenceLength = rotationPattern.length;

  const slots = Object.values(PH_YEAR_SLOTS)
    .flat()
    .filter((slot) => slot.date >= fromDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  let changedDates = 0;
  for (const slot of slots) {
    const rows = await loadPHRosterRefForDate(slot.date);
    if (!rows.length) continue;

    if (slot.isOilCopy && slot.copyFromDate) {
      // OIL days must always retain the same sub-catchment labels as their
      // source PH — the officer assignments on the OIL rows are preserved.
      const sourceRows = await loadPHRosterRefForDate(slot.copyFromDate);
      rows.forEach((row, index) => {
        if (sourceRows[index]?.subCatchment) row.subCatchment = sourceRows[index].subCatchment;
      });
    } else {
      const year = Number(slot.date.slice(0, 4));
      const nonOilPosition = (PH_YEAR_SLOTS[year] ?? [])
        .filter((s) => !s.isOilCopy && s.date < slot.date)
        .length;
      const rotationIndex = (yearStart(year) + nonOilPosition * 6) % sequenceLength;
      const units = Array.from({ length: 6 }, (_, i) => rotationPattern[(rotationIndex + i) % sequenceLength]);
      rows.forEach((row, index) => {
        const rowIndex = Number.isInteger(row.rowIndex) ? row.rowIndex : index;
        const unit = units[Math.floor(rowIndex / 2)];
        if (unit) row.subCatchment = unit;
      });
    }
    await savePHRosterRefForDate(slot.date, rows);
    changedDates++;
  }

  res.json({ ok: true, fromDate, changedDates });
});

// POST /api/ph-roster-ref/builder-run — replace only excluded future
// assignments (manager+). This intentionally does not call autoAllocate: the
// existing rotation, HR pools, and every non-excluded assignment stay
// untouched — only the rows belonging to a newly-excluded (or newly
// un-excluded) officer are swapped, from/to whichever eligible officer is
// currently at the lowest/highest PH count. .scratch/replit-resync-2026-09-21/issues/31.
phRosterRouter.post("/ph-roster-ref/builder-run", requireManager, async (req, res) => {
  try {
    const officerRows = await db.select().from(officersTable).where(eq(officersTable.active, true));
    const officers = officerRows.map((o) => ({ name: o.name, unitCode: o.unitCode }));
    if (!officers.length) throw new Error("No officers found — set up roster first.");

    const previousConfig = await loadPHBuilderConfig();
    const config = normalizePHBuilderConfig(
      req.body ?? previousConfig,
      new Set(officers.map((o) => o.name)),
      new Set(officers.map((o) => o.unitCode?.trim().toUpperCase()).filter((u): u is string => !!u && u !== "TBC")),
    );

    const excluded = new Set(config.excludedOfficers);
    const removedExceptions = previousConfig.excludedOfficers.filter((name) => !excluded.has(name));
    if (!config.excludedOfficers.length && !removedExceptions.length) {
      throw new Error("There are no staff exception changes to apply");
    }

    const working = await loadAllPHRosterRef();
    const slots = Object.values(PH_YEAR_SLOTS)
      .flat()
      .filter((slot) => !slot.isOilCopy && Number(slot.date.slice(0, 4)) >= config.startYear)
      .sort((a, b) => a.date.localeCompare(b.date));
    const relevantDates = new Set(slots.map((slot) => slot.date));
    const count = new Map<string, number>();
    const getCount = (name: string) => count.get(name) ?? 0;
    for (const [date, rows] of Object.entries(working)) {
      if (!relevantDates.has(date)) continue;
      for (const row of rows) {
        if (!excluded.has(row.scheduledName)) count.set(row.scheduledName, getCount(row.scheduledName) + 1);
      }
    }

    const priorYearByHoliday = new Map<string, Set<string>>();
    for (const [date, rows] of Object.entries(working)) {
      const year = Number(date.slice(0, 4));
      const phName = PH_DATE_NAMES[date];
      if (!phName || phName.includes("In Lieu")) continue;
      priorYearByHoliday.set(`${year}:${phName}`, new Set(rows.map((row) => row.scheduledName)));
    }

    const eligibleNames = officers
      .filter((officer) => officer.unitCode && officer.unitCode.toUpperCase() !== "TBC" && !excluded.has(officer.name))
      .map((officer) => officer.name);
    const changes: Array<{ date: string; holiday: string; from: string; to: string; subCatchment: string; shift: string }> = [];
    const changedDates = new Set<string>();
    const actualName = (row: PHRefRow) => (row.actualName || row.scheduledName || "").trim();

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex];
      const rows = working[slot.date] ?? [];
      const previousRows = slotIndex > 0 ? working[slots[slotIndex - 1].date] ?? [] : [];
      const nextRows = slotIndex + 1 < slots.length ? working[slots[slotIndex + 1].date] ?? [] : [];
      const adjacentNames = new Set([...previousRows, ...nextRows].map(actualName));
      const sameDateNames = new Set(rows.map((row) => row.scheduledName).filter((name) => !excluded.has(name)));
      const previousYearNames = priorYearByHoliday.get(`${Number(slot.date.slice(0, 4)) - 1}:${slot.phName}`) ?? new Set<string>();
      const hrKind = getHRPoolKind(slot.phName);
      const otherHRNames = new Set<string>();
      if (hrKind) {
        const otherKind: HRPoolKind = hrKind === "puasa" ? "haji" : "puasa";
        for (const [date, otherRows] of Object.entries(working)) {
          if (Number(date.slice(0, 4)) !== Number(slot.date.slice(0, 4))) continue;
          if (getHRPoolKind(PH_DATE_NAMES[date] ?? "") !== otherKind) continue;
          otherRows.forEach((row) => otherHRNames.add(row.scheduledName));
        }
      }

      for (const row of rows) {
        if (!excluded.has(row.scheduledName)) continue;
        const globalLowestCount = Math.min(...eligibleNames.map(getCount));
        let candidates = eligibleNames.filter((name) => {
          // Exception replacement is deliberately narrower than a full
          // allocation: only an officer currently at the lowest PH count may
          // receive the extra duty. Never create a count gap larger than +1
          // merely to satisfy a soft preference.
          if (getCount(name) !== globalLowestCount) return false;
          if (sameDateNames.has(name)) return false;
          if (config.consecutivePH && adjacentNames.has(name)) return false;
          if (/chinese new year/i.test(slot.phName) && CNY_EXCLUDED.has(name)) return false;
          if (/deepavali/i.test(slot.phName) && DEEPAVALI_EXCLUDED.has(name)) return false;
          if (hrKind && (!ALL_MUSLIM_OFFICERS.includes(name) || otherHRNames.has(name))) return false;
          return true;
        });
        if (config.sameHolidayPreviousYear) {
          const differentHolidayCandidates = candidates.filter((name) => !previousYearNames.has(name));
          if (differentHolidayCandidates.length) candidates = differentHolidayCandidates;
        }
        if (!candidates.length) {
          throw new Error(
            `No lowest-count officer is eligible to replace ${row.scheduledName} on ${slot.date}; no changes were saved`,
          );
        }
        candidates.sort((a, b) => getCount(a) - getCount(b) || a.localeCompare(b));
        const replacement = candidates[0];
        const previous = row.scheduledName;
        row.scheduledName = replacement;
        if (!row.actualName || row.actualName === previous) row.actualName = replacement;
        sameDateNames.add(replacement);
        count.set(replacement, getCount(replacement) + 1);
        changedDates.add(slot.date);
        changes.push({
          date: slot.date, holiday: slot.phName, from: previous, to: replacement,
          subCatchment: row.subCatchment, shift: row.shift,
        });
      }
    }

    // When an exception is removed, make that officer eligible again immediately.
    // We do not rebuild the year: duties are moved from the currently highest-count
    // eligible officers until the restored officer is back within one duty of them.
    for (const restoredName of removedExceptions) {
      while (true) {
        const donors = eligibleNames
          .filter((name) => name !== restoredName && getCount(name) > getCount(restoredName) + 1)
          .sort((a, b) => getCount(b) - getCount(a) || a.localeCompare(b));
        if (!donors.length) break;

        let restored = false;
        for (let slotIndex = 0; slotIndex < slots.length && !restored; slotIndex++) {
          const slot = slots[slotIndex];
          // Hari Raya duties are governed by their independent ballot pools.
          if (getHRPoolKind(slot.phName)) continue;
          if (/chinese new year/i.test(slot.phName) && CNY_EXCLUDED.has(restoredName)) continue;
          if (/deepavali/i.test(slot.phName) && DEEPAVALI_EXCLUDED.has(restoredName)) continue;

          const rows = working[slot.date] ?? [];
          if (rows.some((row) => row.scheduledName === restoredName)) continue;
          const previousRows = slotIndex > 0 ? working[slots[slotIndex - 1].date] ?? [] : [];
          const nextRows = slotIndex + 1 < slots.length ? working[slots[slotIndex + 1].date] ?? [] : [];
          if (config.consecutivePH &&
              [...previousRows, ...nextRows].some((row) => actualName(row) === restoredName)) {
            continue;
          }

          const row = rows.find((candidate) => donors.includes(candidate.scheduledName));
          if (!row) continue;
          const donor = row.scheduledName;
          row.scheduledName = restoredName;
          if (!row.actualName || row.actualName === donor) row.actualName = restoredName;
          count.set(donor, getCount(donor) - 1);
          count.set(restoredName, getCount(restoredName) + 1);
          changedDates.add(slot.date);
          changes.push({
            date: slot.date, holiday: slot.phName, from: donor, to: restoredName,
            subCatchment: row.subCatchment, shift: row.shift,
          });
          restored = true;
        }

        if (!restored) {
          throw new Error(`No eligible PH assignment can be restored to ${restoredName}; no changes were saved`);
        }
      }
    }

    const maxYear = Math.max(...slots.map((slot) => Number(slot.date.slice(0, 4))));
    for (let year = config.startYear; year <= maxYear; year++) {
      const yearSlots = PH_YEAR_SLOTS[year] ?? [];
      assertNoHRCrossHolidayDoubleDuty(working, yearSlots);
      assertBalancedPHCounts(working, yearSlots, eligibleNames);
    }

    await savePHBuilderConfig(config);
    if (changes.length) {
      await db.transaction(async (tx) => {
        await tx.delete(phRosterRefTable).where(inArray(phRosterRefTable.date, [...changedDates]));
        const insertRows: (typeof phRosterRefTable.$inferInsert)[] = [];
        for (const date of changedDates) {
          for (const r of working[date] ?? []) {
            insertRows.push({
              date, rowIndex: r.rowIndex, subCatchment: r.subCatchment, shift: r.shift,
              scheduledName: r.scheduledName, actualName: r.actualName, remarks: r.remarks ?? null,
            });
          }
        }
        if (insertRows.length > 0) await tx.insert(phRosterRefTable).values(insertRows);
      });
    }
    res.json({ ok: true, changedCount: changes.length, changes, config });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "PH Builder run failed" });
  }
});

// GET /api/ph-roster-ref — all ref data (manager+)
phRosterRouter.get("/ph-roster-ref", requireManager, async (_req, res) => {
  res.json(await loadAllPHRosterRef());
});

// GET /api/ph-faq — get FAQ text
phRosterRouter.get("/ph-faq", async (_req, res) => {
  res.json({ text: await loadFaq() });
});

// PUT /api/ph-faq — save FAQ text (manager+)
phRosterRouter.put("/ph-faq", requireManager, async (req, res) => {
  const { text } = req.body as { text: string };
  if (typeof text !== "string") { res.status(400).json({ error: "text string required" }); return; }
  await saveFaq(text);
  res.json({ ok: true });
});
