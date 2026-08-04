import { sql } from "drizzle-orm";
import { db, phRosterRefTable, phHrBallotStateTable, phRotationStateTable, phFaqTable } from "@workspace/db";
import { readJson } from "./lib/read";
import type { DomainReport, TableReport } from "./lib/report";

interface PHRefRowJson {
  rowIndex: number;
  subCatchment: string;
  shift: string;
  scheduledName: string;
  actualName: string;
  remarks?: string;
}

type PHRosterRefJson = Record<string, PHRefRowJson[]>;

interface HRBallotStateJson {
  pool: string[];
  initialized: boolean;
}

type RotStateJson = Record<string, number>;

interface FaqJson {
  text: string;
}

export async function backfillPhRoster(dryRun: boolean): Promise<DomainReport> {
  const tables: TableReport[] = [];
  const warnings: string[] = [];

  // ── ph_roster_ref ────────────────────────────────────────────────────────
  const rosterRef = readJson<PHRosterRefJson>("ph-roster-ref.json", {});
  const refRows = Object.entries(rosterRef).flatMap(([date, rows]) =>
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
  if (!dryRun && refRows.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < refRows.length; i += CHUNK) {
      const chunk = refRows.slice(i, i + CHUNK);
      await db
        .insert(phRosterRefTable)
        .values(chunk)
        .onConflictDoUpdate({
          target: [phRosterRefTable.date, phRosterRefTable.rowIndex],
          set: {
            subCatchment: sql`excluded.sub_catchment`,
            shift: sql`excluded.shift`,
            scheduledName: sql`excluded.scheduled_name`,
            actualName: sql`excluded.actual_name`,
            remarks: sql`excluded.remarks`,
          },
        });
    }
  }
  tables.push({ table: "ph_roster_ref", sourceCount: refRows.length, upserted: dryRun ? 0 : refRows.length });

  // ── ph_hr_ballot_state (singleton) ──────────────────────────────────────
  const hrBallot = readJson<HRBallotStateJson | null>("ph-hr-ballot.json", null);
  if (hrBallot && !dryRun) {
    await db
      .insert(phHrBallotStateTable)
      .values({ id: 1, pool: hrBallot.pool, initialized: hrBallot.initialized })
      .onConflictDoUpdate({ target: phHrBallotStateTable.id, set: { pool: sql`excluded.pool`, initialized: sql`excluded.initialized` } });
  }
  tables.push({ table: "ph_hr_ballot_state", sourceCount: hrBallot ? 1 : 0, upserted: dryRun || !hrBallot ? 0 : 1 });

  // ── ph_rotation_state ────────────────────────────────────────────────────
  const rotState = readJson<RotStateJson>("ph-rot-state.json", {});
  const rotRows = Object.entries(rotState).map(([year, cursorIndex]) => ({ year: Number(year), cursorIndex }));
  if (!dryRun && rotRows.length > 0) {
    await db
      .insert(phRotationStateTable)
      .values(rotRows)
      .onConflictDoUpdate({ target: phRotationStateTable.year, set: { cursorIndex: sql`excluded.cursor_index` } });
  }
  tables.push({ table: "ph_rotation_state", sourceCount: rotRows.length, upserted: dryRun ? 0 : rotRows.length });

  // ── ph_faq (singleton) ───────────────────────────────────────────────────
  const faq = readJson<FaqJson | null>("ph-faq.json", null);
  if (faq && !dryRun) {
    await db
      .insert(phFaqTable)
      .values({ id: 1, text: faq.text })
      .onConflictDoUpdate({ target: phFaqTable.id, set: { text: sql`excluded.text` } });
  }
  tables.push({ table: "ph_faq", sourceCount: faq ? 1 : 0, upserted: dryRun || !faq ? 0 : 1 });

  // ── ph_roster_overrides / ph_ballot ──────────────────────────────────────
  // ph-roster.json and ph-ballot.json don't exist on disk today — both are
  // "currently empty" per the PH roster schema ticket and were never written.
  // Nothing to migrate; noted for completeness.
  tables.push({ table: "ph_roster_overrides", sourceCount: 0, upserted: 0 });
  tables.push({ table: "ph_ballot", sourceCount: 0, upserted: 0 });

  return { domain: "04 PH roster", tables, warnings };
}
