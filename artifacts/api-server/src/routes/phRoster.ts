import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireManager } from "./auth.js";
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
} from "@workspace/db";

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

// GET /api/ph-roster-ref/:date — get reference rows for a date
phRosterRouter.get("/ph-roster-ref/:date", async (req, res) => {
  const { date } = req.params as { date: string };
  const rows = await loadPHRosterRefForDate(date);
  res.json({ rows });
});

// PUT /api/ph-roster-ref/:date — save updated ref rows (manager+)
phRosterRouter.put("/ph-roster-ref/:date", requireManager, async (req, res) => {
  const { date } = req.params as { date: string };
  const { rows } = req.body as { rows: PHRefRow[] };
  if (!Array.isArray(rows)) { res.status(400).json({ error: "rows array required" }); return; }
  await savePHRosterRefForDate(date, rows);
  res.json({ ok: true });
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
    // HR Haji (16 May) falls on a Sunday → OIL on 17 May (Monday). No other 2027 PHs fall on Sunday.
    { date: "2027-01-01", phName: "New Year's Day",                        isOilCopy: false },
    { date: "2027-01-29", phName: "Chinese New Year Day 1",                isOilCopy: false },
    { date: "2027-01-30", phName: "Chinese New Year Day 2",                isOilCopy: false },
    { date: "2027-03-09", phName: "Hari Raya Puasa",                       isOilCopy: false },
    { date: "2027-03-26", phName: "Good Friday",                           isOilCopy: false },
    { date: "2027-05-01", phName: "Labour Day",                            isOilCopy: false },
    { date: "2027-05-16", phName: "Hari Raya Haji",                        isOilCopy: false },
    { date: "2027-05-17", phName: "Hari Raya Haji (In Lieu)",              isOilCopy: true,  copyFromDate: "2027-05-16" },
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

// Active pool entering 2027 (12 officers remaining after 2025–2026 draws)
const HR_BALLOT_POOL_2027_INITIAL: readonly string[] = [
  "Officer-16","Officer-33","Officer-20","Officer-21","Officer-34","Officer-17","Officer-38",
  "Officer-29","Officer-27","Officer-05","Officer-01","Officer-12",
];

interface HRBallotState {
  /** Officers still to be drawn, in draw order. */
  pool: string[];
  /** True once the 2027 initial pool has been seeded. */
  initialized: boolean;
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
 * cursor, HR ballot pool) is loaded by the caller and passed in; nothing
 * here touches the database directly.
 */
function autoAllocate(
  officers: { name: string; unitCode: string }[],
  slots: PHSlot[],
  savedRef: PHRosterRef,
  rotState: Record<number, number>,
  hrBallotState: HRBallotState,
): { result: PHRosterRef; hrBallot: HRBallotState; rotIdx: number; targetYear: number } {

  // ── All active officer names ─────────────────────────────────────────
  const allOfficers = officers
    .filter(o => o.unitCode && o.unitCode.toUpperCase() !== "TBC")
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

  // ── HR ballot pool ───────────────────────────────────────────────────
  const hrBallot: HRBallotState = hrBallotState.initialized
    ? { pool: [...hrBallotState.pool], initialized: true }
    : { pool: [...HR_BALLOT_POOL_2027_INITIAL], initialized: true };

  /**
   * Draw n officers from the HR exhaustion pool.
   * Restarts from the full Muslim list when pool is empty (excluding already
   * drawn in the same call to avoid duplicates within a single PH).
   */
  const drawFromHRBallot = (n: number): string[] => {
    const drawn: string[] = [];
    while (drawn.length < n) {
      if (hrBallot.pool.length === 0) {
        const drawnSet = new Set(drawn);
        hrBallot.pool = ALL_MUSLIM_OFFICERS.filter(o => !drawnSet.has(o)) as string[];
      }
      drawn.push(hrBallot.pool.shift()!);
    }
    return drawn;
  };

  // ── PH type helpers ──────────────────────────────────────────────────
  const isCNY = (ph: string) => /chinese new year/i.test(ph);
  const isHR  = (ph: string) => /hari raya/i.test(ph);
  const isDp  = (ph: string) => /deepavali/i.test(ph);

  // ── Rule checks ──────────────────────────────────────────────────────
  const failsRuleA = (n: string)              => prevPHOfficers.has(n);
  const failsRuleB = (n: string, ph: string)  => priorYearPH.get(n)?.has(ph) ?? false;

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
    Array.from({ length: 6 }, (_, i) => PH_ROTATION_SEQUENCE[(idx + i) % PH_SEQ_LEN]);

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
  const allocateHariRaya = (units: string[]): PHRefRow[] => {
    const balloted = drawFromHRBallot(8); // 6 PD + 2 DAY
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
    rotIdx = (rotIdx + 6) % PH_SEQ_LEN;

    let rows: PHRefRow[];
    if      (isHR(phName))  rows = allocateHariRaya(units);
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
          if (isHR(phName)) continue;

          // Already in this PH
          if (rows.some(r => r.scheduledName === candidate)) continue;

          // Racially excluded
          if (phExclMap.get(date)?.has(candidate)) continue;

          // Rule A: candidate must not have worked the preceding PH
          if (precWorkersMap.get(date)?.has(candidate)) continue;

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

  const [savedRef, rotStateRows, [hrBallotRow]] = await Promise.all([
    loadAllPHRosterRef(),
    db.select().from(phRotationStateTable),
    db.select().from(phHrBallotStateTable).where(eq(phHrBallotStateTable.id, 1)),
  ]);
  const rotState: Record<number, number> = {};
  for (const r of rotStateRows) rotState[r.year] = r.cursorIndex;
  const hrBallotState: HRBallotState = hrBallotRow
    ? { pool: hrBallotRow.pool, initialized: hrBallotRow.initialized }
    : { pool: [...HR_BALLOT_POOL_2027_INITIAL], initialized: true };

  const { result: generated, hrBallot, rotIdx, targetYear: yr } = autoAllocate(officers, slots, savedRef, rotState, hrBallotState);

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
        .values({ id: 1, pool: hrBallot.pool, initialized: hrBallot.initialized })
        .onConflictDoUpdate({
          target: phHrBallotStateTable.id,
          set: { pool: hrBallot.pool, initialized: hrBallot.initialized },
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
