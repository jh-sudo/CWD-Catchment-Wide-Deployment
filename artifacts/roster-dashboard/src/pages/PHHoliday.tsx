import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Save, CheckCircle2, AlertCircle, Pencil, X, Wand2, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { getContrastColor } from "@/lib/contrast";
import { useAuth } from "@/context/AuthContext";
import { useGetRosterOfficers } from "@workspace/api-client-react";
import { useRosterVersion } from "@/context/RosterVersionContext";
import { clearPHCache } from "@/lib/usePHActuals";

// ── Singapore Public Holiday data ─────────────────────────────────────────────
interface PHEntry {
  date: string;       // yyyy-MM-dd (effective date, incl. in-lieu)
  actualDate?: string; // original date if weekend
  name: string;
  emoji: string;
  inLieu?: boolean;   // true if this is an in-lieu date
  tentative?: boolean;
}

const SG_PH: Record<string, PHEntry[]> = {
  "2025": [
    { date: "2025-01-01", name: "New Year's Day", emoji: "🎆" },
    { date: "2025-01-29", name: "Chinese New Year Day 1", emoji: "🧧" },
    { date: "2025-01-30", name: "Chinese New Year Day 2", emoji: "🧧" },
    { date: "2025-03-31", name: "Hari Raya Puasa", emoji: "🌙" },
    { date: "2025-04-18", name: "Good Friday", emoji: "✝️" },
    { date: "2025-05-01", name: "Labour Day", emoji: "💼" },
    { date: "2025-05-12", name: "Vesak Day", emoji: "☸️" },
    { date: "2025-06-07", name: "Hari Raya Haji", emoji: "🕌" },
    { date: "2025-08-09", name: "National Day", emoji: "🇸🇬" },
    { date: "2025-10-20", name: "Deepavali", emoji: "🪔" },
    { date: "2025-12-25", name: "Christmas Day", emoji: "🎄" },
  ],
  "2026": [
    { date: "2026-01-01", name: "New Year's Day", emoji: "🎆" },
    { date: "2026-02-17", name: "Chinese New Year Day 1", emoji: "🧧" },
    { date: "2026-02-18", name: "Chinese New Year Day 2", emoji: "🧧" },
    { date: "2026-03-21", name: "Hari Raya Puasa", emoji: "🌙", tentative: true },
    { date: "2026-04-03", name: "Good Friday", emoji: "✝️" },
    { date: "2026-05-01", name: "Labour Day", emoji: "💼" },
    { date: "2026-05-27", name: "Hari Raya Haji", emoji: "🕌", tentative: true },
    { date: "2026-05-31", name: "Vesak Day", emoji: "☸️" },
    { date: "2026-06-01", name: "Vesak Day (In Lieu)", emoji: "☸️", inLieu: true, actualDate: "2026-05-31" },
    { date: "2026-08-09", name: "National Day", emoji: "🇸🇬" },
    { date: "2026-08-10", name: "National Day (In Lieu)", emoji: "🇸🇬", inLieu: true, actualDate: "2026-08-09" },
    { date: "2026-11-08", name: "Deepavali", emoji: "🪔", tentative: true },
    { date: "2026-11-09", name: "Deepavali (In Lieu)", emoji: "🪔", inLieu: true, actualDate: "2026-11-08", tentative: true },
    { date: "2026-12-25", name: "Christmas Day", emoji: "🎄" },
  ],
  "2027": [
    { date: "2027-01-01", name: "New Year's Day", emoji: "🎆" },
    { date: "2027-02-06", name: "Chinese New Year Day 1", emoji: "🧧" },
    { date: "2027-02-07", name: "Chinese New Year Day 2", emoji: "🧧" },
    { date: "2027-02-08", name: "Chinese New Year Day 2 (In Lieu)", emoji: "🧧", inLieu: true, actualDate: "2027-02-07" },
    { date: "2027-03-09", name: "Hari Raya Puasa", emoji: "🌙", tentative: true },
    { date: "2027-03-26", name: "Good Friday", emoji: "✝️" },
    { date: "2027-05-01", name: "Labour Day", emoji: "💼" },
    { date: "2027-05-16", name: "Hari Raya Haji", emoji: "🕌", tentative: true },
    { date: "2027-05-17", name: "Hari Raya Haji (In Lieu)", emoji: "🕌", inLieu: true, actualDate: "2027-05-16", tentative: true },
    { date: "2027-05-20", name: "Vesak Day", emoji: "☸️", tentative: true },
    { date: "2027-08-09", name: "National Day", emoji: "🇸🇬" },
    { date: "2027-10-28", name: "Deepavali", emoji: "🪔", tentative: true },
    { date: "2027-12-25", name: "Christmas Day", emoji: "🎄" },
  ],
  "2028": [
    { date: "2028-01-01", name: "New Year's Day", emoji: "🎆" },
    { date: "2028-01-03", name: "New Year's Day (In Lieu)", emoji: "🎆", inLieu: true, actualDate: "2028-01-01" },
    { date: "2028-01-26", name: "Chinese New Year Day 1", emoji: "🧧", tentative: true },
    { date: "2028-01-27", name: "Chinese New Year Day 2", emoji: "🧧", tentative: true },
    { date: "2028-04-14", name: "Good Friday", emoji: "✝️" },
    { date: "2028-04-17", name: "Hari Raya Puasa", emoji: "🌙", tentative: true },
    { date: "2028-05-01", name: "Labour Day", emoji: "💼" },
    { date: "2028-05-25", name: "Vesak Day", emoji: "☸️", tentative: true },
    { date: "2028-05-27", name: "Hari Raya Haji", emoji: "🕌", tentative: true },
    { date: "2028-05-29", name: "Hari Raya Haji (In Lieu)", emoji: "🕌", inLieu: true, actualDate: "2028-05-27", tentative: true },
    { date: "2028-08-09", name: "National Day", emoji: "🇸🇬" },
    { date: "2028-10-16", name: "Deepavali", emoji: "🪔", tentative: true },
    { date: "2028-12-25", name: "Christmas Day", emoji: "🎄" },
  ],
};

// All PH entries sorted, for PH Roster dropdown (rolling 3-year window)
const _thisYear = new Date().getFullYear();
const _availYears = [String(_thisYear - 1), String(_thisYear), String(_thisYear + 1)]
  .filter(y => !!SG_PH[y]);
if (_availYears.length === 0) _availYears.push("2026");
const ALL_PH_OPTIONS: PHEntry[] = _availYears
  .flatMap(y => SG_PH[y] ?? [])
  .sort((a, b) => a.date.localeCompare(b.date));

// Auto-select the nearest upcoming PH (or most recent past if none upcoming)
function getDefaultPHDate(): string {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = ALL_PH_OPTIONS.find(ph => ph.date >= today);
  if (upcoming) return upcoming.date;
  return ALL_PH_OPTIONS[ALL_PH_OPTIONS.length - 1]?.date ?? "";
}

// Unit color map — one tint per catchment family
const UNIT_COLORS: Record<string, string> = {
  // BU — light yellow
  BU1: "#FFFFCC", BU2: "#FFFFCC", BU3: "#FFFFCC", BU4: "#FFFFCC", BU5: "#FFFFCC",
  // PJ — light grey
  PJ1: "#D0D0D0", PJ2: "#D0D0D0", PJ3: "#D0D0D0", PJ4: "#D0D0D0",
  // WK — light peach
  WK1: "#FBE2D5", WK2: "#FBE2D5", WK3: "#FBE2D5",
  // CP — light green
  CP1: "#DAF2D0", CP2: "#DAF2D0", CP3: "#DAF2D0", CP4: "#DAF2D0",
  // KG — light blue
  KG1: "#CAEDFB", KG2: "#CAEDFB", KG3: "#CAEDFB", KG4: "#CAEDFB",
};

// Canonical unit order — interleaved by number across catchments
const UNIT_ORDER = [
  "CP1","KG1","BU1","PJ1","WK1",
  "CP2","KG2","BU2","PJ2","WK2",
  "CP3","KG3","BU3","PJ3","WK3",
  "CP4","KG4","BU4","PJ4",
  "BU5",
];
const unitSortKey = (code: string) => {
  const idx = UNIT_ORDER.indexOf(code);
  return idx === -1 ? 999 : idx;
};

// ── Tab 1: List of PH ─────────────────────────────────────────────────────────
function PHList({ onSelectDate }: { onSelectDate: (date: string) => void }) {
  const thisYear = new Date().getFullYear();
  const availableYears = [String(thisYear - 1), String(thisYear), String(thisYear + 1)]
    .filter(y => !!SG_PH[y]);
  const defaultYear = availableYears.includes(String(thisYear))
    ? String(thisYear)
    : (availableYears[availableYears.length - 1] ?? "2026");
  const [year, setYear] = useState(defaultYear);

  return (
    <div className="flex flex-col gap-4">
      {/* Year tabs — rolling 3-year window */}
      <div className="flex gap-2">
        {availableYears.map(y => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors",
              year === y
                ? "bg-primary text-primary-foreground border-primary"
                : "border-gray-300 text-muted-foreground hover:bg-muted"
            )}
          >
            {y}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Source: Ministry of Manpower (MOM) Singapore. Dates marked † are subject to official announcement.
      </p>

      {/* PH table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted border-b">
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-32">Date</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-16">Day</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Holiday</th>
            </tr>
          </thead>
          <tbody>
            {SG_PH[year].map((ph, i) => {
              const d = parseISO(ph.date);
              return (
                <tr
                  key={ph.date + ph.name}
                  onClick={() => onSelectDate(ph.date)}
                  className={cn(
                    "border-b last:border-0 cursor-pointer hover:bg-blue-50 active:bg-blue-100 transition-colors",
                    ph.inLieu ? "bg-muted/40" : i % 2 === 0 ? "bg-background" : "bg-muted/20"
                  )}
                  title="Tap to view PH Roster for this date"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                    {format(d, "d MMM yyyy")}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {format(d, "EEE")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="mr-2">{ph.emoji}</span>
                    <span className={cn(
                      "font-medium",
                      ph.inLieu ? "text-muted-foreground text-xs" : "text-foreground"
                    )}>
                      {ph.name}
                      {ph.tentative && <span className="text-[10px] text-amber-600 ml-1">†</span>}
                    </span>
                    {ph.inLieu && ph.actualDate && (
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        (in lieu of {format(parseISO(ph.actualDate), "EEE d MMM")})
                      </span>
                    )}
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

// ── Tab 2: PH Roster ──────────────────────────────────────────────────────────
interface ScheduleEntry {
  officerId: string;
  officerName: string;
  unitCode: string;
  targetDuty: string;
  duty: string;
  date: string;
}

interface PHOverride {
  actualOfficerName: string;
  actualOfficerId: string;
  swapDone: boolean;
  remarks: string;
}

interface PHRefRow {
  rowIndex: number;
  subCatchment: string;
  shift: string;
  scheduledName: string;
  actualName: string;
  remarks?: string;
}

function PHRoster({ jumpDate }: { jumpDate?: string }) {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "manager" || user?.role === "ic";

  const [selectedDate, setSelectedDate] = useState<string>(getDefaultPHDate());
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [overrides, setOverrides] = useState<Record<string, PHOverride>>({});
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<PHOverride>>>({});
  const [refRows, setRefRows] = useState<PHRefRow[]>([]);
  const [refEdits, setRefEdits] = useState<Record<string, { scheduledName?: string; actualName?: string; remarks?: string }>>({});
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { bumpVersion } = useRosterVersion();

  // ── Swipe navigation ─────────────────────────────────────────────────────
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const navigatePH = useCallback((dir: 1 | -1) => {
    const idx = ALL_PH_OPTIONS.findIndex(ph => ph.date === selectedDate);
    const next = idx + dir;
    if (next >= 0 && next < ALL_PH_OPTIONS.length) {
      setSelectedDate(ALL_PH_OPTIONS[next].date);
    }
  }, [selectedDate]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const dy = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    navigatePH(dx < 0 ? 1 : -1);
  }, [navigatePH]);

  // Jump to a date selected from the "List of PH" tab
  useEffect(() => {
    if (jumpDate) setSelectedDate(jumpDate);
  }, [jumpDate]);

  const { data: rawOfficers } = useGetRosterOfficers();
  const allOfficers = useMemo(() =>
    ((rawOfficers ?? []) as any[]).sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [rawOfficers]
  );

  const selectedPH = useMemo(
    () => ALL_PH_OPTIONS.find(ph => ph.date === selectedDate) ?? null,
    [selectedDate]
  );
  const isMonOIL = useMemo(() => {
    if (!selectedPH?.inLieu || !selectedPH.actualDate) return false;
    return format(parseISO(selectedPH.actualDate), "EEE") === "Sun";
  }, [selectedPH]);

  // Load schedule + overrides + ref data when PH date changes
  const loadSchedule = useCallback(async (date: string, fetchDate: string) => {
    setSchedule([]); setOverrides({}); setLocalEdits({});
    setRefRows([]); setRefEdits({});
    setLoadingSchedule(true); setMsg(null);
    try {
      const [schedData, ovData, refData] = await Promise.all([
        fetch(`/api/roster-plan/schedule?date=${fetchDate}`).then(r => r.ok ? r.json() : { duties: [] }),
        fetch(`/api/ph-roster/${date}`).then(r => r.ok ? r.json() : { overrides: {} }),
        fetch(`/api/ph-roster-ref/${date}`).then(r => r.ok ? r.json() : { rows: [] }),
      ]);
      // /api/roster-plan/schedule returns a whole week's duties per officer
      // (rosterPlan.ts's weekDates.map), not just fetchDate — filtering by
      // duty type alone let every other qualifying day that week through
      // too, producing multiple rows per officerId (duplicate React keys,
      // and a "Scheduled" column silently mixing in other days' duties).
      const working: ScheduleEntry[] = ((schedData.duties ?? []) as any[])
        .filter((d: any) => d.date === fetchDate && ["DAY", "PD", "ND"].includes(d.duty ?? d.targetDuty))
        .map((d: any) => {
          const off = (allOfficers as any[]).find((o: any) => o.id === d.officerId);
          return {
            officerId: d.officerId,
            officerName: off?.name ?? d.officerId,
            unitCode: off?.unitCode ?? "",
            targetDuty: d.duty ?? d.targetDuty ?? "",
            duty: d.duty ?? d.targetDuty ?? "",
            date,
          };
        });
      setSchedule(working);
      setOverrides(ovData.overrides ?? {});

      // OIL Monday: if no ref rows for this in-lieu date, auto-extract from Sunday target roster
      let refRowsFinal = refData.rows ?? [];
      if (refRowsFinal.length === 0 && fetchDate !== date) {
        try {
          const extractRes = await fetch(`/api/roster-plan/ph-extract-sunday/${date}`, {
            method: "POST", credentials: "include",
          });
          if (extractRes.ok) {
            const extracted = await fetch(`/api/ph-roster-ref/${date}`)
              .then(r => r.ok ? r.json() : { rows: [] });
            refRowsFinal = extracted.rows ?? [];
            // Auto-apply immediately so all views are in sync
            if (refRowsFinal.length > 0) {
              fetch(`/api/roster-plan/ph-apply/${date}`, { method: "POST", credentials: "include" })
                .then(() => { clearPHCache(date); bumpVersion(); })
                .catch(() => {});
            }
          } else {
            // Was silently swallowed (.scratch/roster-qa/issues/04) — the
            // 404 case is expected (Sunday not configured yet) and worth
            // telling the operator, not just leaving the ref roster empty
            // with no explanation.
            const err = await extractRes.json().catch(() => null);
            setMsg({ ok: false, text: err?.error ?? "Could not auto-extract this OIL Monday's roster." });
          }
        } catch { /* genuine network failure — leave refRowsFinal empty */ }
      }
      setRefRows(refRowsFinal);
    } catch {
      setMsg({ ok: false, text: "Failed to load — please retry." });
    } finally { setLoadingSchedule(false); }
  }, [allOfficers, bumpVersion]);

  useEffect(() => {
    if (!selectedDate) return;
    const ph = ALL_PH_OPTIONS.find(p => p.date === selectedDate) ?? null;
    const isOIL = !!(ph?.inLieu && ph?.actualDate && format(parseISO(ph.actualDate), "EEE") === "Sun");
    const fetchDate = isOIL ? ph!.actualDate! : selectedDate;
    loadSchedule(selectedDate, fetchDate);
  }, [selectedDate, loadSchedule]);

  const getEffectiveOfficerName = (entry: ScheduleEntry) => {
    const le = localEdits[entry.officerId];
    const ov = overrides[entry.officerId];
    if (le?.actualOfficerName !== undefined) return le.actualOfficerName;
    if (ov?.actualOfficerName) return ov.actualOfficerName;
    return entry.officerName;
  };

  const isSwapped = (entry: ScheduleEntry) => {
    const le = localEdits[entry.officerId];
    const ov = overrides[entry.officerId];
    const actual = le?.actualOfficerName !== undefined ? le.actualOfficerName : (ov?.actualOfficerName ?? entry.officerName);
    return actual !== entry.officerName;
  };

  const getRemarks = (entry: ScheduleEntry) => {
    const le = localEdits[entry.officerId];
    const ov = overrides[entry.officerId];
    if (le?.remarks !== undefined) return le.remarks;
    return ov?.remarks ?? "";
  };

  const isDirty = Object.keys(localEdits).length > 0;
  const isRefMode = refRows.length > 0;
  const isRefDirty = Object.keys(refEdits).length > 0;

  const getRefScheduled = (row: PHRefRow) => {
    const key = `${row.subCatchment}_${row.rowIndex}`;
    return refEdits[key]?.scheduledName ?? row.scheduledName;
  };
  const getRefActual = (row: PHRefRow) => {
    const key = `${row.subCatchment}_${row.rowIndex}`;
    return refEdits[key]?.actualName ?? row.actualName;
  };
  const getRefRemarks = (row: PHRefRow) => {
    const key = `${row.subCatchment}_${row.rowIndex}`;
    return refEdits[key]?.remarks ?? (row.remarks ?? "");
  };
  const isRefSwapped = (row: PHRefRow) => {
    const actual = getRefActual(row);
    return actual !== "" && actual !== getRefScheduled(row);
  };

  // Count of rows where actual ≠ scheduled (across all rows, including already-saved changes)
  const refChangedCount = useMemo(() =>
    refRows.filter(row => {
      const actual = getRefActual(row);
      return actual !== "" && actual !== getRefScheduled(row);
    }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refRows, refEdits]
  );

  const handleSaveRef = async () => {
    if (!selectedDate) return;
    setSaving(true); setMsg(null);
    try {
      const updatedRows = refRows.map(row => {
        const key = `${row.subCatchment}_${row.rowIndex}`;
        const edit = refEdits[key];
        return {
          ...row,
          scheduledName: edit?.scheduledName !== undefined ? edit.scheduledName : row.scheduledName,
          actualName: edit?.actualName !== undefined ? edit.actualName : row.actualName,
          remarks: edit?.remarks !== undefined ? edit.remarks : (row.remarks ?? ""),
        };
      });
      const res = await fetch(`/api/ph-roster-ref/${selectedDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // isMonOIL is derived from ALL_PH_OPTIONS' real inLieu/actualDate
        // calendar data (see above), so it's ground truth — passing it
        // explicitly means the backend's own OIL-Monday detection (which
        // otherwise has to infer this from whether the prior Sunday has
        // saved ref rows) doesn't have to guess for a request this page
        // already knows the answer to.
        body: JSON.stringify({ rows: updatedRows, isOilMonday: isMonOIL }),
      });
      if (!res.ok) throw new Error("Save failed");

      // Record all PH_SWAP entries for rows where actual ≠ scheduled
      const phEntry = ALL_PH_OPTIONS.find(ph => ph.date === selectedDate);
      const changes = updatedRows
        .filter(row => row.actualName !== row.scheduledName)
        .map(row => ({ subCatchment: row.subCatchment, shift: row.shift, scheduledName: row.scheduledName, actualName: row.actualName }));
      const swapsRes = await fetch(`/api/ph-roster-ref/${selectedDate}/swaps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ changes, phName: phEntry?.name ?? selectedDate }),
      });
      let skipWarning = "";
      if (swapsRes.ok) {
        const swapsData = await swapsRes.json() as {
          skipped: number;
          skippedEntries?: Array<{ scheduledName: string; actualName: string; unmatched: string[] }>;
        };
        if (swapsData.skipped > 0) {
          const names = (swapsData.skippedEntries ?? [])
            .flatMap((e) => e.unmatched)
            .filter((v, i, arr) => arr.indexOf(v) === i);
          skipWarning = ` ⚠️ ${swapsData.skipped} swap${swapsData.skipped !== 1 ? "s" : ""} could not be recorded — unrecognised officer name${names.length !== 1 ? "s" : ""}: ${names.join(", ")}.`;
        }
      }

      setRefRows(updatedRows);
      setRefEdits({});

      // Auto-apply to Excel > Master and sync all views
      let syncMsg = "";
      try {
        const applyRes = await fetch(`/api/roster-plan/ph-apply/${selectedDate}`, {
          method: "POST", credentials: "include",
        });
        if (applyRes.ok) {
          const applyData = await applyRes.json();
          syncMsg = ` Synced: ${applyData.phDutyCount ?? 0} PH + ${applyData.oilCount ?? 0} OIL overrides applied.`;
          clearPHCache(selectedDate);
          bumpVersion();
        }
      } catch { /* sync failed silently — save already succeeded */ }

      setMsg({ ok: !skipWarning, text: `Saved. ${changes.length} change${changes.length !== 1 ? "s" : ""} tracked.${syncMsg}${skipWarning}` });
    } catch {
      setMsg({ ok: false, text: "Failed to save — please retry." });
    } finally { setSaving(false); }
  };

  const handleOfficerChange = (entry: ScheduleEntry, newName: string, newId: string) => {
    setLocalEdits(prev => ({
      ...prev,
      [entry.officerId]: {
        ...(prev[entry.officerId] ?? {}),
        actualOfficerName: newName,
        actualOfficerId: newId,
        swapDone: newName !== entry.officerName,
      },
    }));
  };

  const handleRemarksChange = (officerId: string, val: string) => {
    setLocalEdits(prev => ({
      ...prev,
      [officerId]: { ...(prev[officerId] ?? {}), remarks: val },
    }));
  };

  const handleSave = async () => {
    if (!selectedDate) return;
    setSaving(true); setMsg(null);
    try {
      const merged: Record<string, PHOverride> = { ...overrides };
      for (const [oid, edits] of Object.entries(localEdits)) {
        const base = overrides[oid] ?? { actualOfficerName: "", actualOfficerId: "", swapDone: false, remarks: "" };
        merged[oid] = { ...base, ...edits } as PHOverride;
      }
      const res = await fetch(`/api/ph-roster/${selectedDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ overrides: merged }),
      });
      if (!res.ok) throw new Error("Save failed");
      setOverrides(merged);
      setLocalEdits({});
      setMsg({ ok: true, text: "Saved successfully." });
    } catch {
      setMsg({ ok: false, text: "Failed to save — please retry." });
    } finally { setSaving(false); }
  };


  const DUTY_COLORS: Record<string, string> = {
    DAY: "bg-blue-100 text-blue-700",
    PD:  "bg-amber-100 text-amber-700",
    ND:  "bg-purple-100 text-purple-700",
  };

  const [allocating, setAllocating] = useState(false);
  const [allocMsg, setAllocMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleAutoAllocate = async (targetYear: number) => {
    setAllocating(true); setAllocMsg(null);
    try {
      const res = await fetch("/api/ph-roster-ref/auto-allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetYear, ballotSeed: 42, dryRun: false }),
      });
      const data = res.ok ? await res.json() : null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed");
      setAllocMsg({ ok: true, text: `Generated ${data.generatedCount} PH dates for ${targetYear}.` });
      if (selectedDate) {
        const ph = ALL_PH_OPTIONS.find(p => p.date === selectedDate);
        const isOIL = !!(ph?.inLieu && ph?.actualDate && format(parseISO(ph.actualDate), "EEE") === "Sun");
        const fetchDate = isOIL ? ph!.actualDate! : selectedDate;
        loadSchedule(selectedDate, fetchDate);
      }
    } catch (e: any) {
      setAllocMsg({ ok: false, text: e.message ?? "Auto-allocate failed." });
    } finally { setAllocating(false); }
  };

  const allocYear = new Date().getFullYear() + 1;

  const phIdx = ALL_PH_OPTIONS.findIndex(ph => ph.date === selectedDate);

  return (
    <div
      className="flex flex-col gap-4"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Auto-allocate panel — admin/manager only */}
      {canEdit && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800 p-3 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-violet-900 dark:text-violet-200 flex items-center gap-1.5">
                <Wand2 className="h-4 w-4" />
                Auto-Allocate PH Scheduled Roster
              </p>
              <p className="text-xs text-violet-700 dark:text-violet-400 mt-0.5">
                Generate PH duty roster for <strong>{allocYear}</strong> based on the scheduled duty cycle.
                Racial constraints, no-consecutive and no-repeat-last-year rules are applied automatically.
                Review and adjust before publishing.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0 border border-violet-300 bg-violet-100 hover:bg-violet-200 text-violet-800 dark:bg-violet-900 dark:hover:bg-violet-800 dark:text-violet-100 dark:border-violet-700"
              disabled={allocating}
              onClick={() => handleAutoAllocate(allocYear)}
            >
              {allocating
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
              Generate {allocYear}
            </Button>
          </div>
          {allocMsg && (
            <div className={cn(
              "flex items-center gap-2 rounded px-2.5 py-1.5 text-xs",
              allocMsg.ok
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-red-50 border border-red-200 text-red-700"
            )}>
              {allocMsg.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
              {allocMsg.text}
            </div>
          )}
        </div>
      )}

      {/* PH selector + action buttons */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigatePH(-1)}
            disabled={phIdx <= 0}
            className="p-1.5 rounded-md border border-gray-200 hover:bg-muted disabled:opacity-30 transition-colors shrink-0"
            title="Previous PH"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <Select value={selectedDate} onValueChange={setSelectedDate}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Select Public Holiday…" />
            </SelectTrigger>
            <SelectContent>
              {ALL_PH_OPTIONS.map(ph => (
                <SelectItem key={ph.date + ph.name} value={ph.date}>
                  <span className="mr-2">{ph.emoji}</span>
                  {format(parseISO(ph.date), "d MMM yyyy (EEE)")} — {ph.name}
                  {ph.tentative ? " †" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => navigatePH(1)}
            disabled={phIdx < 0 || phIdx >= ALL_PH_OPTIONS.length - 1}
            className="p-1.5 rounded-md border border-gray-200 hover:bg-muted disabled:opacity-30 transition-colors shrink-0"
            title="Next PH"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {canEdit && (isRefMode ? isRefDirty : isDirty) && (
          <Button size="sm" onClick={isRefMode ? handleSaveRef : handleSave} disabled={saving} className="shrink-0">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {isRefMode ? `Save & Sync${refChangedCount > 0 ? ` (${refChangedCount} changed)` : ""}` : "Save Changes"}
          </Button>
        )}
      </div>

      {/* Monday OIL notice */}
      {isMonOIL && selectedPH?.actualDate && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm bg-amber-50 border border-amber-200 text-amber-800">
          <span className="text-base leading-none mt-0.5">🟡</span>
          <span>
            <strong>OIL Monday</strong> — PH fell on Sunday ({format(parseISO(selectedPH.actualDate), "d MMM yyyy")}).
            The roster below is auto-extracted from Sunday's target duties and synced to all views on save.
          </span>
        </div>
      )}

      {/* Status message */}
      {msg && (
        <div className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
          msg.ok
            ? "bg-green-50 border border-green-200 text-green-800"
            : "bg-red-50 border border-red-200 text-red-700"
        )}>
          {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      {!selectedDate && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Select a public holiday above to view the roster
        </div>
      )}

      {selectedDate && loadingSchedule && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {selectedDate && !loadingSchedule && !isRefMode && schedule.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No duty schedule found for this date. Ensure the Roster Cycle is configured.
        </div>
      )}

      {selectedDate && !loadingSchedule && isRefMode && (
        <PHRefRosterTable
          rows={refRows}
          canEdit={canEdit}
          allOfficers={allOfficers}
          getScheduled={getRefScheduled}
          getActual={getRefActual}
          isSwapped={isRefSwapped}
          onScheduledChange={(key, name) => setRefEdits(p => ({ ...p, [key]: { ...p[key], scheduledName: name } }))}
          onActualChange={(key, name) => setRefEdits(p => ({ ...p, [key]: { ...p[key], actualName: name } }))}
          DUTY_COLORS={DUTY_COLORS}
        />
      )}

      {selectedDate && !loadingSchedule && !isRefMode && schedule.length > 0 && (
        <PHRosterTable
          schedule={schedule}
          selectedDate={selectedDate}
          selectedPH={selectedPH}
          canEdit={canEdit}
          allOfficers={allOfficers}
          getEffectiveOfficerName={getEffectiveOfficerName}
          isSwapped={isSwapped}
          getRemarks={getRemarks}
          handleOfficerChange={handleOfficerChange}
          handleRemarksChange={handleRemarksChange}
          DUTY_COLORS={DUTY_COLORS}
        />
      )}
    </div>
  );
}

// ── PH Roster Table ───────────────────────────────────────────────────────────
function PHRosterTable({
  schedule, selectedDate, selectedPH, canEdit, allOfficers: allOfficersProp,
  getEffectiveOfficerName, isSwapped, getRemarks,
  handleOfficerChange, handleRemarksChange, DUTY_COLORS,
}: {
  schedule: ScheduleEntry[];
  selectedDate: string;
  selectedPH: PHEntry | null | undefined;
  canEdit: boolean;
  allOfficers: any[];
  getEffectiveOfficerName: (e: ScheduleEntry) => string;
  isSwapped: (e: ScheduleEntry) => boolean;
  getRemarks: (e: ScheduleEntry) => string;
  handleOfficerChange: (e: ScheduleEntry, name: string, id: string) => void;
  handleRemarksChange: (officerId: string, val: string) => void;
  DUTY_COLORS: Record<string, string>;
}) {
  // Reassignment picker offers only active officers; deactivated officers already
  // scheduled here still render fine via getEffectiveOfficerName/entry.officerName.
  const allOfficers = useMemo(() => allOfficersProp.filter((o: any) => o.active), [allOfficersProp]);
  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="text-sm" style={{ minWidth: 560 }}>
        <thead>
          <tr className="bg-muted border-b">
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">Sub-catchment</th>
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">Shift</th>
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">Scheduled</th>
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">Actual</th>
            <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">Any Changes</th>
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {[...schedule].sort((a, b) => unitSortKey(a.unitCode) - unitSortKey(b.unitCode)).map((entry) => {
            const bg = UNIT_COLORS[entry.unitCode] ?? "#F5F5F5";
            const swapped = isSwapped(entry);
            const hasChange = swapped || !!getRemarks(entry);
            return (
              <tr
                key={entry.officerId}
                className={cn("border-b last:border-0", hasChange && "ring-1 ring-inset ring-amber-300")}
                style={{ backgroundColor: bg, color: getContrastColor(bg) }}
              >
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">{entry.unitCode}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", DUTY_COLORS[entry.targetDuty] ?? "bg-gray-100 text-gray-600")}>
                    {entry.targetDuty}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm whitespace-nowrap">
                  {entry.officerName}
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <OfficerPicker
                      value={getEffectiveOfficerName(entry)}
                      originalName={entry.officerName}
                      officers={allOfficers}
                      onChange={(name, id) => handleOfficerChange(entry, name, id)}
                    />
                  ) : (
                    <span className={cn("text-sm whitespace-nowrap", swapped ? "font-semibold text-amber-700" : "")}>
                      {getEffectiveOfficerName(entry) || entry.officerName}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {swapped
                    ? <span className="inline-block text-[10px] font-bold text-red-600">Yes</span>
                    : <span className="inline-block text-[10px] font-medium text-green-600">No</span>}
                </td>
                <td className={cn("px-3 py-2", hasChange && "bg-amber-50/60")}>
                  {canEdit ? (
                    <Input
                      className="h-7 text-xs min-w-[140px]"
                      placeholder="Add remark…"
                      value={getRemarks(entry)}
                      onChange={e => handleRemarksChange(entry.officerId, e.target.value)}
                    />
                  ) : (
                    <span className="text-xs text-gray-600">{getRemarks(entry)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── PH Ref Roster Table (uses seeded Excel reference data) ────────────────────
function PHRefRosterTable({
  rows, canEdit, allOfficers,
  getScheduled, getActual, isSwapped,
  onScheduledChange, onActualChange, DUTY_COLORS,
}: {
  rows: PHRefRow[];
  canEdit: boolean;
  allOfficers: any[];
  getScheduled: (r: PHRefRow) => string;
  getActual: (r: PHRefRow) => string;
  isSwapped: (r: PHRefRow) => boolean;
  onScheduledChange: (key: string, name: string) => void;
  onActualChange: (key: string, name: string) => void;
  DUTY_COLORS: Record<string, string>;
}) {
  // Active officers = eligible to be newly assigned (deactivated officers can
  // still appear via rowScheduledOfficer below if already scheduled here).
  const activeOfficers = useMemo(() => allOfficers.filter((o: any) => o.active), [allOfficers]);
  // Available officers = active officers NOT scheduled on this PH date
  const scheduledNames = useMemo(
    () => new Set(rows.map(r => getScheduled(r))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, getScheduled]
  );
  const availableOfficers = useMemo(
    () => activeOfficers.filter((o: any) => !scheduledNames.has(o.name)),
    [activeOfficers, scheduledNames]
  );

  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="text-sm" style={{ minWidth: 560 }}>
        <thead>
          <tr className="bg-muted border-b">
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
              Sub-catchment
              <span className="block text-[9px] font-normal normal-case tracking-normal text-muted-foreground/70">follow pattern</span>
            </th>
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">Shift</th>
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Scheduled
              {canEdit && <span className="block text-[9px] font-normal normal-case tracking-normal text-muted-foreground/70">editable</span>}
            </th>
            <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">Actual</th>
            <th className="text-center px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">Changed?</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => unitSortKey(a.subCatchment) - unitSortKey(b.subCatchment)).map((row) => {
            const key = `${row.subCatchment}_${row.rowIndex}`;
            const swapped = isSwapped(row);
            const actual = getActual(row);
            const scheduled = getScheduled(row);
            const scheduledChanged = scheduled !== row.scheduledName;
            // Yellow highlight for changed rows, unit colour otherwise
            const unitBg = UNIT_COLORS[row.subCatchment] ?? "#F5F5F5";
            const rowBg = unitBg;
            // For this row's Actual picker: available officers + the effective scheduled officer
            const rowScheduledOfficer = allOfficers.find((o: any) => o.name === scheduled);
            const rowOfficers = rowScheduledOfficer
              ? [rowScheduledOfficer, ...availableOfficers.filter((o: any) => o.name !== scheduled)]
              : availableOfficers;
            return (
              <tr key={key} className="border-b last:border-0" style={{ backgroundColor: rowBg, color: getContrastColor(rowBg) }}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                    {row.subCatchment}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", DUTY_COLORS[row.shift] ?? "bg-gray-100 text-gray-600")}>
                    {row.shift}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <OfficerPicker
                      value={scheduled}
                      originalName={row.scheduledName}
                      officers={activeOfficers}
                      onChange={(name) => onScheduledChange(key, name)}
                    />
                  ) : (
                    <span className={cn(
                      "text-sm whitespace-nowrap",
                      scheduledChanged ? "font-semibold text-violet-700" : ""
                    )}>
                      {scheduled}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <OfficerPicker
                      value={actual}
                      originalName={scheduled}
                      officers={rowOfficers}
                      onChange={(name) => onActualChange(key, name)}
                    />
                  ) : (
                    <span className={cn("text-sm whitespace-nowrap", swapped ? "font-semibold text-amber-700" : "")}>
                      {actual || scheduled}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {swapped
                    ? <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-200 text-yellow-800">Yes</span>
                    : <span className="inline-block text-[10px] font-medium text-green-600">No</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Officer picker (inline name switcher) ─────────────────────────────────────
function OfficerPicker({
  value,
  originalName,
  officers,
  onChange,
}: {
  value: string;
  originalName: string;
  officers: any[];
  onChange: (name: string, id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() =>
    search.trim().length > 0
      ? officers.filter((o: any) =>
          (o.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (o.unitCode ?? "").toLowerCase().includes(search.toLowerCase())
        )
      : officers,
    [officers, search]
  );

  const isChanged = value !== originalName && value !== "";

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setEditing(true); setSearch(""); }}
          className={cn(
            "text-sm text-left underline decoration-dotted decoration-gray-400 underline-offset-2 hover:text-blue-700",
            isChanged ? "font-semibold text-amber-700" : "text-gray-600"
          )}
        >
          {value || originalName}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(true); setSearch(""); }}
          className="p-1 rounded hover:bg-gray-200 active:bg-gray-300"
          title="Change officer"
        >
          <Pencil className="h-3.5 w-3.5 text-gray-500" />
        </button>
        {isChanged && (
          <button
            type="button"
            onClick={() => onChange(originalName, "")}
            className="p-1 rounded hover:bg-gray-200 active:bg-gray-300"
            title="Revert to original"
          >
            <X className="h-3.5 w-3.5 text-gray-500" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative z-20">
      <Input
        autoFocus
        className="h-7 text-xs w-36"
        placeholder="Search officer…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        onBlur={() => setTimeout(() => setEditing(false), 150)}
      />
      <div className="absolute top-full left-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg z-30 w-56 max-h-48 overflow-y-auto">
        {filtered.slice(0, 20).map((o: any) => (
          <button
            key={o.id}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50"
            onMouseDown={() => {
              onChange(o.name, o.id);
              setEditing(false);
            }}
          >
            <span className="font-medium">{o.name}</span>
            {o.unitCode && <span className="text-gray-400 ml-1.5 text-[11px]">{o.unitCode}</span>}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
        )}
      </div>
    </div>
  );
}

// ── FAQ rich-text renderer ─────────────────────────────────────────────────────
// Inline markers stored in plain text:
//   "..."  (double-quotes)  → <strong> bold
//   _..._  (underscores)    → <em>    italic
function renderFaqText(raw: string): React.ReactNode {
  if (!raw) return null;
  const lines = raw.split("\n");
  return lines.map((line, li) => {
    const parts: React.ReactNode[] = [];
    // Match "quoted" (bold) or _underscored_ (italic)
    const re = /("([^"]+)")|(_([^_]+)_)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      if (m[1]) {
        parts.push(<strong key={`${li}-${m.index}`}>{m[2]}</strong>);
      } else {
        parts.push(<em key={`${li}-${m.index}`}>{m[4]}</em>);
      }
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return (
      <React.Fragment key={li}>
        {parts.length > 0 ? parts : line}
        {li < lines.length - 1 && "\n"}
      </React.Fragment>
    );
  });
}

// ── Tab 3: FAQ ────────────────────────────────────────────────────────────────
function PHFaq() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "manager" || user?.role === "ic";

  const [text, setText] = useState("");
  const [editText, setEditText] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; loginRequired?: boolean } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadFaq = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ph-faq");
      const data = res.ok ? await res.json() : {};
      setText(data.text ?? "");
    } catch {
      setText("Failed to load FAQ.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadFaq(); }, [loadFaq]);

  const handleEdit = () => { setEditText(text); setEditing(true); setMsg(null); };
  const handleCancel = () => { setEditing(false); setMsg(null); };

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("/api/ph-faq", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: editText }),
      });
      if (res.status === 401) {
        setMsg({ ok: false, text: "Session expired — your edits are still here.", loginRequired: true });
        return;
      }
      if (!res.ok) throw new Error();
      setText(editText);
      setEditing(false);
      setMsg({ ok: true, text: "FAQ saved." });
    } catch {
      setMsg({ ok: false, text: "Save failed. Please try again." });
    } finally { setSaving(false); }
  };

  // Wrap selected text in the textarea with a format marker
  const wrapSelection = (open: string, close: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.slice(s, e);
    const wrapped = `${open}${selected || "text"}${close}`;
    const next = value.slice(0, s) + wrapped + value.slice(e);
    setEditText(next);
    // Restore cursor after the inserted text
    requestAnimationFrame(() => {
      ta.focus();
      const newEnd = s + wrapped.length;
      ta.setSelectionRange(selected ? s : s + open.length, selected ? newEnd : newEnd - close.length);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {msg && (
        <div className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
          msg.ok
            ? "bg-green-50 border border-green-200 text-green-800"
            : "bg-red-50 border border-red-200 text-red-700"
        )}>
          {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span className="flex-1">{msg.text}</span>
          {msg.loginRequired && (
            <a href="/login" className="underline font-semibold shrink-0 hover:opacity-80">Log in again</a>
          )}
        </div>
      )}

      {editing ? (
        <>
          {/* Formatting toolbar */}
          <div className="flex items-center gap-1.5 border rounded-t-md px-2.5 py-1.5 bg-muted/40 border-b-0">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Format:</span>
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); wrapSelection('"', '"'); }}
              className="px-2 py-0.5 text-sm font-bold border rounded hover:bg-background transition-colors"
              title='Bold — wraps selection with "text"'
            >
              B
            </button>
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); wrapSelection('_', '_'); }}
              className="px-2 py-0.5 text-sm italic border rounded hover:bg-background transition-colors"
              title="Italic — wraps selection with _text_"
            >
              I
            </button>
            <span className="text-[9px] text-muted-foreground ml-1">
              Select text then click B or I &nbsp;·&nbsp;
              <span className="font-mono">"..."</span> = bold &nbsp;
              <span className="font-mono italic">_..._</span> = italic
            </span>
          </div>

          <Textarea
            ref={textareaRef}
            className="min-h-[400px] text-sm font-mono leading-relaxed rounded-t-none border-t-0"
            value={editText}
            onChange={e => setEditText(e.target.value)}
          />

          {/* Unsaved-changes notice + action row */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2">
            <p className="text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Changes are not saved until you press <strong>Save FAQ</strong>.
            </p>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save FAQ
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          {canEdit && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit FAQ
              </Button>
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground bg-muted/40 rounded-lg p-5 border">
            {text ? renderFaqText(text) : <span className="text-muted-foreground">No FAQ content yet.</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab 3: PH Counter ─────────────────────────────────────────────────────────
interface PHDetailEntry { date: string; phName: string; }

function PHCounter() {
  const { user } = useAuth();
  const canDownload = user?.role === "admin" || user?.role === "manager" || user?.role === "ic";
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const [detail, setDetail] = useState<Record<string, Record<string, PHDetailEntry[]>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<{ name: string; year: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/ph-roster-ref/counter")
      .then(r => r.ok ? r.json() : Promise.reject("Failed"))
      .then(d => { setCounts(d.counts ?? {}); setDetail(d.detail ?? {}); setError(null); })
      .catch(() => setError("Failed to load PH counter data."))
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = () => {
    const officers = Object.keys(counts).sort();
    const years = [...new Set(Object.values(counts).flatMap(y => Object.keys(y)))].sort();
    const dateStr = format(new Date(), "d MMM yyyy");

    const rows: string[] = [];

    // Title
    rows.push(`PH Duties Report`);
    rows.push(`Generated: ${dateStr}`);
    rows.push(``);

    // --- Summary ---
    rows.push(`SUMMARY`);
    rows.push([`Officer`, ...years.map(y => `${y} Count`), `Total`].join(`,`));
    for (const name of officers) {
      const yearCounts = years.map(y => String(counts[name]?.[y] ?? 0));
      const total = years.reduce((s, y) => s + (counts[name]?.[y] ?? 0), 0);
      rows.push([`"${name}"`, ...yearCounts, String(total)].join(`,`));
    }
    rows.push(``);

    // --- Detail ---
    rows.push(`DETAIL`);
    rows.push([`Officer`, `Year`, `Date`, `Holiday`].join(`,`));
    for (const name of officers) {
      for (const year of years) {
        const entries = (detail[name]?.[year] ?? [])
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date));
        for (const entry of entries) {
          rows.push([
            `"${name}"`,
            year,
            format(parseISO(entry.date), `d MMM yyyy`),
            `"${entry.phName}"`,
          ].join(`,`));
        }
      }
    }

    const csv = rows.join(`\n`);
    const blob = new Blob([csv], { type: `text/csv;charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement(`a`);
    a.href = url;
    a.download = `PH-Duties-${dateStr.replace(/ /g, `-`)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (error) return <div className="text-center py-8 text-red-600 text-sm">{error}</div>;
  if (Object.keys(counts).length === 0) return (
    <div className="text-center py-16 text-muted-foreground text-sm">
      No PH roster data yet. Generate the PH roster first.
    </div>
  );

  const officers = Object.keys(counts).sort();
  const years = [...new Set(Object.values(counts).flatMap(y => Object.keys(y)))].sort();

  const drillList: PHDetailEntry[] = drillDown
    ? (detail[drillDown.name]?.[drillDown.year] ?? [])
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Scheduled (Target) PH duties per officer per year. OIL/in-lieu dates are excluded.
          Tap any count to see which PHs are assigned.
        </p>
        {canDownload && (
          <Button variant="outline" size="sm" onClick={handleDownload} className="shrink-0">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Download CSV
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                Officer
              </th>
              {years.map(y => (
                <th key={y} className="text-center px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  {y}
                </th>
              ))}
              <th className="text-center px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {officers.map((name, i) => {
              const total = Object.values(counts[name]).reduce((a, b) => a + b, 0);
              return (
                <tr key={name} className={cn("border-b last:border-0", i % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-muted/20")}>
                  <td className="px-4 py-2 font-medium text-foreground">{name}</td>
                  {years.map(y => (
                    <td key={y} className="text-center px-4 py-2 tabular-nums">
                      {counts[name][y] != null
                        ? (
                          <button
                            type="button"
                            onClick={() => setDrillDown({ name, year: y })}
                            className="font-semibold px-2 py-0.5 rounded hover:bg-blue-100 active:bg-blue-200 transition-colors tabular-nums cursor-pointer"
                            title={`${name} — ${y} PHs`}
                          >
                            {counts[name][y]}
                          </button>
                        )
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  ))}
                  <td className="text-center px-4 py-2 font-bold tabular-nums">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drill-down modal */}
      {drillDown && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDrillDown(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-5 mx-4 w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{drillDown.year} PH Duties</p>
                <h3 className="font-bold text-base text-foreground leading-snug">{drillDown.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDrillDown(null)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {drillList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No details available.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
                {drillList.map((entry, i) => (
                  <li key={entry.date} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className="text-xs font-mono text-muted-foreground w-4 shrink-0 mt-0.5 tabular-nums">{i + 1}.</span>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-medium text-foreground leading-snug">{entry.phName}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {format(parseISO(entry.date), "d MMM yyyy (EEE)")}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {drillList.length} PH assigned in {drillDown.year}
              </p>
              <button
                type="button"
                onClick={() => setDrillDown(null)}
                className="text-xs px-3 py-1 rounded-md border border-gray-200 hover:bg-muted transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PHHoliday() {
  const [tab, setTab] = useState("list");
  const [jumpDate, setJumpDate] = useState<string | undefined>(undefined);

  const handleSelectFromList = (date: string) => {
    setJumpDate(date);
    setTab("roster");
  };

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Public Holiday</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Singapore public holiday calendar, PH duty roster, and guidelines.
            </p>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
            <TabsList className="w-fit">
              <TabsTrigger value="list">List of PH</TabsTrigger>
              <TabsTrigger value="roster">PH Roster</TabsTrigger>
              <TabsTrigger value="counter">PH Counter</TabsTrigger>
              <TabsTrigger value="faq">FAQ</TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="mt-0">
              <PHList onSelectDate={handleSelectFromList} />
            </TabsContent>
            <TabsContent value="roster" className="mt-0">
              <PHRoster jumpDate={jumpDate} />
            </TabsContent>
            <TabsContent value="counter" className="mt-0">
              <PHCounter />
            </TabsContent>
            <TabsContent value="faq" className="mt-0">
              <PHFaq />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
