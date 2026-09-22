import React from "react";
import { cn } from "@/lib/utils";
import { getContrastColor } from "@/lib/contrast";
import { Loader2 } from "lucide-react";
import type { PHRefRow } from "@/lib/usePHActuals";
import { phUnitSortKey } from "@/lib/phUnitOrder";

const DUTY_COLORS: Record<string, string> = {
  DAY: "bg-blue-100 text-blue-700",
  PD:  "bg-amber-100 text-amber-700",
  ND:  "bg-purple-100 text-purple-700",
};

const CATCHMENT_PH_BG: Record<string, string> = {
  BU: "#FFFFCC",
  PJ: "#D0D0D0",
  WK: "#FBE2D5",
  CP: "#DAF2D0",
  KG: "#CAEDFB",
};

// Ordering now comes from the shared @/lib/phUnitOrder module — this file
// previously kept its own, differently-grouped copy (catchment-then-number
// instead of the canonical interleaved-by-number order used elsewhere, e.g.
// PHHoliday.tsx), which could disagree with the rest of the app.
// .scratch/replit-resync-2026-09-21/issues/08.
const unitSortKey = phUnitSortKey;

interface Props {
  phName: string;
  rows: PHRefRow[];
  loading?: boolean;
  className?: string;
}

/**
 * Read-only PH Actual Roster table — shown on PH and PH OIL days
 * in Today's Roster, Roster Cycle, and Roster Override pages.
 */
export function PHActualPanel({ phName, rows, loading, className }: Props) {
  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground py-3", className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading PH actual roster…
      </div>
    );
  }

  if (rows.length === 0) return null;

  const changedRows = rows.filter(r => r.actualName && r.actualName !== r.scheduledName);

  return (
    <div className={cn("rounded-lg border overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200">
        <span className="text-base">🎉</span>
        <span className="text-xs font-semibold text-amber-800">
          {phName} — PH Actual Roster
        </span>
        {changedRows.length > 0 && (
          <span className="ml-auto text-[10px] font-medium text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
            {changedRows.length} swap{changedRows.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="bg-muted border-b">
              <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                Sub-Catchment<br />
                <span className="text-[10px] font-normal normal-case tracking-normal opacity-60">(follow pattern)</span>
              </th>
              <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                Shift
              </th>
              <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                Scheduled
              </th>
              <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                Actual
              </th>
              <th className="text-center px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                Changed?
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows].sort((a, b) => unitSortKey(a.subCatchment) - unitSortKey(b.subCatchment)).map((row, i) => {
              const swapped = !!row.actualName && row.actualName !== row.scheduledName;
              const prefix = row.subCatchment.replace(/[0-9]/g, "");
              const unitBg = CATCHMENT_PH_BG[prefix] ?? "#F5F5F5";
              return (
                <tr
                  key={`${row.subCatchment}_${row.rowIndex}_${i}`}
                  className="border-b last:border-0"
                  style={{ backgroundColor: unitBg, color: getContrastColor(unitBg) }}
                >
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                      {row.subCatchment}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", DUTY_COLORS[row.shift] ?? "bg-gray-100 text-gray-600")}>
                      {row.shift}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-sm whitespace-nowrap">
                    {swapped ? <s>{row.scheduledName}</s> : row.scheduledName}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className={cn(
                      "text-sm font-medium",
                      swapped ? "text-amber-700 font-semibold" : ""
                    )}>
                      {row.actualName || row.scheduledName}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {swapped
                      ? <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-200 text-yellow-800">Yes</span>
                      : <span className="text-[10px] font-medium text-green-600">No</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
