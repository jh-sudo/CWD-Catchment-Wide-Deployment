import { useState, useEffect } from "react";

export interface PHRefRow {
  rowIndex: number;
  subCatchment: string;
  shift: string;
  scheduledName: string;
  actualName: string;
  remarks?: string;
}

// ── Full SG PH calendar (PH + in-lieu / OIL dates) ───────────────────────────
interface PHMeta {
  name: string;
  /** For in-lieu dates: the original PH date to fall back to if no ref rows exist */
  originalDate?: string;
}

const SG_PH_META: Record<string, PHMeta> = {
  // 2025
  "2025-01-01": { name: "New Year's Day" },
  "2025-01-29": { name: "Chinese New Year Day 1" },
  "2025-01-30": { name: "Chinese New Year Day 2" },
  "2025-03-31": { name: "Hari Raya Puasa" },
  "2025-04-18": { name: "Good Friday" },
  "2025-05-01": { name: "Labour Day" },
  "2025-05-12": { name: "Vesak Day" },
  "2025-06-07": { name: "Hari Raya Haji" },
  "2025-08-09": { name: "National Day" },
  "2025-10-20": { name: "Deepavali" },
  "2025-12-25": { name: "Christmas Day" },
  // 2026
  "2026-01-01": { name: "New Year's Day" },
  "2026-02-17": { name: "Chinese New Year Day 1" },
  "2026-02-18": { name: "Chinese New Year Day 2" },
  "2026-03-21": { name: "Hari Raya Puasa" },
  "2026-04-03": { name: "Good Friday" },
  "2026-05-01": { name: "Labour Day" },
  "2026-05-27": { name: "Hari Raya Haji" },
  "2026-05-31": { name: "Vesak Day" },
  "2026-06-01": { name: "Vesak Day (In Lieu)", originalDate: "2026-05-31" },
  "2026-08-09": { name: "National Day" },
  "2026-08-10": { name: "National Day (In Lieu)", originalDate: "2026-08-09" },
  "2026-11-08": { name: "Deepavali" },
  "2026-11-09": { name: "Deepavali (In Lieu)", originalDate: "2026-11-08" },
  "2026-12-25": { name: "Christmas Day" },
  // 2027
  "2027-01-01": { name: "New Year's Day" },
  "2027-02-06": { name: "Chinese New Year Day 1" },
  "2027-02-07": { name: "Chinese New Year Day 2" },
  "2027-02-08": { name: "Chinese New Year Day 2 (In Lieu)", originalDate: "2027-02-07" },
  // Hari Raya dates corrected 2026-09-21 (.scratch/replit-resync-2026-09-21/
  // issues/02) — verified against MOM's official 18-June-2026 gazette.
  // Neither date falls on a Sunday in 2027, so neither gets an in-lieu day.
  // Must stay in sync with phRoster.ts's PH_YEAR_SLOTS[2027] on the backend.
  "2027-03-10": { name: "Hari Raya Puasa" },
  "2027-03-26": { name: "Good Friday" },
  "2027-05-01": { name: "Labour Day" },
  "2027-05-17": { name: "Hari Raya Haji" },
  "2027-05-20": { name: "Vesak Day" },
  "2027-08-09": { name: "National Day" },
  "2027-10-28": { name: "Deepavali" },
  "2027-12-25": { name: "Christmas Day" },
  // 2028 (tentative Islamic/lunar dates marked †)
  "2028-01-01": { name: "New Year's Day" },
  "2028-01-03": { name: "New Year's Day (In Lieu)" },
  "2028-01-26": { name: "Chinese New Year Day 1" },
  "2028-01-27": { name: "Chinese New Year Day 2" },
  "2028-04-14": { name: "Good Friday" },
  "2028-04-17": { name: "Hari Raya Puasa" },
  "2028-05-01": { name: "Labour Day" },
  "2028-05-25": { name: "Vesak Day" },
  "2028-05-27": { name: "Hari Raya Haji" },
  "2028-05-29": { name: "Hari Raya Haji (In Lieu)" },
  "2028-08-09": { name: "National Day" },
  "2028-10-16": { name: "Deepavali" },
  "2028-12-25": { name: "Christmas Day" },
};

/** All official PH + OIL/in-lieu dates — used by TodaysRoster and Roster Cycle */
export const SG_PH_SET = new Set(Object.keys(SG_PH_META));

/** Name lookup map — used by RosterCycle and schedule pages */
export const SG_PH_META_MAP: Record<string, PHMeta> = SG_PH_META;

export interface PHActualsResult {
  isPH: boolean;
  /** True when this date is an in-lieu/OIL copy (has originalDate) — show duty roster, not PHActualPanel */
  isOilCopy: boolean;
  phName: string;
  rows: PHRefRow[];
  /** scheduledName → actualName (only where different) */
  swapMap: Record<string, string>;
  loading: boolean;
}

const cache: Record<string, PHRefRow[]> = {};

/** Invalidate the in-memory cache for a date — call after server-side extraction or save */
export function clearPHCache(date: string): void {
  delete cache[date];
}

export function usePHActuals(date: string): PHActualsResult {
  const meta = SG_PH_META[date] ?? null;
  const isPH = !!meta;
  const isOilCopy = !!meta?.originalDate;
  const phName = meta?.name ?? "";
  const originalDate = meta?.originalDate;

  // OIL Monday = originalDate is a Sunday; don't fall back to the Sunday PH rows
  // (those are the 6 PH-duty units, not the OIL officers)
  const originalIsOilSunday = originalDate
    ? new Date(originalDate + "T00:00:00Z").getUTCDay() === 0
    : false;

  const [rows, setRows] = useState<PHRefRow[]>(cache[date] ?? []);
  const [loading, setLoading] = useState<boolean>(isPH && !cache[date]);

  useEffect(() => {
    if (!date || !isPH) { setRows([]); setLoading(false); return; }
    if (cache[date]) { setRows(cache[date]); setLoading(false); return; }
    setLoading(true);

    fetch(`/api/ph-roster-ref/${date}`)
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(async d => {
        let r: PHRefRow[] = d.rows ?? [];
        // Non-OIL in-lieu fallback: if no rows for this in-lieu date, use the original PH date's rows.
        // Skip for OIL Monday (originalIsOilSunday) — those need the auto-extracted Sunday target rows,
        // which are different from the Sunday's PH-duty rows.
        if (r.length === 0 && originalDate && !originalIsOilSunday) {
          const fb = await fetch(`/api/ph-roster-ref/${originalDate}`)
            .then(r2 => r2.ok ? r2.json() : { rows: [] })
            .catch(() => ({ rows: [] }));
          r = fb.rows ?? [];
        }
        cache[date] = r;
        setRows(r);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [date, isPH, originalDate, originalIsOilSunday]);

  const swapMap: Record<string, string> = {};
  for (const row of rows) {
    if (row.actualName && row.scheduledName && row.actualName !== row.scheduledName) {
      swapMap[row.scheduledName] = row.actualName;
    }
  }

  return { isPH, isOilCopy, phName, rows, swapMap, loading };
}
