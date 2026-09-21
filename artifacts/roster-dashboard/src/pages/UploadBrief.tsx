import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, addDays, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, subMonths, addMonths } from "date-fns";
// @e965/xlsx — a community republish of SheetJS to npm (kept current with
// upstream security patches). Same API as "xlsx"; swapped because SheetJS
// stopped publishing patched releases to the npm registry after 0.18.5, so
// "xlsx" itself is permanently stuck vulnerable to Dependabot's tracked CVEs
// (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9). See
// .scratch/dependabot-fixes/issues/01-qs-transitive-dos-and-xlsx-unpatched.md.
import * as XLSX from "@e965/xlsx";
import {
  Upload, AlertTriangle, CheckCircle, Loader2, RotateCcw,
  ChevronLeft, ChevronRight, CheckCircle2, Search, X, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getContrastColor } from "@/lib/contrast";
import { useToast } from "@/hooks/use-toast";
import { useGetRosterOfficers, getGetRosterOfficersQueryKey } from "@workspace/api-client-react";
import { CATCHMENT_ORDER, CATCHMENT_CODE, CATCHMENT_BG } from "@/components/RosterListView";
import { useAuth } from "@/context/AuthContext";
import { useRosterVersion } from "@/context/RosterVersionContext";
import { SG_PH_SET, SG_PH_META_MAP } from "@/lib/usePHActuals";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Assignment {
  unitCode: string;
  vehicle?: string;
  officers: string[];
  duty: string;
}

interface LeaveEntry {
  name: string;
  targetDuty?: string;
  leaveType: string;
  coveringOfficerName?: string;
}

interface ParsedBrief {
  date: string;
  assignments: Assignment[];
  off: string[];
  leave: LeaveEntry[];
}

interface OvRow {
  id: string; name: string; unitCode: string; catchment: string; crewPosition: number;
  scheduledDuty: string;
  duty: string;
  cover: string;
  vehicle: string;
  ot: string;
  comment?: string;
  dirty: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_DUTIES = [
  "ND","DAY","PD","OFF","REST",
  "AMC","AMMA","AMOVL","AMTO","BL","C","CCL","CSL","FCL","HL",
  "MA","MC","ML","NS","OIL","OVL","PCL","PMC","PMMA","PMOVL","PMTO",
  "PPTW","SL","SLWOMC","SPL","TO","UL","VL",
];

const LEAVE_CODE_SET = new Set([
  "AMC","AMMA","AMOVL","AMTO","BL","C","CCL","CSL","FCL","HL",
  "MA","ML","NS","OIL","OVL","PCL","PMC","PMMA","PMOVL","PMTO",
  "PPTW","SL","SLWOMC","SPL","TO","UL","VL",
]);

// Was \d{1,2} (max 2 digits) — a 3-digit unit code was misclassified as an
// officer name instead of a cross-post unit in the OT/CVG column.
// .scratch/replit-resync-2026-09-21/issues/20.
const UNIT_CODE_RE = /^[A-Z]{2}\d{1,3}$/;


const OV_ACTUAL_COLORS: Record<string, string> = {
  PD:   "bg-[#FDD9BB] dark:bg-orange-900/60 border-orange-300 dark:border-orange-700 text-orange-900 dark:text-orange-200",
  DAY:  "bg-[#D3E6F5] dark:bg-blue-900/60   border-blue-300   dark:border-blue-700   text-blue-900   dark:text-blue-200",
  ND:   "bg-[#FDFCCC] dark:bg-yellow-900/60 border-yellow-300 dark:border-yellow-700 text-yellow-900  dark:text-yellow-200",
  OFF:  "bg-[#A7FBC1] dark:bg-green-900/60  border-green-300  dark:border-green-700  text-green-900   dark:text-green-200",
  REST: "bg-[#F5C7F5] dark:bg-pink-900/60   border-pink-300   dark:border-pink-700   text-pink-900    dark:text-pink-200",
};

const DUTY_COLORS: Record<string, string> = {
  PD:   "bg-[#FDD9BB] text-orange-900",
  DAY:  "bg-[#D3E6F5] text-blue-900",
  ND:   "bg-[#FDFCCC] text-yellow-900",
  OFF:  "bg-[#A7FBC1] text-green-900",
  REST: "bg-[#F5C7F5] text-pink-900",
};

// ── Excel parser ──────────────────────────────────────────────────────────────

function parseExcelBrief(file: File): Promise<ParsedBrief> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
          defval: "", raw: false,
        });

        const date = "";
        const assignments: Assignment[] = [];
        const off: string[] = [];
        const leave: LeaveEntry[] = [];

        const EXCEL_LEAVE = new Set([
          "VL","SL","MC","CCL","FCL","PL","SPL","UL","ML","BL","C","CSL",
          "SLWOMC","AMC","AMMA","AMTO","PMTO","C/PMTO","NS","PPTW","TO","OVL","HL",
          // Previously missing — silently dropped instead of recorded as
          // leave on import. .scratch/replit-resync-2026-09-21/issues/20.
          "MA","OIL","PCL","PMC","PMMA","PMOVL",
        ]);
        const SHIFT_DUTIES = new Set(["ND","DAY","PD","OFF","REST"]);

        for (const row of rows) {
          const rawKeys = Object.keys(row);
          const vals    = rawKeys.map(k => String(row[k] ?? "").trim());
          const keys    = rawKeys.map(k => k.toLowerCase().trim());

          const nameIdx     = keys.findIndex(k => /name|officer/i.test(k));
          const targetIdx   = keys.findIndex(k => /target/i.test(k));
          const actualIdx   = keys.findIndex(k => /actual/i.test(k));
          const coveringIdx = keys.findIndex(k => /cover|cvg/i.test(k));
          const otIdx       = coveringIdx >= 0 ? coveringIdx : keys.findIndex(k => /\bot\b/i.test(k));
          const vehicleIdx  = keys.findIndex(k => /vehicle|veh|plate/i.test(k));

          if (nameIdx < 0 || actualIdx < 0) continue;

          const name     = vals[nameIdx]?.trim();
          const actual   = vals[actualIdx]?.trim().toUpperCase();
          const target   = targetIdx >= 0 ? vals[targetIdx]?.trim().toUpperCase() : "";
          const coverRaw = otIdx >= 0 ? vals[otIdx]?.trim() : "";
          const covering = coverRaw && isNaN(Number(coverRaw)) ? coverRaw : undefined;
          const vehicle  = vehicleIdx >= 0 ? vals[vehicleIdx]?.trim() : "";

          if (!name || !actual) continue;

          if (actual === "OFF") {
            off.push(name);
          } else if (EXCEL_LEAVE.has(actual) && !SHIFT_DUTIES.has(actual)) {
            const entry: LeaveEntry = { name, leaveType: actual };
            if (target) entry.targetDuty = target;
            if (covering) entry.coveringOfficerName = covering;
            leave.push(entry);
          } else if (SHIFT_DUTIES.has(actual)) {
            assignments.push({
              unitCode: "IMPORT",
              vehicle: vehicle || undefined,
              officers: [name],
              duty: actual,
            });
          }
        }

        resolve({ date, assignments, off, leave });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsArrayBuffer(file);
  });
}

// ── DutyBadge ─────────────────────────────────────────────────────────────────

function DutyBadge({ duty }: { duty: string }) {
  const cls = DUTY_COLORS[duty] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", cls)}>{duty}</span>
  );
}

// ── PreviewTable ──────────────────────────────────────────────────────────────

function PreviewTable({ brief }: { brief: ParsedBrief }) {
  const { assignments, off, leave } = brief;
  return (
    <div className="space-y-4 text-sm">
      {assignments.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Assignments ({assignments.length} units)
          </p>
          <div className="rounded-md border divide-y text-xs">
            {assignments.map((a, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                <span className="font-bold w-10 shrink-0">{a.unitCode}</span>
                {a.vehicle && <span className="font-mono text-[10px] text-orange-600 shrink-0">{a.vehicle}</span>}
                <span className="flex-1 text-gray-700">{a.officers.join(" & ")}</span>
                <DutyBadge duty={a.duty} />
              </div>
            ))}
          </div>
        </div>
      )}

      {off.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            OFF ({off.length})
          </p>
          <div className="rounded-md border px-3 py-2 text-xs text-gray-700">
            {off.join(", ")}
          </div>
        </div>
      )}

      {leave.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Leave / Absence ({leave.length})
          </p>
          <div className="rounded-md border divide-y text-xs">
            {leave.map((l, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                <span className="flex-1">{l.name}</span>
                {l.targetDuty && <DutyBadge duty={l.targetDuty} />}
                <span className="text-red-600 font-bold text-[10px]">[{l.leaveType}]</span>
                {l.coveringOfficerName && (
                  <span className="text-green-700 text-[10px] font-medium">cvg: {l.coveringOfficerName}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {assignments.length === 0 && off.length === 0 && leave.length === 0 && (
        <p className="text-muted-foreground text-xs text-center py-4">Nothing parsed yet.</p>
      )}
    </div>
  );
}

// ── Duty Picker ───────────────────────────────────────────────────────────────

const CORE_DUTIES_SET = new Set(["ND", "DAY", "PD", "OFF", "REST"]);

function DutyPicker({
  value, onChange, duties, colorMap, overrideClass,
}: {
  value: string;
  onChange: (v: string) => void;
  duties: string[];
  colorMap: Record<string, string>;
  overrideClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? duties.filter(d => d.toLowerCase().includes(q)) : null;
  }, [duties, search]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 40); }, [open]);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const triggerClass = overrideClass ?? (colorMap[value] ?? "bg-background border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300");
  const coreDuties = duties.filter(d => CORE_DUTIES_SET.has(d));
  const leaveDuties = duties.filter(d => !CORE_DUTIES_SET.has(d));

  return (
    <div ref={ref} className="relative w-[58px] shrink-0">
      <button type="button" onClick={() => setOpen(v => !v)}
        className={cn("w-full h-7 border rounded text-[11px] font-bold text-center transition-colors", triggerClass)}>
        {value || "—"}
      </button>
      {open && (
        <div className="absolute z-[70] left-0 top-8 w-44 bg-popover border rounded-md shadow-xl">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input ref={inputRef} type="text" value={search}
              onChange={e => {
                const v = e.target.value;
                setSearch(v);
                const m = duties.find(d => d.toLowerCase() === v.toLowerCase());
                if (m) { onChange(m); setOpen(false); setSearch(""); }
              }}
              placeholder="Search duty…"
              className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="max-h-52 overflow-y-auto">
            <button type="button"
              className="w-full text-left px-2.5 py-1 text-[11px] hover:bg-muted transition-colors text-muted-foreground italic"
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}>
              — clear —
            </button>
            {filtered ? (
              filtered.length === 0
                ? <div className="px-3 py-3 text-[11px] text-muted-foreground text-center">No results</div>
                : filtered.map(d => (
                  <button key={d} type="button"
                    className={cn("w-full text-left px-2.5 py-1.5 hover:bg-muted transition-colors", value === d && "bg-primary/10")}
                    onClick={() => { onChange(d); setOpen(false); setSearch(""); }}>
                    {CORE_DUTIES_SET.has(d)
                      ? <span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-bold border", colorMap[d] ?? "bg-gray-100 border-gray-200 text-gray-700")}>{d}</span>
                      : <span className="text-[11px] text-orange-700 dark:text-orange-400">{d}</span>
                    }
                  </button>
                ))
            ) : (
              <>
                <div className="px-2.5 pt-1 pb-0.5 text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Duties</div>
                {coreDuties.map(d => (
                  <button key={d} type="button"
                    className={cn("w-full text-left px-2.5 py-1.5 hover:bg-muted transition-colors", value === d && "bg-primary/10")}
                    onClick={() => { onChange(d); setOpen(false); setSearch(""); }}>
                    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-bold border", colorMap[d] ?? "bg-gray-100 border-gray-200 text-gray-700")}>{d}</span>
                  </button>
                ))}
                <div className="px-2.5 pt-1 pb-0.5 text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Leave</div>
                {leaveDuties.map(d => (
                  <button key={d} type="button"
                    className={cn("w-full text-left px-2.5 py-1 hover:bg-muted transition-colors", value === d && "bg-primary/10 font-bold")}
                    onClick={() => { onChange(d); setOpen(false); setSearch(""); }}>
                    <span className="text-[11px] text-orange-700 dark:text-orange-400">{d}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Covering Picker ───────────────────────────────────────────────────────────

function CoveringPicker({
  value, onChange, officers,
}: { value: string; onChange: (v: string) => void; officers: any[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const unitCodes = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const o of officers) {
      if (!seen.has(o.unitCode)) { seen.add(o.unitCode); out.push(o.unitCode); }
    }
    return out.sort();
  }, [officers]);

  const options = useMemo(() => {
    const q = search.toLowerCase();
    const units = unitCodes
      .filter(u => u.toLowerCase().includes(q))
      .map(u => ({ kind: "unit" as const, label: u, val: u }));
    const seen = new Set<string>();
    const names = officers
      .filter(o => { if (seen.has(o.name)) return false; seen.add(o.name); return o.name.toLowerCase().includes(q); })
      .map(o => ({ kind: "name" as const, label: o.name, val: o.name }));
    return [...units, ...names];
  }, [officers, unitCodes, search]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 40); }, [open]);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative w-[62px] shrink-0">
      <div className={cn(
        "flex items-center h-7 border rounded overflow-hidden text-[10px] bg-background",
        value ? "border-gray-400" : "border-gray-200"
      )}>
        <button type="button" onClick={() => setOpen(v => !v)}
          className="flex-1 min-w-0 text-left px-1 h-full truncate text-gray-800 dark:text-gray-200">
          {value || <span className="text-gray-400 dark:text-gray-500">Name/unit</span>}
        </button>
        {value
          ? <button type="button" onClick={() => { onChange(""); setSearch(""); }}
              className="px-0.5 text-gray-400 hover:text-red-500 shrink-0 leading-none font-bold text-[13px]">×</button>
          : <button type="button" onClick={() => setOpen(v => !v)}
              className="px-0.5 text-gray-300 shrink-0 leading-none text-[9px]">▾</button>
        }
      </div>
      {open && (
        <div className="absolute z-[60] left-0 top-8 w-52 bg-popover border rounded-md shadow-xl">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name or unit…"
              className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {options.length === 0
              ? <div className="px-3 py-3 text-[11px] text-muted-foreground text-center">No results</div>
              : options.map(item => {
                const prefix = item.kind === "unit" ? item.val.replace(/[0-9]/g, "") : "";
                const unitBg = CVR_CATCHMENT_BG[prefix];
                return (
                <button key={`${item.kind}-${item.val}`} type="button"
                  style={unitBg ? { backgroundColor: unitBg, color: getContrastColor(unitBg) } : undefined}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 text-[11px] hover:opacity-80 transition-colors",
                    !unitBg && (item.kind === "unit"
                      ? "font-bold text-gray-800"
                      : "text-gray-800 dark:text-gray-200"),
                    item.kind === "unit" && "font-bold",
                    value === item.val && "bg-primary/10 text-primary"
                  )}
                  onClick={() => { onChange(item.val); setOpen(false); setSearch(""); }}>
                  {item.kind === "unit" ? `[${item.label}]` : item.label}
                </button>
                );
              })
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ── Week-grid helpers ─────────────────────────────────────────────────────────

function getMondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), diff);
}

type CellData = {
  scheduledDuty: string; duty: string; cover: string; vehicle: string; ot: string;
  /** name of the officer THIS officer is covering for (reverse of `cover`), when set via a leave application */
  coveringFor?: string;
  /** catchment/unit code of the officer THIS officer is covering for — shown in the CVR column, matching the unit-code convention used elsewhere in that column */
  coveringForUnit?: string;
  /** free-text note pinned to this cell; displayed as a purple corner triangle */
  comment?: string;
};

// ── Subcatchment prefix → catchment name reverse map ──────────────────────────
const PREFIX_TO_CATCHMENT: Record<string, string> = {
  BU: "Bukit Timah & Urban",
  PJ: "Jurong & Pandan",
  WK: "Kranji & Woodlands",
  CP: "Changi & Punggol",
  KG: "Kallang & Geylang",
};

// ── Catchment HEX colours for CVR unit-code options ───────────────────────────
const CVR_CATCHMENT_BG: Record<string, string> = {
  BU: "#FFFFCC",
  PJ: "#EDEDED",
  WK: "#FCE4D6",
  CP: "#E2EFDA",
  KG: "#DDEBF7",
};

// ── Override Editor ───────────────────────────────────────────────────────────

export function OverrideEditor() {
  const { data: rawOfficers } = useGetRosterOfficers();
  const officers = useMemo(
    () => ((rawOfficers ?? []) as any[]).sort((a: any, b: any) => {
      const ci = CATCHMENT_ORDER.indexOf(a.catchment) - CATCHMENT_ORDER.indexOf(b.catchment);
      if (ci !== 0) return ci;
      if (a.unitCode !== b.unitCode) return a.unitCode.localeCompare(b.unitCode);
      return (a.crewPosition ?? 0) - (b.crewPosition ?? 0);
    }),
    [rawOfficers]
  );

  const { user } = useAuth();
  const { bumpVersion, version } = useRosterVersion();
  const { toast } = useToast();
  const isReadOnly = !user || user.role === "crew";

  // Month navigation
  const [monthStart, setMonthStart] = useState<Date>(() => startOfMonth(new Date()));
  const dates = useMemo(() => eachDayOfInterval({ start: monthStart, end: endOfMonth(monthStart) }), [monthStart]);
  const dateStrs = useMemo(() => dates.map(d => format(d, "yyyy-MM-dd")), [dates]);

  const [scheduleByDate, setScheduleByDate] = useState<Record<string, Record<string, CellData>>>({});

  const officerById = useMemo(() => new Map(officers.map((o: any) => [o.id, o])), [officers]);

  // Daily strength counts — actual/override duty (falling back to
  // scheduled/target when no override exists), excluding TBC placeholder
  // units, matching the convention already established in the backend
  // (rosterPlan.ts, phRoster.ts). Previously counted scheduled duty only and
  // included TBC units, inflating the displayed strength.
  // .scratch/replit-resync-2026-09-21/issues/20.
  const strengthByDate = useMemo(() => {
    const result: Record<string, { day: number; pd: number; nd: number }> = {};
    for (const ds of dateStrs) {
      const entries = Object.entries(scheduleByDate[ds] ?? {});
      let day = 0, pd = 0, nd = 0;
      for (const [officerId, cell] of entries) {
        const unitCode = officerById.get(officerId)?.unitCode;
        if (!unitCode || unitCode.toUpperCase() === "TBC") continue;
        const d = cell.duty || cell.scheduledDuty;
        if (d === "DAY") day++;
        else if (d === "PD") pd++;
        else if (d === "ND") nd++;
      }
      result[ds] = { day, pd, nd };
    }
    return result;
  }, [scheduleByDate, dateStrs, officerById]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pendingRef = useRef<Record<string, OvRow[]>>({});
  const [pendingDates, setPendingDates] = useState<string[]>([]);

  // Bottom-sheet edit modal state
  const [editModal, setEditModal] = useState<{ officerId: string; dateStr: string } | null>(null);

  // Grid scroll container ref (for "Today" jump)
  const scrollRef = useRef<HTMLDivElement>(null);

  // Month-picker popover
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  // Inline quick-pick dropdown
  type QPField = "scheduledDuty" | "duty" | "cover";
  const [quickPick, setQuickPick] = useState<{
    officerId: string; dateStr: string; field: QPField;
    top: number; anchorTop: number; left: number;
  } | null>(null);
  const [qpSearch, setQpSearch] = useState("");

  // Officer name edit picker
  const [namePicker, setNamePicker] = useState<{
    officerId: string; currentName: string;
    top: number; left: number;
  } | null>(null);
  const [namePickerValue, setNamePickerValue] = useState("");
  const [namePickerSaving, setNamePickerSaving] = useState(false);
  const queryClient = useQueryClient();

  const openNamePicker = (picker: { officerId: string; currentName: string; top: number; left: number }) => {
    setNamePicker(picker);
    setNamePickerValue(picker.currentName);
  };

  const saveOfficerName = async () => {
    if (!namePicker) return;
    const trimmed = namePickerValue.trim();
    if (!trimmed || trimmed === namePicker.currentName) { setNamePicker(null); return; }
    setNamePickerSaving(true);
    try {
      const res = await fetch(`/api/roster-plan/officers/${namePicker.officerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setNamePicker(null);
        await queryClient.invalidateQueries({ queryKey: getGetRosterOfficersQueryKey() });
        bumpVersion();
        toast({ title: "Officer renamed", description: trimmed });
      } else {
        toast({ title: "Rename failed", variant: "destructive" });
      }
    } finally {
      setNamePickerSaving(false);
    }
  };

  const loadWeek = useCallback(async (dStrs: string[], offs: any[]) => {
    if (!offs.length) return;
    setLoading(true); setMsg(null);
    try {
      const results = await Promise.all(dStrs.map(async ds => {
        const res = await fetch(`/api/roster-plan/schedule?date=${ds}`);
        const sched = res.ok ? await res.json() : { duties: [] };
        return { ds, duties: (sched.duties ?? []) as any[] };
      }));
      setScheduleByDate(prev => {
        const next = { ...prev };
        for (const { ds, duties } of results) {
          next[ds] = {};
          for (const o of offs) {
            const entry = duties.find((x: any) => x.officerId === o.id && x.date === ds);
            const base: CellData = {
              scheduledDuty: entry?.targetDuty ?? "",
              duty: entry?.duty ?? "",
              cover: entry?.crossPostedToUnit ?? entry?.coveredByOfficerName ?? entry?.swappedWithOfficerName ?? "",
              vehicle: entry?.vehicle ?? "",
              ot: entry?.overtimeHours ?? "",
              coveringFor: entry?.coveringForOfficerName ?? "",
              coveringForUnit: entry?.coveringForUnit ?? "",
              comment: entry?.comment ?? "",
            };
            const pendingRow = pendingRef.current[ds]?.find(p => p.id === o.id);
            next[ds][o.id] = pendingRow
              ? { scheduledDuty: base.scheduledDuty, duty: pendingRow.duty, cover: pendingRow.cover, vehicle: pendingRow.vehicle, ot: pendingRow.ot, coveringFor: base.coveringFor, coveringForUnit: base.coveringForUnit, comment: pendingRow.comment ?? base.comment }
              : base;
          }
        }
        return next;
      });
    } catch {
      setMsg({ ok: false, text: "Failed to load — please retry." });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!officers.length) return;
    loadWeek(dateStrs, officers);
  }, [monthStart, officers.length, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCell = (officerId: string, dateStr: string, field: keyof CellData, value: string) => {
    const o = (officers as any[]).find((x: any) => x.id === officerId);
    if (!o) return;
    const base = scheduleByDate[dateStr]?.[officerId] ?? { scheduledDuty: "", duty: "", cover: "", vehicle: "" };
    const existing = pendingRef.current[dateStr] ?? [];
    const idx = existing.findIndex(r => r.id === officerId);
    const prev: OvRow = idx >= 0 ? existing[idx] : {
      id: o.id, name: o.name, unitCode: o.unitCode, catchment: o.catchment,
      crewPosition: o.crewPosition ?? 0,
      scheduledDuty: base.scheduledDuty, duty: base.duty, cover: base.cover, vehicle: base.vehicle, ot: base.ot,
      comment: base.comment ?? "",
      dirty: false,
    };
    const updated: OvRow = { ...prev, [field]: value, dirty: true };
    pendingRef.current[dateStr] = idx >= 0
      ? existing.map((r, i) => i === idx ? updated : r)
      : [...existing, updated];
    setPendingDates(Object.keys(pendingRef.current));
    setScheduleByDate(p => ({
      ...p,
      [dateStr]: { ...(p[dateStr] ?? {}), [officerId]: { ...(p[dateStr]?.[officerId] ?? base), [field]: value } },
    }));
  };

  const clearCell = (officerId: string, dateStr: string) => {
    pendingRef.current[dateStr] = (pendingRef.current[dateStr] ?? []).filter(r => r.id !== officerId);
    if (!pendingRef.current[dateStr].length) delete pendingRef.current[dateStr];
    setPendingDates(Object.keys(pendingRef.current));
    loadWeek(dateStrs, officers);
  };

  const save = async () => {
    const allDates = Object.keys(pendingRef.current);
    if (!allDates.length) return;
    setSaving(true); setMsg(null);
    try {
      // One atomic batch request across every pending date, not a per-date
      // loop — previously a failure partway through the loop left earlier
      // dates already committed server-side with pendingRef never cleared,
      // showing them as still-unsaved even though they'd gone through.
      // .scratch/replit-resync-2026-09-21/issues/20.
      const dates = allDates.map((d) => ({
        date: d,
        overrides: pendingRef.current[d].map(r => ({
          officerId: r.id, duty: r.duty,
          coveredByOfficerName: (r.cover && !UNIT_CODE_RE.test(r.cover)) ? r.cover : undefined,
          crossPostedToUnit:    (r.cover &&  UNIT_CODE_RE.test(r.cover)) ? r.cover : undefined,
          vehicle: r.vehicle || undefined,
          overtimeHours: r.ot || undefined,
          targetDuty: r.scheduledDuty || undefined,
          comment: r.comment || undefined,
        })),
      }));
      const totalSaved = dates.reduce((n, d) => n + d.overrides.length, 0);
      const res = await fetch("/api/roster-plan/overrides/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ dates }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) { window.location.href = "/login"; return; }
        throw new Error((body as any).error || "Save failed — no changes were saved.");
      }
      pendingRef.current = {};
      setPendingDates([]);
      bumpVersion();
      setMsg({
        ok: true,
        text: allDates.length > 1
          ? `Saved ${totalSaved} change${totalSaved !== 1 ? "s" : ""} across ${allDates.length} dates.`
          : `Saved ${totalSaved} for ${format(parseISO(allDates[0]), "d MMM yyyy")}.`,
      });
      await loadWeek(dateStrs, officers);
    } catch (e: any) {
      // Batched as one request, so a failure here means nothing was saved —
      // pendingRef is deliberately left untouched, matching reality.
      setMsg({ ok: false, text: e.message });
    } finally { setSaving(false); }
  };

  const totalPendingCount = Object.values(pendingRef.current).reduce((s, r) => s + r.length, 0);

  const jumpToToday = useCallback(() => {
    const today = new Date();
    setMonthStart(startOfMonth(today));
    setTimeout(() => {
      if (!scrollRef.current) return;
      const todayIdx = today.getDate() - 1; // 0-indexed
      const FROZEN = 130; const GRP = 220;
      scrollRef.current.scrollLeft = Math.max(0, FROZEN + GRP * todayIdx - 60);
    }, 200);
  }, []);

  const openQuickPick = (
    e: React.MouseEvent,
    officerId: string,
    dateStr: string,
    field: QPField
  ) => {
    if (isReadOnly) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setQpSearch("");
    setQuickPick({ officerId, dateStr, field, top: rect.bottom + 4, anchorTop: rect.top, left: rect.left });
  };

  const grouped = useMemo(() => {
    const byUnit: Record<string, any[]> = {};
    for (const o of officers as any[]) {
      const k = `${o.catchment}|||${o.unitCode}`;
      if (!byUnit[k]) byUnit[k] = [];
      byUnit[k].push(o);
    }
    return CATCHMENT_ORDER.map(catchment => {
      const code = CATCHMENT_CODE[catchment] ?? "";
      const units = Object.entries(byUnit)
        .filter(([k]) => k.startsWith(catchment + "|||"))
        .map(([k, list]) => ({ unitCode: k.split("|||")[1], list }))
        .sort((a, b) => a.unitCode.localeCompare(b.unitCode));
      return { catchment, code, units };
    }).filter(g => g.units.length > 0);
  }, [officers]);

  const monthLabel = format(monthStart, "MMMM yyyy");
  const UNIT_W   = 40;
  // Was 90, showing only the first name — ambiguous when two officers share
  // one. Widened to fit the full name. .scratch/replit-resync-2026-09-21/issues/20.
  const NAME_W   = 140;
  const FROZEN_W = UNIT_W + NAME_W;
  const TGT_W    = 64;
  const ACT_W    = 64;
  const CVR_W    = 76;
  const VEH_W    = 60;
  const DATE_GROUP_W = TGT_W + ACT_W + CVR_W + VEH_W;
  const totalMinW = FROZEN_W + DATE_GROUP_W * dates.length;
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const editModalOfficer = editModal ? (officers as any[]).find((o: any) => o.id === editModal.officerId) : null;
  const editModalCell = editModal
    ? (scheduleByDate[editModal.dateStr]?.[editModal.officerId] ?? { scheduledDuty: "", duty: "", cover: "", vehicle: "", ot: "" })
    : null;
  const editModalPending = editModal
    ? pendingRef.current[editModal.dateStr]?.find(r => r.id === editModal.officerId)
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Fixed top header ── */}
      <div className="shrink-0 border-b bg-card px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1">
          <button onClick={() => setMonthStart(d => startOfMonth(subMonths(d, 1)))}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground shrink-0">
            <ChevronLeft className="h-4 w-4" />
          </button>
          {/* Month label — tap to open month picker */}
          <div className="flex-1 flex justify-center">
            <div className="relative">
              <button
                className="text-sm font-semibold px-2 py-0.5 rounded-md hover:bg-muted border border-transparent hover:border-gray-200 transition-colors"
                onClick={() => setShowMonthPicker(v => !v)}>
                {monthLabel}
              </button>
              {showMonthPicker && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-popover border rounded-xl shadow-2xl z-50 p-2">
                  <input
                    type="month"
                    defaultValue={format(monthStart, "yyyy-MM")}
                    autoFocus
                    className="text-sm border rounded-md px-2 py-1.5 bg-background text-foreground outline-none focus:ring-2 focus:ring-blue-500"
                    onChange={e => {
                      if (e.target.value) {
                        setMonthStart(startOfMonth(parseISO(e.target.value + "-01")));
                        setShowMonthPicker(false);
                      }
                    }}
                    onBlur={() => setTimeout(() => setShowMonthPicker(false), 120)}
                  />
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setMonthStart(d => startOfMonth(addMonths(d, 1)))}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground shrink-0">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={jumpToToday}
            className="h-8 px-2.5 text-xs font-bold rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors shrink-0">
            Today
          </button>
          {!isReadOnly && (
            <Button type="button" size="sm" className="h-8 text-xs shrink-0 px-3" onClick={save}
              disabled={saving || totalPendingCount === 0}>
              {saving
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
                : totalPendingCount > 0
                  ? `Save ${totalPendingCount} (${pendingDates.length}d)`
                  : "No Changes"}
            </Button>
          )}
        </div>
        {isReadOnly && (
          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">View only</span>
        )}
        {msg && (
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs",
            msg.ok
              ? "bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-300"
              : "bg-destructive/10 border border-destructive/20 text-destructive"
          )}>
            {msg.ok && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
            {msg.text}
          </div>
        )}
      </div>

      {/* ── Freeze-pane grid ── */}
      <div ref={scrollRef} className="flex-1 overflow-auto" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        <div style={{ minWidth: totalMinW }}>

          {/* ── Sticky compound header ── */}
          <div className="sticky top-0 z-20 bg-card shadow-sm border-b border-gray-300 flex">
            {/* Frozen corner */}
            <div className="sticky left-0 z-30 bg-card shrink-0 flex border-r border-gray-200" style={{ width: FROZEN_W }}>
              <div className="flex items-end pb-1 px-1 text-[8px] font-bold text-gray-400 uppercase tracking-wide" style={{ width: UNIT_W }}>Unit</div>
              <div className="flex items-end pb-1 px-1 text-[8px] font-bold text-gray-400 uppercase tracking-wide" style={{ width: NAME_W }}>Name</div>
            </div>
            {/* Date group headers */}
            {dateStrs.map((ds, i) => {
              const hasPending = !!(pendingRef.current[ds]?.length);
              const isTodayCol = ds === todayStr;
              const isPH = SG_PH_SET.has(ds);
              const phName = SG_PH_META_MAP[ds]?.name;
              return (
                <div key={ds} className={cn(
                  "shrink-0 flex flex-col border-r border-gray-200",
                  isPH ? "bg-red-50" : isTodayCol ? "bg-blue-50" : hasPending ? "bg-amber-50" : ""
                )} style={{ width: DATE_GROUP_W }}>
                  {/* Date label */}
                  <div className={cn(
                    "text-[9px] font-bold text-center py-0.5 border-b border-gray-200 truncate px-1",
                    hasPending ? "text-amber-600" : isPH ? "text-red-600" : isTodayCol ? "text-blue-600" : "text-gray-500"
                  )}>
                    {isPH && <span className="mr-0.5">🎉</span>}
                    {format(dates[i], "EEE d MMM")}
                  </div>
                  {/* PH name row */}
                  {isPH && (
                    <div className="text-[7px] font-semibold text-red-500 text-center truncate px-0.5 py-0.5 border-b border-red-100 bg-red-50 leading-tight">
                      {phName}
                    </div>
                  )}
                  {/* Strength row */}
                  {(() => {
                    const s = strengthByDate[ds];
                    const total = s ? s.day + s.pd + s.nd : 0;
                    return (
                      <div className="flex items-center justify-center gap-1 px-1 py-0.5 border-b border-gray-200">
                        {s && total > 0 ? (
                          <>
                            {s.day > 0 && (
                              <span className="text-[8px] font-bold text-blue-700 bg-blue-100 rounded px-0.5 leading-tight">D:{s.day}</span>
                            )}
                            {s.pd > 0 && (
                              <span className="text-[8px] font-bold text-amber-700 bg-amber-100 rounded px-0.5 leading-tight">P:{s.pd}</span>
                            )}
                            {s.nd > 0 && (
                              <span className="text-[8px] font-bold text-purple-700 bg-purple-100 rounded px-0.5 leading-tight">N:{s.nd}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-[8px] text-gray-300">—</span>
                        )}
                      </div>
                    );
                  })()}
                  {/* Sub-column labels */}
                  <div className="flex">
                    <div className="text-[7px] font-bold text-gray-400 uppercase text-center py-0.5 border-r border-gray-100" style={{ width: TGT_W }}>TGT</div>
                    <div className="text-[7px] font-bold text-gray-400 uppercase text-center py-0.5 border-r border-gray-100" style={{ width: ACT_W }}>ACT</div>
                    <div className="text-[7px] font-bold text-gray-400 uppercase text-center py-0.5 border-r border-gray-100" style={{ width: CVR_W }}>CVR</div>
                    <div className="text-[7px] font-bold text-gray-400 uppercase text-center py-0.5" style={{ width: VEH_W }}>VEH</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Officer rows grouped by catchment */}
          {!loading && grouped.map(({ catchment, code, units }) => {
            const bg = CATCHMENT_BG[code] ?? "#F5F5F5";
            return (
              <div key={catchment}>
                {/* Catchment header — sticky full-width merged bar */}
                <div className="flex items-stretch border-b-2 border-gray-300">
                  <div className="sticky left-0 z-10 flex items-center px-2 py-1 text-[9px] font-extrabold tracking-widest uppercase whitespace-nowrap border-r border-gray-300"
                    style={{ width: "100vw", backgroundColor: bg, color: getContrastColor(bg) }}>
                    [{code}] {catchment}
                  </div>
                </div>

                {/* Officer rows */}
                {units.flatMap(({ list }) => (list as any[]).map((o: any) => {
                  const rowHasDirty = dateStrs.some(ds => pendingRef.current[ds]?.find(r => r.id === o.id));
                  const frozenBg = rowHasDirty ? "#FFFBEB" : bg;
                  return (
                    <div key={o.id} className="flex items-stretch border-b border-gray-100"
                      style={{ backgroundColor: rowHasDirty ? "#FFFBEB" : bg }}>
                      {/* Frozen: UNIT */}
                      <div className="sticky left-0 z-10 shrink-0 flex items-center justify-center text-[9px] font-bold border-r border-gray-200"
                        style={{ width: UNIT_W, background: frozenBg, color: getContrastColor(frozenBg) }}>
                        {o.unitCode}
                      </div>
                      {/* Frozen: NAME — tap to rename (managers only) */}
                      <div
                        className={cn(
                          "sticky z-10 shrink-0 flex items-center text-[11px] font-semibold truncate px-1.5 border-r border-gray-200 transition-colors",
                          !isReadOnly && "cursor-pointer hover:bg-blue-100/60 active:bg-blue-200/60"
                        )}
                        style={{ left: UNIT_W, width: NAME_W, background: frozenBg, color: getContrastColor(frozenBg) }}
                        onClick={!isReadOnly ? (e) => {
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          openNamePicker({ officerId: o.id, currentName: o.name, top: rect.bottom + 4, left: rect.left });
                          setQuickPick(null);
                        } : undefined}
                        title={!isReadOnly ? `${o.name} — tap to rename` : o.name}
                      >
                        {o.name}
                      </div>
                      {/* Date groups */}
                      {dateStrs.map(ds => {
                        const cell = scheduleByDate[ds]?.[o.id];
                        const isDirty = !!pendingRef.current[ds]?.find(r => r.id === o.id);
                        const duty   = cell?.duty || cell?.scheduledDuty || "";
                        const target = cell?.scheduledDuty || "";
                        const isLeave = LEAVE_CODE_SET.has(duty);
                        const isTodayCol = ds === todayStr;
                        return (
                          <div key={ds}
                            className={cn(
                              "shrink-0 flex items-stretch border-r border-gray-200",
                              isDirty && "outline outline-2 -outline-offset-2 outline-amber-400",
                              isTodayCol && !isDirty && "bg-blue-50/60"
                            )}
                            style={{ width: DATE_GROUP_W }}>
                            {/* TARGET — rounded badge, tap to pick */}
                            <div
                              role={isReadOnly ? undefined : "button"}
                              onClick={e => openQuickPick(e, o.id, ds, "scheduledDuty")}
                              className={cn(
                                "flex items-center justify-center px-0.5 py-1.5 border-r border-gray-100 select-none",
                                !isReadOnly && "cursor-pointer hover:brightness-90 active:scale-95"
                              )}
                              style={{ width: TGT_W }}>
                              <span className={cn(
                                "rounded-lg border text-[10px] font-semibold px-1.5 py-0.5 w-full text-center",
                                OV_ACTUAL_COLORS[target] ?? "bg-gray-50 border-gray-200 text-gray-400"
                              )}>
                                {target || "—"}
                              </span>
                            </div>
                            {/* ACTUAL — rounded badge, tap to pick. A comment (added via the
                                Vehicle cell's full modal below) shows as a purple corner
                                triangle here, with the note text on hover. */}
                            <div
                              role={isReadOnly ? undefined : "button"}
                              onClick={e => openQuickPick(e, o.id, ds, "duty")}
                              className={cn(
                                "relative flex items-center justify-center px-0.5 py-1.5 border-r border-gray-100 select-none",
                                !isReadOnly && "cursor-pointer hover:brightness-90 active:scale-95"
                              )}
                              style={{ width: ACT_W }}>
                              {cell?.comment && (
                                <span style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderStyle: "solid", borderWidth: "0 7px 7px 0", borderColor: "transparent #9333ea transparent transparent", pointerEvents: "none" }} />
                              )}
                              <span className={cn(
                                "rounded-lg border text-[10px] font-bold px-1.5 py-0.5 w-full text-center",
                                isLeave ? "bg-red-100 border-red-300 text-red-800"
                                        : cell?.coveringFor ? "bg-amber-100 border-amber-300 text-amber-800"
                                        : (OV_ACTUAL_COLORS[duty] ?? "bg-gray-50 border-gray-200 text-gray-400")
                              )}
                                title={cell?.comment ? `💬 ${cell.comment}` : cell?.coveringFor ? `Covering for ${cell.coveringFor}` : undefined}>
                                {duty || "—"}
                              </span>
                            </div>
                            {/* COVERING — tap to pick covering officer; ×-button to clear directly */}
                            <div
                              className={cn(
                                "flex items-center px-1 py-1.5 border-r border-gray-100 select-none gap-0.5",
                              )}
                              style={{ width: CVR_W }}>
                              <div
                                role={isReadOnly ? undefined : "button"}
                                onClick={e => openQuickPick(e, o.id, ds, "cover")}
                                className={cn(
                                  "flex-1 min-w-0 flex items-center justify-center",
                                  !isReadOnly && "cursor-pointer hover:bg-gray-100/60 rounded"
                                )}>
                                {cell?.cover
                                  ? <span className="truncate text-[9px] text-green-700 font-semibold w-full text-center">{cell.cover}</span>
                                  : cell?.coveringForUnit
                                    ? <span className="truncate text-[9px] text-red-600 font-semibold w-full text-center" title={`Covering for ${cell.coveringFor} (${cell.coveringForUnit})`}>{cell.coveringForUnit}</span>
                                    : <span className="text-[9px] text-gray-300">—</span>}
                              </div>
                              {/* × clears an incoming cover (blue) */}
                              {!isReadOnly && cell?.cover && (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); updateCell(o.id, ds, "cover", ""); }}
                                  className="text-[11px] leading-none text-gray-400 hover:text-red-500 shrink-0 transition-colors"
                                  title="Clear covering officer"
                                >×</button>
                              )}
                              {/* × clears an outgoing covering-for assignment (amber) — must clear the OTHER officer's cover field */}
                              {!isReadOnly && !cell?.cover && cell?.coveringForUnit && cell?.coveringFor && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    const coveredOfficer = (officers as any[]).find((off: any) =>
                                      off.name.trim().toLowerCase() === (cell!.coveringFor as string).trim().toLowerCase()
                                    );
                                    if (coveredOfficer) updateCell(coveredOfficer.id, ds, "cover", "");
                                    // Optimistically clear the amber indicator immediately
                                    setScheduleByDate(p => ({
                                      ...p,
                                      [ds]: {
                                        ...(p[ds] ?? {}),
                                        [o.id]: { ...(p[ds]?.[o.id] ?? {}), coveringFor: "", coveringForUnit: "" },
                                      },
                                    }));
                                  }}
                                  className="text-[11px] leading-none text-gray-400 hover:text-red-500 shrink-0 transition-colors"
                                  title="Clear covering assignment"
                                >×</button>
                              )}
                            </div>
                            {/* VEHICLE — tap to open full modal */}
                            <div
                              role={isReadOnly ? undefined : "button"}
                              onClick={isReadOnly ? undefined : () => setEditModal({ officerId: o.id, dateStr: ds })}
                              className={cn(
                                "flex items-center justify-center px-1 py-1.5 select-none",
                                !isReadOnly && "cursor-pointer hover:bg-gray-100/60"
                              )}
                              style={{ width: VEH_W }}>
                              {cell?.vehicle
                                ? <span className="truncate text-[9px] font-mono text-gray-700 w-full text-center">{cell.vehicle}</span>
                                : <span className="text-[9px] text-gray-300">—</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }))}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Inline quick-pick duty dropdown ── */}
      {quickPick && (() => {
        const isCover = quickPick.field === "cover";
        const SHIFTS = ["DAY","PD","ND","OFF","REST"];
        const LEAVES_ALPHA = [
          "AL","AMMA","AMOVL","AMC","AMTO","BL","C","CCL","CSL","FCL","HL",
          "MA","MC","ML","NS","OIL","OVL","PCL","PMC","PMMA","PMOVL","PMTO",
          "PPTW","SL","SLWOMC","SPL","TO","UL","VL",
        ].sort();

        // Cover picker: inline search+list
        const coverSearch = qpSearch.toLowerCase();
        const offs = officers as any[];
        const unitCodes = Array.from(new Set(offs.map((o: any) => o.unitCode as string))).sort();
        const coverOptions: { kind: "unit" | "name"; label: string; val: string }[] = isCover ? [
          ...unitCodes.filter(u => !coverSearch || u.toLowerCase().includes(coverSearch))
            .map(u => ({ kind: "unit" as const, label: u, val: u })),
          ...(() => {
            const seen = new Set<string>();
            return offs.filter((o: any) => {
              if (seen.has(o.name)) return false;
              seen.add(o.name);
              return !coverSearch || o.name.toLowerCase().includes(coverSearch);
            }).map((o: any) => ({ kind: "name" as const, label: o.name as string, val: o.name as string }));
          })(),
        ] : [];

        const q = qpSearch.trim().toUpperCase();
        const filteredShifts = !isCover && q ? SHIFTS.filter(d => d.includes(q)) : SHIFTS;
        const filteredLeaves = !isCover && q ? LEAVES_ALPHA.filter(d => d.includes(q)) : LEAVES_ALPHA;

        // Flip dropdown above the cell if too close to screen bottom
        const panelH = isCover ? 360 : 320;
        const flipUp = quickPick.top + panelH > window.innerHeight;
        const panelW = isCover ? Math.min(window.innerWidth - 16, 300) : Math.min(window.innerWidth - 16, 230);
        const dropStyle: React.CSSProperties = {
          left: Math.max(8, Math.min(quickPick.left - 30, window.innerWidth - panelW - 8)),
          width: panelW,
          maxHeight: "65vh",
          overflowY: "auto",
          ...(flipUp
            ? { bottom: window.innerHeight - quickPick.anchorTop + 4 }
            : { top: quickPick.top }),
        };

        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setQuickPick(null)} />
            <div className="fixed z-50 bg-popover border border-border rounded-2xl shadow-2xl p-2.5 flex flex-col gap-1.5"
              style={dropStyle}>
              <div className="text-[9px] font-extrabold text-muted-foreground uppercase tracking-widest px-0.5 pb-0.5">
                {isCover ? "Set Covering" : quickPick.field === "scheduledDuty" ? "Set Target" : "Set Actual"}
              </div>

              {/* Search input for both duty and cover */}
              <input
                autoFocus
                type="text"
                value={qpSearch}
                onChange={e => setQpSearch(e.target.value)}
                placeholder={isCover ? "Search name or unit…" : "Type to filter…"}
                className="w-full border border-input rounded-md px-2 py-1.5 text-xs bg-background text-foreground outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-muted-foreground"
              />

              {isCover ? (
                /* ── Cover: inline scrollable list ── */
                <>
                  {coverOptions.length === 0 ? (
                    <div className="py-4 text-xs text-muted-foreground text-center">No results</div>
                  ) : (
                    <div className="flex flex-col">
                      {coverOptions.map(item => {
                        const prefix = item.kind === "unit" ? item.val.replace(/[0-9]/g, "") : "";
                        const unitBg = CVR_CATCHMENT_BG[prefix];
                        return (
                        <button key={`${item.kind}-${item.val}`} type="button"
                          onClick={() => { updateCell(quickPick.officerId, quickPick.dateStr, "cover", item.val); setQuickPick(null); }}
                          style={unitBg ? { backgroundColor: unitBg, color: getContrastColor(unitBg) } : undefined}
                          className={cn(
                            "w-full text-left px-3 py-3 text-sm border-b border-gray-50 last:border-0 active:bg-muted transition-colors",
                            item.kind === "unit" && "font-bold",
                            !unitBg && "text-foreground"
                          )}>
                          {item.kind === "unit" ? `[${item.label}]` : item.label}
                        </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="h-px bg-border mt-0.5" />
                  <button type="button"
                    onClick={() => { updateCell(quickPick.officerId, quickPick.dateStr, "cover", ""); setQuickPick(null); }}
                    className="text-xs text-muted-foreground hover:text-destructive text-left px-1 py-1 transition-colors">
                    Clear
                  </button>
                </>
              ) : (
                <>
                  {/* Shift options */}
                  {filteredShifts.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {filteredShifts.map(d => (
                        <button key={d} type="button"
                          onClick={() => { updateCell(quickPick.officerId, quickPick.dateStr, quickPick.field, d); setQuickPick(null); }}
                          className={cn(
                            "rounded-md border text-[10px] font-bold px-2.5 py-1 transition-all active:scale-95",
                            OV_ACTUAL_COLORS[d] ?? "bg-gray-100 border-gray-200 text-gray-700"
                          )}>
                          {d}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Leave options (alphabetical) */}
                  {filteredLeaves.length > 0 && (
                    <>
                      {filteredShifts.length > 0 && <div className="h-px bg-gray-100" />}
                      <div className="flex flex-wrap gap-1">
                        {filteredLeaves.map(d => (
                          <button key={d} type="button"
                            onClick={() => { updateCell(quickPick.officerId, quickPick.dateStr, quickPick.field, d); setQuickPick(null); }}
                            className="rounded-md border border-red-200 bg-red-50 text-[9px] font-semibold px-1.5 py-0.5 text-red-700 hover:bg-red-100 active:scale-95 transition-all">
                            {d}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {/* Clear */}
                  <div className="h-px bg-border mt-0.5" />
                  <button type="button"
                    onClick={() => { updateCell(quickPick.officerId, quickPick.dateStr, quickPick.field, ""); setQuickPick(null); }}
                    className="text-[9px] text-muted-foreground hover:text-destructive text-left px-0.5 transition-colors">
                    Clear
                  </button>
                </>
              )}
            </div>
          </>
        );
      })()}

      {/* ── Cell edit bottom-sheet ── */}
      {editModal && editModalOfficer && editModalCell && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => setEditModal(null)}>
          <div className="bg-card w-full max-w-sm rounded-t-2xl p-4 space-y-3 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">{editModalOfficer.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {editModalOfficer.unitCode} · {format(parseISO(editModal.dateStr), "EEE d MMM yyyy")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {editModalPending && (
                  <button type="button"
                    onClick={() => { clearCell(editModal.officerId, editModal.dateStr); setEditModal(null); }}
                    className="text-[10px] text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50">
                    Reset
                  </button>
                )}
                <button type="button" onClick={() => setEditModal(null)}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-14 shrink-0">Target</span>
                <div className={cn("h-7 w-[58px] flex items-center justify-center rounded border text-[10px] font-semibold",
                  OV_ACTUAL_COLORS[editModalCell.scheduledDuty] ?? "bg-gray-50 border-gray-200 text-gray-500")}>
                  {editModalCell.scheduledDuty || "—"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-14 shrink-0">Actual</span>
                <DutyPicker
                  value={editModalCell.duty}
                  onChange={v => updateCell(editModal.officerId, editModal.dateStr, "duty", v)}
                  duties={ALL_DUTIES}
                  colorMap={OV_ACTUAL_COLORS}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-14 shrink-0">Cover</span>
                <CoveringPicker
                  value={editModalCell.cover}
                  onChange={v => updateCell(editModal.officerId, editModal.dateStr, "cover", v)}
                  officers={officers as any[]}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-14 shrink-0">Vehicle</span>
                <input type="text" value={editModalCell.vehicle}
                  onChange={e => updateCell(editModal.officerId, editModal.dateStr, "vehicle", e.target.value.toUpperCase())}
                  placeholder="Plate"
                  className="h-7 border border-gray-200 dark:border-gray-600 rounded px-2 text-[11px] bg-background text-gray-800 dark:text-gray-200 placeholder:text-gray-400 uppercase tracking-wide w-28"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-14 shrink-0">OT (hrs)</span>
                <input type="number" min="0" max="24" step="0.5"
                  value={editModalCell.ot}
                  onChange={e => updateCell(editModal.officerId, editModal.dateStr, "ot", e.target.value)}
                  placeholder="0"
                  className="h-7 border border-gray-200 dark:border-gray-600 rounded px-2 text-[11px] bg-background text-gray-800 dark:text-gray-200 placeholder:text-gray-400 w-20"
                />
              </div>
              <div className="flex items-start gap-3">
                <span className="text-[11px] text-muted-foreground w-14 shrink-0 pt-1.5">Note</span>
                <textarea
                  value={editModalCell.comment ?? ""}
                  onChange={e => updateCell(editModal.officerId, editModal.dateStr, "comment", e.target.value)}
                  placeholder="Add a note for this cell…"
                  rows={2}
                  className="flex-1 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-[11px] bg-background text-gray-800 dark:text-gray-200 placeholder:text-gray-400 resize-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Officer name edit popover ── */}
      {namePicker && (() => {
        const panelW = 240;
        const panelH = 120;
        const flipUp = namePicker.top + panelH > window.innerHeight;
        const left = Math.max(8, Math.min(namePicker.left, window.innerWidth - panelW - 8));
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setNamePicker(null)} />
            <div
              className="fixed z-50 bg-popover border rounded-xl shadow-2xl p-3 space-y-2"
              style={{
                width: panelW, left,
                ...(flipUp
                  ? { bottom: window.innerHeight - namePicker.top + 8 }
                  : { top: namePicker.top }),
              }}
            >
              <p className="text-[11px] font-bold text-foreground">Rename officer</p>
              <input
                autoFocus
                className="w-full rounded-md border border-gray-200 text-[12px] px-2 py-1.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-blue-400"
                value={namePickerValue}
                onChange={e => setNamePickerValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") saveOfficerName();
                  if (e.key === "Escape") setNamePicker(null);
                }}
                placeholder="Full name"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="text-[11px] px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  onClick={() => setNamePicker(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={namePickerSaving || !namePickerValue.trim()}
                  className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                  onClick={saveOfficerName}
                >
                  {namePickerSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "excel" | "override";

export default function UploadBrief() {
  const { toast } = useToast();
  const { bumpVersion } = useRosterVersion();
  const [tab, setTab] = useState<Tab>("override");

  const [parsed, setParsed]       = useState<ParsedBrief | null>(null);
  const [dateOverride, setDateOverride] = useState("");
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [applying, setApplying]   = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [skippedCount, setSkippedCount] = useState<number | null>(null);
  const [appliedDate, setAppliedDate] = useState<string | null>(null);
  const [reverting, setReverting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName]   = useState("");
  const [excelParsing, setExcelParsing] = useState(false);

  const resetExcel = () => {
    setParsed(null); setDateOverride("");
    setUnmatched([]); setAppliedCount(null); setSkippedCount(null); setAppliedDate(null); setFileName("");
  };

  const handleExcelFile = useCallback(async (file: File) => {
    setExcelParsing(true);
    setFileName(file.name);
    try {
      const result = await parseExcelBrief(file);
      setParsed(result);
      setDateOverride(result.date);
      setUnmatched([]);
      setAppliedCount(null);
      setSkippedCount(null);
      setAppliedDate(null);
    } catch {
      toast({ title: "Parse failed", description: "Could not read the Excel file.", variant: "destructive" });
    } finally {
      setExcelParsing(false);
    }
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleExcelFile(file);
  }, [handleExcelFile]);

  // Download section — own month state, fetches officers independently (no dependency on OverrideEditor)
  const [dlMonth, setDlMonth] = useState<string>(format(new Date(), "yyyy-MM"));
  const [xlsDownloading, setXlsDownloading] = useState(false);
  const handleDownloadXls = useCallback(async () => {
    setXlsDownloading(true);
    try {
      // Fetch officer list
      const offRes = await fetch("/api/roster-plan/officers", { credentials: "include" });
      if (!offRes.ok) throw new Error("Could not load officers");
      const offs: any[] = await offRes.json();

      // Compute dates for the chosen month
      const ms = startOfMonth(new Date(dlMonth + "-01"));
      const dates = eachDayOfInterval({ start: ms, end: endOfMonth(ms) })
        .map(d => format(d, "yyyy-MM-dd"));

      // Fetch schedule data for every date in parallel
      const fetched = await Promise.all(dates.map(async ds => {
        const res = await fetch(`/api/roster-plan/schedule?date=${ds}`, { credentials: "include" });
        const sched = res.ok ? await res.json() : { duties: [] };
        return { ds, duties: (sched.duties ?? []) as any[] };
      }));

      // Build rows: header, then one row per (catchment officer × date)
      const header = ["Date", "Name", "Unit", "Target", "Actual", "Covering", "Vehicle"];
      const rows: (string | number)[][] = [header];

      for (const { ds, duties } of fetched) {
        const dateLabel = format(parseISO(ds), "d MMM yyyy (EEE)");
        for (const catchment of CATCHMENT_ORDER) {
          const code = CATCHMENT_CODE[catchment];
          const catchOfficers = offs.filter((o: any) => (o.unitCode ?? "").startsWith(code));
          for (const o of catchOfficers) {
            const entry = duties.find((x: any) => x.officerId === o.id && x.date === ds);
            rows.push([
              dateLabel,
              o.name ?? o.officerName ?? "",
              o.unitCode ?? "",
              entry?.targetDuty ?? "",
              entry?.duty ?? "",
              entry?.crossPostedToUnit ?? entry?.coveredByOfficerName ?? entry?.swappedWithOfficerName
                ?? entry?.coveringForUnit ?? "",
              entry?.vehicle ?? "",
            ]);
          }
        }
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 22 }, { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 10 }
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, format(ms, "MMM yyyy"));
      XLSX.writeFile(wb, `Roster_${dlMonth}.xlsx`);
      toast({ title: "Downloaded", description: `Roster_${dlMonth}.xlsx saved.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Download failed", description: msg, variant: "destructive" });
    } finally {
      setXlsDownloading(false);
    }
  }, [dlMonth, toast]);

  const handleApply = async () => {
    if (!parsed) return;
    const date = dateOverride || parsed.date;
    if (!date) {
      toast({ title: "No date", description: "Set a date before applying.", variant: "destructive" });
      return;
    }
    setApplying(true);
    try {
      const res = await fetch("/api/roster-plan/import-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...parsed, date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setUnmatched(data.unmatched ?? []);
      // Backend now diffs against the existing overrides before writing
      // (read-before-write) and reports changed vs skipped-as-no-op counts
      // separately, rather than a single "applied" total that couldn't tell
      // "10 officers processed" from "10 officers actually changed".
      setAppliedCount(data.changed ?? data.applied?.length ?? 0);
      setSkippedCount(data.skipped ?? 0);
      setAppliedDate(date);
      bumpVersion();
      toast({
        title: (data.changed ?? 0) > 0 ? "Brief imported" : "No changes — roster already up to date",
        description: (data.changed ?? 0) > 0
          ? `${data.changed} officer(s) updated for ${date}.${data.skipped ? ` ${data.skipped} already matched (skipped).` : ""}${data.unmatched?.length ? ` ${data.unmatched.length} unmatched.` : ""}`
          : `All entries for ${date} already match the current roster.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  // Undo — clears every override/leave this import wrote for its date,
  // restoring the roster to what it was before Apply. Mirrors handleApply's
  // single-date scope: only the date just applied can be reverted this way.
  const handleRevert = async () => {
    if (!appliedDate) return;
    setReverting(true);
    try {
      const res = await fetch("/api/roster-plan/import-brief", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dates: [appliedDate] }),
      });
      if (!res.ok) throw new Error("Revert failed");
      const revertedDate = appliedDate;
      setAppliedCount(null);
      setSkippedCount(null);
      setAppliedDate(null);
      bumpVersion();
      toast({ title: "Reverted", description: `Cleared overrides for ${revertedDate}. Roster is back to before this import.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Revert failed", description: msg, variant: "destructive" });
    } finally {
      setReverting(false);
    }
  };

  const effectiveDate = dateOverride || parsed?.date || "";
  const dateLabel = effectiveDate
    ? (() => { try { return format(new Date(effectiveDate + "T00:00:00Z"), "EEE, d MMM yyyy"); } catch { return effectiveDate; } })()
    : "";
  const totalEntries = (parsed?.assignments.length ?? 0) + (parsed?.off.length ?? 0) + (parsed?.leave.length ?? 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-3 bg-card flex items-center gap-3">
        <Upload className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Excel</h2>
        {tab === "excel" && parsed && (
          <button onClick={resetExcel} className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground" title="Reset">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      {/* Tab selector — always visible */}
      <div className="shrink-0 border-b px-4 pt-3 pb-2 bg-card">
        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
          {(["override", "excel"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); }}
              className={cn(
                "px-4 py-1.5 rounded-md text-xs font-medium transition-colors",
                tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "override" ? "✏️ Master" : "📊 Upload / Download"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Excel tab — has its own scrollable area ── */}
      {tab === "excel" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-3">
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg px-6 py-10 text-center cursor-pointer transition-colors",
                "hover:border-primary hover:bg-primary/5",
                excelParsing && "pointer-events-none opacity-60"
              )}
            >
              {excelParsing ? (
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              ) : (
                <>
                  <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">{fileName || "Drop .xlsx file or click to browse"}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Expected columns: <span className="font-mono">Name | Target | Actual | Covering/OT | Vehicle</span>
                  </p>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleExcelFile(f); }}
            />

            {/* Download section */}
            <div className="border-2 border-dashed rounded-lg px-6 py-5 space-y-3">
              <div className="flex items-center gap-2 justify-center">
                <Download className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-600">Download Roster (.xlsx)</span>
              </div>
              <div className="flex items-center gap-2 justify-center">
                <label className="text-xs text-muted-foreground">Month:</label>
                <input
                  type="month"
                  value={dlMonth}
                  onChange={e => setDlMonth(e.target.value)}
                  className="border border-gray-200 rounded-md px-2 py-1 text-xs bg-background"
                />
              </div>
              <button
                type="button"
                onClick={handleDownloadXls}
                disabled={xlsDownloading}
                className={cn(
                  "w-full rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2 transition-colors",
                  xlsDownloading && "opacity-60 pointer-events-none"
                )}
              >
                {xlsDownloading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
                  </span>
                ) : (
                  `Export ${dlMonth}`
                )}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                Date | Name | Unit | Target | Actual | Covering | Vehicle
              </p>
            </div>
          </div>

          {parsed && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-card p-4 space-y-4">
                {/* Date row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</span>
                  <input
                    type="date"
                    value={dateOverride}
                    onChange={e => setDateOverride(e.target.value)}
                    className="h-7 px-2 text-xs border rounded bg-background"
                  />
                  {dateLabel && <span className="text-xs text-muted-foreground">{dateLabel}</span>}
                  {!effectiveDate && (
                    <span className="text-xs text-red-500 font-medium">⚠ Set a date before applying</span>
                  )}
                </div>
                <PreviewTable brief={parsed} />
              </div>

              {unmatched.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-1">
                      Unmatched names — not in officer list
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">{unmatched.join(", ")}</p>
                  </div>
                </div>
              )}

              {appliedCount !== null && (
                <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-3 flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-green-800 dark:text-green-300 font-medium">
                      Applied — {appliedCount} officer(s) updated for {dateLabel}
                      {skippedCount ? ` (${skippedCount} already matched, skipped)` : ""}
                    </p>
                    {appliedDate && (
                      <button
                        onClick={handleRevert}
                        disabled={reverting}
                        className="shrink-0 text-xs font-medium text-green-800 dark:text-green-300 underline hover:no-underline disabled:opacity-50"
                        title="Clear the overrides/leave this import wrote and restore the previous roster for this date"
                      >
                        {reverting ? "Undoing…" : "Undo"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <Button
                onClick={handleApply}
                disabled={applying || totalEntries === 0 || !effectiveDate}
                className="w-full"
              >
                {applying
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Applying…</>
                  : <><CheckCircle className="h-4 w-4 mr-2" />Apply to Roster — {effectiveDate || "set date"}</>}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Override tab — OverrideEditor manages its own frozen header + scroll ── */}
      {tab === "override" && <OverrideEditor />}

    </div>
  );
}
