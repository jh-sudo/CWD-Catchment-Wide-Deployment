// Canonical PH-roster unit display order — interleaved by team number across
// catchments (CP1, KG1, BU1, PJ1, WK1, CP2, ...), not grouped
// catchment-then-number. Previously duplicated independently in PHHoliday.tsx
// (which had it right) and PHActualPanel.tsx (which used a different,
// catchment-grouped scheme) — consolidated here so the two views can't drift
// apart. .scratch/replit-resync-2026-09-21/issues/08.
//
// This list reflects every unit code actually referenced elsewhere in this
// repo (vehicle-arrangement defaults, roster cycle patterns) as of 2026-09-21
// — 20 units total (BU has 5, the rest have 4). If the roster is ever
// reconfigured to a larger team count with additional units, add them here.
export const PH_UNIT_ORDER = [
  "CP1", "KG1", "BU1", "PJ1", "WK1",
  "CP2", "KG2", "BU2", "PJ2", "WK2",
  "CP3", "KG3", "BU3", "PJ3", "WK3",
  "CP4", "KG4", "BU4", "PJ4",
  "BU5",
];

export function phUnitSortKey(code: string): number {
  const idx = PH_UNIT_ORDER.indexOf(code);
  return idx === -1 ? 999 : idx;
}
