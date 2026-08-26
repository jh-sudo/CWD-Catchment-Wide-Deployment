// Roster pattern authoring tool — ported from Replit's RosterBuilder.tsx
// (2,585 lines). One deliberate simplification throughout: Replit's week-block
// and team-slot reordering use a long-press pointer-drag gesture with a
// floating ghost element and animated row displacement — substantial,
// mobile-optimized UI code for a secondary interaction. This port keeps the
// exact same reordering CAPABILITY via simple ▲/▼ buttons instead, matching
// the pattern manager.ts already uses for location-priority reordering
// (swapLocPriority) — consistent with this codebase's own convention rather
// than introducing a new, complex gesture system for one page.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ChevronDown, ChevronRight, Plus, Trash2, RefreshCw, Save, Zap,
  Loader2, PenLine, Check, X as XIcon, AlertCircle, CheckCircle2, Pencil, Shuffle, Copy,
  ChevronUp,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { useRosterVersion } from "@/context/RosterVersionContext";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PatternSummary {
  id: string;
  name: string;
  teamCount: number;
  createdAt: string;
  isBuiltIn?: boolean;
}

interface PatternOfficer {
  id: string;
  name: string;
  vehicle: string;
  crewPosition: number;
}

interface Subcatchment {
  id: string;
  acronym: string;
  name: string;
  color: string;
}

interface PatternTeam {
  slot: number;
  subcatchmentId?: string;
  catchment: string;
  unit: string;
  color?: string;
  officers: PatternOfficer[];
}

// ── Unit colour palette (one colour per slot, cycles) ──────────────────────────
const UNIT_PALETTE = [
  "#7c6f9f", "#3d7abf", "#2a9d8f", "#e76f51", "#e9c46a",
  "#264653", "#f4a261", "#457b9d", "#6a994e", "#bc4749",
  "#8338ec", "#fb8500", "#219ebc", "#023047", "#ffb703",
  "#e63946", "#2a9d8f", "#e9c46a", "#7c6f9f", "#3d7abf",
];

interface FullPattern {
  id: string;
  name: string;
  teamCount: number;
  weekdayPD: number;
  weekdayDAY: number;
  weekendPD: number;
  weekendDAY: number;
  isBuiltIn?: boolean;
  weekdayPattern?: string;
  weekendPattern?: string;
  consecutiveShifts?: number;
  baseWeeks: string[][];
  subcatchments?: Subcatchment[];
  teams: PatternTeam[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const DUTY_CYCLE = ["PD", "DAY", "ND", "OFF", "REST"] as const;
type Duty = typeof DUTY_CYCLE[number];

const DUTY_COLORS: Record<string, string> = {
  PD:   "bg-orange-100 text-orange-800 border-orange-200",
  DAY:  "bg-blue-100   text-blue-800   border-blue-200",
  ND:   "bg-yellow-100 text-yellow-800 border-yellow-200",
  OFF:  "bg-green-100  text-green-800  border-green-200",
  REST: "bg-pink-100   text-pink-800   border-pink-200",
};

function cycleDuty(current: string): string {
  const idx = DUTY_CYCLE.indexOf(current as Duty);
  return DUTY_CYCLE[(idx + 1) % DUTY_CYCLE.length];
}

function getNextMonday(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon
  const daysToAdd = day === 1 ? 7 : ((8 - day) % 7 || 7);
  d.setDate(d.getDate() + daysToAdd);
  return d.toISOString().slice(0, 10);
}

/** Derive a stable, human-readable ID from an officer's unique name.
 *  "Officer-16" → "farhan-y", "Ahmad Rizal Bin Hassan" → "ahmad-rizal-bin-hassan".
 *  Falls back to a timestamp slug only when the name is blank (new unsaved row). */
function nameToId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return slug || `officer-${Date.now()}`;
}

function blankOfficer(crewPosition: number, unitHint: string): PatternOfficer {
  return {
    id: `new-${unitHint.toLowerCase()}-${crewPosition}-${Date.now()}`,
    name: "",
    vehicle: "",
    crewPosition,
  };
}

const DAYS_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DUTY_HOURS: Record<string, number> = {
  PD:   8,
  DAY:  8,
  ND:   8,
  OFF:  0,
  REST: 0,
};
function weekHours(week: string[]): number {
  return week.reduce((s, d) => s + (DUTY_HOURS[d] ?? 0), 0);
}

// ── System officer type (from /api/roster-plan/officer-names) ─────────────────
interface SystemOfficer {
  id: string;
  name: string;
}

// ── OfficerCombobox ───────────────────────────────────────────────────────────
interface OfficerComboboxProps {
  value: string;
  onChange: (name: string, officerId?: string) => void;
  officers: SystemOfficer[];
  placeholder?: string;
}

function OfficerCombobox({ value, onChange, officers, placeholder }: OfficerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);

  // Keep query in sync when the external value changes (e.g. pattern load)
  useEffect(() => { setQuery(value); }, [value]);

  const filtered = officers
    .filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 10);

  const exactMatch = filtered.some(
    o => o.name.toLowerCase() === query.trim().toLowerCase()
  );

  const commit = (name: string, officerId?: string) => {
    const trimmed = name.trim();
    onChange(trimmed, officerId);
    setQuery(trimmed);
    setOpen(false);
  };

  return (
    <div className="relative flex-1">
      <Input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Small delay so onMouseDown on list items fires first
          setTimeout(() => {
            setOpen(false);
            // Commit whatever is typed on blur
            if (query.trim() !== value) onChange(query.trim());
          }, 160);
        }}
        onKeyDown={e => {
          if (e.key === "Enter") { commit(query); e.preventDefault(); }
          if (e.key === "Escape") { setOpen(false); }
        }}
        className="h-7 text-xs"
        placeholder={placeholder}
      />
      {open && (filtered.length > 0 || (query.trim() && !exactMatch)) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 rounded-md border bg-popover shadow-md max-h-44 overflow-y-auto">
          {filtered.map(o => (
            <button
              key={o.id}
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
              onMouseDown={e => { e.preventDefault(); commit(o.name, o.id); }}
            >
              {o.name}
            </button>
          ))}
          {query.trim() && !exactMatch && (
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground border-t italic"
              onMouseDown={e => { e.preventDefault(); commit(query.trim()); }}
            >
              Add &ldquo;<span className="font-semibold not-italic text-foreground">{query.trim()}</span>&rdquo; as new name
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function RosterBuilder() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { bumpVersion } = useRosterVersion();

  // Pattern list
  const [patterns, setPatterns] = useState<PatternSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Active pattern (in-editor state)
  const [pattern, setPattern] = useState<FullPattern | null>(null);
  const [patternLoading, setPatternLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isNew, setIsNew] = useState(false);   // true = not saved to server yet

  // Editing pattern name inline
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Saving
  const [saving, setSaving] = useState(false);

  // Implement dialog
  const [implDialogOpen, setImplDialogOpen] = useState(false);
  const [implDate, setImplDate] = useState(getNextMonday);
  const [implementing, setImplementing] = useState(false);
  const [implResult, setImplResult] = useState<{ officersActivated: number; officersDeactivated: number } | null>(null);
  const [implConfirmText, setImplConfirmText] = useState("");

  // Regenerate warning
  const [pendingTeamCount, setPendingTeamCount] = useState<number | null>(null);
  const [teamCountRaw, setTeamCountRaw] = useState<string>("");
  const [wdPDRaw,  setWdPDRaw]  = useState<string>("");
  const [wdDAYRaw, setWdDAYRaw] = useState<string>("");
  const [wePDRaw,  setWePDRaw]  = useState<string>("");
  const [weDAYRaw, setWeDAYRaw] = useState<string>("");
  const [regenLoading, setRegenLoading] = useState(false);

  // Shift-pattern strings (weekday / weekend)
  const [weekdayPatternStr, setWeekdayPatternStr] = useState("2,3,2,2,3");
  const [weekendPatternStr, setWeekendPatternStr] = useState("3,2,2,3,2");
  const [consecutiveShiftsStr, setConsecutiveShiftsStr] = useState("");

  // Delete-pattern confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Teams: which slots are expanded
  const [expandedSlots, setExpandedSlots] = useState<Set<number>>(new Set([1]));

  // System officers list (for combobox suggestions)
  const [systemOfficers, setSystemOfficers] = useState<SystemOfficer[]>([]);

  // ── Data fetching ───────────────────────────────────────────────────────────
  const fetchPatterns = useCallback(async () => {
    setListLoading(true);
    try {
      const r = await fetch("/api/roster-patterns");
      if (r.ok) {
        const list: PatternSummary[] = await r.json();
        setPatterns(list);
        // Auto-load the first pattern if nothing loaded yet
        if (list.length > 0 && !pattern) {
          loadPattern(list[0].id);
        }
      }
    } finally {
      setListLoading(false);
    }
  }, []); // eslint-disable-line

  const loadPattern = async (id: string) => {
    setPatternLoading(true);
    setIsNew(false);
    setIsDirty(false);
    setEditingName(false);
    try {
      const r = await fetch(`/api/roster-patterns/${id}`);
      if (r.ok) {
        const p: FullPattern = await r.json();
        setPattern(p);
        setPendingTeamCount(null);
      } else {
        toast({ title: "Failed to load pattern", variant: "destructive" });
      }
    } finally {
      setPatternLoading(false);
    }
  };

  useEffect(() => { fetchPatterns(); }, []); // eslint-disable-line

  // Fetch combined officer name list (current officers + every name ever in a pattern)
  useEffect(() => {
    fetch("/api/roster-plan/officer-names")
      .then(r => r.ok ? r.json() : [])
      .then((list: SystemOfficer[]) => setSystemOfficers(list))
      .catch(() => {});
  }, []);

  // Sync requirements fields that live outside the pattern object when a pattern loads
  useEffect(() => {
    if (pattern) {
      // For a brand-new unsaved pattern (id === "") leave the text fields blank
      // so the user starts from a clean slate rather than seeing hardcoded defaults.
      const isUnsaved = !pattern.id;
      setWeekdayPatternStr(pattern.weekdayPattern || (isUnsaved ? "" : "2,3,2,2,3"));
      setWeekendPatternStr(pattern.weekendPattern || (isUnsaved ? "" : "3,2,2,3,2"));
      setConsecutiveShiftsStr(pattern.consecutiveShifts != null ? String(pattern.consecutiveShifts) : (isUnsaved ? "" : "3"));
      setTeamCountRaw(String(pattern.teamCount));
      setWdPDRaw(String(pattern.weekdayPD));
      setWdDAYRaw(String(pattern.weekdayDAY));
      setWePDRaw(String(pattern.weekendPD));
      setWeDAYRaw(String(pattern.weekendDAY));
      setPendingTeamCount(null);
    }
  }, [pattern?.id]); // eslint-disable-line

  // Auto-seed 5 default catchments when a pattern loads with none defined
  useEffect(() => {
    if (pattern && (!pattern.subcatchments || pattern.subcatchments.length === 0)) {
      const SEED = [
        { acronym: "BU", name: "Bukit Timah Urban", color: "#FFFFCC" },
        { acronym: "PJ", name: "Jurong Pandan",      color: "#D0D0D0" },
        { acronym: "WK", name: "Woodlands Kranji",   color: "#FBE2D5" },
        { acronym: "CP", name: "Changi Punggol",     color: "#DAF2D0" },
        { acronym: "KG", name: "Kallang Geylang",    color: "#CAEDFB" },
      ];
      const defaults: Subcatchment[] = SEED.map((s, i) => ({
        id: `sc_default_${i + 1}`,
        ...s,
      }));
      setPattern(p => p ? { ...p, subcatchments: defaults } : p);
    }
  }, [pattern?.id]); // eslint-disable-line

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Pattern grid editing ────────────────────────────────────────────────────
  const cycleCell = (weekIdx: number, dayIdx: number) => {
    if (!pattern) return;
    setPattern(p => {
      if (!p) return p;
      const newWeeks = p.baseWeeks.map((w, wi) =>
        wi === weekIdx ? w.map((d, di) => di === dayIdx ? cycleDuty(d) : d) : w
      );
      return { ...p, baseWeeks: newWeeks };
    });
    setIsDirty(true);
  };

  // Move a whole week row up/down (▲/▼ button — see file header for why this
  // replaces Replit's long-press drag gesture).
  const moveWeek = (wi: number, dir: -1 | 1) => {
    if (!pattern) return;
    const dst = wi + dir;
    if (dst < 0 || dst >= pattern.baseWeeks.length) return;
    setPattern(p => {
      if (!p) return p;
      const newWeeks = [...p.baseWeeks];
      [newWeeks[wi], newWeeks[dst]] = [newWeeks[dst], newWeeks[wi]];
      return { ...p, baseWeeks: newWeeks };
    });
    setIsDirty(true);
  };

  // ── Requirements editing ────────────────────────────────────────────────────
  const updateReq = (field: keyof Pick<FullPattern, "weekdayPD" | "weekdayDAY" | "weekendPD" | "weekendDAY">, value: number) => {
    setPattern(p => p ? { ...p, [field]: value } : p);
    setIsDirty(true);
  };

  // ── Shift-pattern auto-generate ─────────────────────────────────────────────
  function parseShiftPattern(s: string): number[] {
    return s.split(",").map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n > 0);
  }

  function buildMonthSlots(n: number, slots: number, fillSeq: string[]): string[] {
    const seq: string[] = [];
    for (let i = 0; i < n && seq.length < slots; i++) seq.push("PD");
    let fi = 0;
    while (seq.length < slots) { seq.push(fillSeq[fi % fillSeq.length]); fi++; }
    return seq;
  }

  const handleAutoGenerateWeekday = () => {
    const nums = parseShiftPattern(weekdayPatternStr);
    if (!nums.length || !pattern) return;
    const totalWeeks = pattern.baseWeeks.length;
    const flat: string[] = [];
    for (let s = 0; s < nums.length; s++) {
      const segStart = Math.floor(s * totalWeeks / nums.length);
      const segEnd   = Math.floor((s + 1) * totalWeeks / nums.length);
      flat.push(...buildMonthSlots(nums[s], (segEnd - segStart) * 5, ["ND","OFF","REST","OFF","REST","OFF"]));
    }
    setPattern(p => {
      if (!p) return p;
      const updated = p.baseWeeks.map(w => [...w]);
      let idx = 0;
      for (let w = 0; w < totalWeeks; w++)
        for (let d = 0; d < 5; d++)
          if (idx < flat.length) updated[w][d] = flat[idx++];
      return { ...p, baseWeeks: updated, weekdayPattern: weekdayPatternStr };
    });
    setIsDirty(true);
    toast({ title: "Weekday grid updated from pattern" });
  };

  const handleAutoGenerateWeekend = () => {
    const nums = parseShiftPattern(weekendPatternStr);
    if (!nums.length || !pattern) return;
    const totalWeeks = pattern.baseWeeks.length;
    const flat: string[] = [];
    for (let s = 0; s < nums.length; s++) {
      const segStart = Math.floor(s * totalWeeks / nums.length);
      const segEnd   = Math.floor((s + 1) * totalWeeks / nums.length);
      flat.push(...buildMonthSlots(nums[s], (segEnd - segStart) * 2, ["OFF","REST","OFF","REST","OFF"]));
    }
    setPattern(p => {
      if (!p) return p;
      const updated = p.baseWeeks.map(w => [...w]);
      let idx = 0;
      for (let w = 0; w < totalWeeks; w++)
        for (let d = 5; d <= 6; d++)
          if (idx < flat.length) updated[w][d] = flat[idx++];
      return { ...p, baseWeeks: updated, weekendPattern: weekendPatternStr };
    });
    setIsDirty(true);
    toast({ title: "Weekend grid updated from pattern" });
  };

  // ── Build a week-level duty sequence honouring a monthly pattern ─────────────
  // patternNums: number of shift-duty weeks per month segment (from the pattern string)
  // pdCount / dayCount: exact totals required across the full cycle
  // restFill: cycle for non-shift weeks (e.g. ["ND","OFF"] for weekdays)
  // doShuffle: if true, Fisher-Yates each segment so duty weeks aren't always bunched
  function buildPatternSeq(
    totalWeeks: number,
    pdCount: number,
    dayCount: number,
    patternNums: number[],
    restFill: string[],
    doShuffle: boolean,
    consecutiveShifts: number   // 0 = no constraint
  ): string[] {
    // Shift pool: all PD weeks first, then DAY weeks
    const pdCap  = Math.min(pdCount,  totalWeeks);
    const dayCap = Math.min(dayCount, totalWeeks - pdCap);
    const shiftPool = [...Array(pdCap).fill("PD"), ...Array(dayCap).fill("DAY")];
    let shiftIdx = 0;

    const result: string[] = [];

    for (let s = 0; s < patternNums.length; s++) {
      const segStart = Math.floor(s       * totalWeeks / patternNums.length);
      const segEnd   = Math.floor((s + 1) * totalWeeks / patternNums.length);
      const segWeeks = segEnd - segStart;

      const shiftWeeks = Math.min(patternNums[s], segWeeks, shiftPool.length - shiftIdx);
      const restWeeks  = segWeeks - shiftWeeks;

      const segShifts: string[] = [];
      for (let i = 0; i < shiftWeeks; i++) segShifts.push(shiftPool[shiftIdx++]);

      let seg: string[];

      if (doShuffle) {
        // Shuffle: mix freely within segment
        const segRest = Array.from({ length: restWeeks }, (_, i) => restFill[i % restFill.length]);
        seg = [...segShifts, ...segRest];
        for (let i = seg.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [seg[i], seg[j]] = [seg[j], seg[i]];
        }
      } else if (consecutiveShifts > 0 && shiftWeeks > 0 && restWeeks > 0) {
        // Split shifts into blocks of ≤ C, then place rest BETWEEN blocks first
        // so no run of shift weeks ever exceeds C. Any leftover rest goes after
        // the last block. If there is not enough rest to separate every gap the
        // constraint is honoured as much as possible (best-effort).
        const C = Math.max(1, consecutiveShifts);
        const blocks: string[][] = [];
        for (let i = 0; i < segShifts.length; i += C)
          blocks.push(segShifts.slice(i, i + C));

        // Gaps between adjacent blocks (not after the last one)
        const numGaps = blocks.length - 1;
        // Allocate at least 1 rest per gap, up to what's available
        const restForGaps = Math.min(numGaps, restWeeks);
        const restAfterLast = restWeeks - restForGaps;
        // Spread restForGaps as evenly as possible across the numGaps gaps
        const baseGap   = numGaps > 0 ? Math.floor(restForGaps / numGaps) : 0;
        const extraGaps = numGaps > 0 ? restForGaps % numGaps : 0;

        seg = [];
        let restUsed = 0;
        for (let b = 0; b < blocks.length; b++) {
          seg.push(...blocks[b]);
          if (b < numGaps) {
            // Inter-block rest: give extra 1 to the first `extraGaps` gaps
            const gapSize = baseGap + (b < extraGaps ? 1 : 0);
            for (let r = 0; r < gapSize; r++)
              seg.push(restFill[(restUsed + r) % restFill.length]);
            restUsed += gapSize;
          }
        }
        // Remaining rest appended after the last shift block
        for (let r = 0; r < restAfterLast; r++)
          seg.push(restFill[(restUsed + r) % restFill.length]);
      } else {
        // No consecutive constraint: shifts first, then rest
        seg = [
          ...segShifts,
          ...Array.from({ length: restWeeks }, (_, i) => restFill[i % restFill.length]),
        ];
      }

      result.push(...seg);
    }

    // Edge case: pattern segments didn't cover all weeks
    while (result.length < totalWeeks) {
      result.push(
        shiftIdx < shiftPool.length
          ? shiftPool[shiftIdx++]
          : restFill[result.length % restFill.length]
      );
    }

    // If pdCount+dayCount exceeds the pattern sum, some shifts are still unplaced.
    // First try to slot them into positions that don't violate the consecutive limit;
    // fall back to any non-shift position so exact totals are always honoured.
    if (consecutiveShifts > 0 && shiftIdx < shiftPool.length) {
      const isShift = (x: string) => x === "PD" || x === "DAY";
      const runLength = (arr: string[], pos: number) => {
        // Count how long the shift run would be if arr[pos] became a shift
        let n = 1;
        for (let k = pos - 1; k >= 0          && isShift(arr[k]); k--) n++;
        for (let k = pos + 1; k < arr.length  && isShift(arr[k]); k++) n++;
        return n;
      };
      // Pass 1: constraint-respecting
      for (let i = result.length - 1; i >= 0 && shiftIdx < shiftPool.length; i--) {
        if (!isShift(result[i]) && runLength(result, i) <= consecutiveShifts) {
          result[i] = shiftPool[shiftIdx++];
        }
      }
      // Pass 2: any remaining — best-effort (exact count wins over perfect layout)
      for (let i = result.length - 1; i >= 0 && shiftIdx < shiftPool.length; i--) {
        if (!isShift(result[i])) result[i] = shiftPool[shiftIdx++];
      }
    } else {
      for (let i = result.length - 1; i >= 0 && shiftIdx < shiftPool.length; i--) {
        if (result[i] !== "PD" && result[i] !== "DAY") result[i] = shiftPool[shiftIdx++];
      }
    }

    // ── Final consecutive-constraint enforcement ──────────────────────────────
    // Applied AFTER all placements (including shuffle and forced-shift passes)
    // to fix any remaining runs > C — including cross-segment violations.
    if (consecutiveShifts > 0) {
      const C = consecutiveShifts;
      const isShift = (x: string) => x === "PD" || x === "DAY";
      let safetyIter = 0;
      const maxIter = result.length * 2;          // guard against infinite loop

      outer:
      while (safetyIter++ < maxIter) {
        for (let i = 0; i < result.length; ) {
          if (!isShift(result[i])) { i++; continue; }
          // Measure shift run starting at i
          let runEnd = i;
          while (runEnd < result.length && isShift(result[runEnd])) runEnd++;
          const runLen = runEnd - i;
          if (runLen > C) {
            const breakAt = i + C;   // this is the (C+1)-th shift — must become non-shift
            // Find nearest non-shift: prefer right after the run, then left before it
            let swapAt = -1;
            for (let k = runEnd; k < result.length; k++) {
              if (!isShift(result[k])) { swapAt = k; break; }
            }
            if (swapAt === -1) {
              for (let k = i - 1; k >= 0; k--) {
                if (!isShift(result[k])) { swapAt = k; break; }
              }
            }
            if (swapAt !== -1) {
              [result[breakAt], result[swapAt]] = [result[swapAt], result[breakAt]];
              continue outer;   // restart scan — swapping may have fixed or created other runs
            }
            // No non-shift position available — can't break this run
            i = runEnd;
          } else {
            i = runEnd;
          }
        }
        break; // no violation found this pass — done
      }
    }

    return result.slice(0, totalWeeks);
  }

  // ── Build week-level duty sequences from requirements + pattern ───────────────
  // Each entry in wdSeq is the duty for ALL 5 weekdays of that week.
  // Each entry in weSeq is the duty for BOTH weekend days of that week.
  // The pattern string controls how many shift-duty weeks land in each month segment.
  // ── Weekend consecutive-block builder ────────────────────────────────────────
  // Places `patternNums[s]` CONSECUTIVE weekend shifts inside each month segment.
  // Guarantees no back-to-back weekend across a month boundary.
  // Sat and Sun are treated as a unit — they always share the same duty type.
  function buildWeekendConsecutive(
    totalWeeks: number,
    weekendPD: number,
    weekendDAY: number,
    patternNums: number[],
    doShuffle: boolean
  ): string[] {
    const seq: string[] = Array(totalWeeks).fill("REST");
    const shiftPool = [...Array(weekendPD).fill("PD"), ...Array(weekendDAY).fill("DAY")];
    if (doShuffle) {
      for (let i = shiftPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shiftPool[i], shiftPool[j]] = [shiftPool[j], shiftPool[i]];
      }
    }
    let shiftIdx = 0;
    let prevEndedWithShift = false;

    for (let s = 0; s < patternNums.length; s++) {
      const segStart = Math.floor(s       * totalWeeks / patternNums.length);
      const segEnd   = Math.floor((s + 1) * totalWeeks / patternNums.length);
      const segLen   = segEnd - segStart;
      const numShifts = Math.min(patternNums[s], segLen, shiftPool.length - shiftIdx);

      if (numShifts === 0) { prevEndedWithShift = false; continue; }

      // If previous month ended on its last week with a shift, leave a gap here
      const minStart = prevEndedWithShift ? Math.min(1, segLen - numShifts) : 0;
      const maxStart = segLen - numShifts;

      let blockStart: number;
      if (doShuffle) {
        blockStart = minStart + Math.floor(Math.random() * (maxStart - minStart + 1));
      } else {
        blockStart = minStart; // earliest valid position
      }

      for (let i = 0; i < numShifts && shiftIdx < shiftPool.length; i++) {
        const w = segStart + blockStart + i;
        if (w < totalWeeks) seq[w] = shiftPool[shiftIdx++];
      }

      prevEndedWithShift = (blockStart + numShifts >= segLen);
    }

    // Force any unplaced shifts (when pattern sum < weekendPD+weekendDAY)
    for (let i = seq.length - 1; i >= 0 && shiftIdx < shiftPool.length; i--) {
      if (seq[i] === "REST") seq[i] = shiftPool[shiftIdx++];
    }

    return seq;
  }

  function buildWeekSequences(doShuffle = false) {
    if (!pattern) return null;
    const totalWeeks = pendingTeamCount ?? pattern.teamCount;
    const { weekdayPD, weekdayDAY, weekendPD, weekendDAY } = pattern;

    const DEFAULT_WD = "2,3,2,2,3";
    const DEFAULT_WE = "3,2,2,3,2";
    const wdNums = parseShiftPattern(weekdayPatternStr).length
      ? parseShiftPattern(weekdayPatternStr)
      : parseShiftPattern(DEFAULT_WD);
    const weNums = parseShiftPattern(weekendPatternStr).length
      ? parseShiftPattern(weekendPatternStr)
      : parseShiftPattern(DEFAULT_WE);

    // Parse consecutive shifts — weekday only; clamp 1–8; 0 = no constraint
    const rawC = parseInt(consecutiveShiftsStr, 10);
    const C = (!isNaN(rawC) && rawC >= 1 && rawC <= 8) ? rawC : 0;

    // Weekdays: non-duty weeks are plain ND (no OFF weeks in base pattern)
    const wdSeq = buildPatternSeq(totalWeeks, weekdayPD, weekdayDAY, wdNums, ["ND"], doShuffle, C);

    // Weekends: A,B,C,D = consecutive weekend shifts per month, no cross-month adjacency
    const weekendSeq = buildWeekendConsecutive(totalWeeks, weekendPD, weekendDAY, weNums, doShuffle);

    return { wdSeq, weekendSeq, totalWeeks };
  }

  // ── MOM / PUB HR constraint enforcement ────────────────────────────────────
  // Post-processes the generated weeks to satisfy:
  //   1A. ≤ 7 consecutive working days (PD / DAY / ND all count as working)
  //   1B. OFF before REST within the same calendar week; ≤ 1 REST per week
  //       OFF days inserted into ND weekday slots as needed to break long runs.
  function enforceWorkConstraints(weeks: string[][]): string[][] {
    const result = weeks.map(w => [...w]);
    const isWork = (d: string) => d === "PD" || d === "DAY" || d === "ND";
    let consec = 0;

    for (let w = 0; w < result.length; w++) {
      // Sat (index 5) equals Sun (index 6) in the current model.
      // Pre-check: if the weekend is REST it already provides this week's REST day.
      const wkendIsRest = result[w][5] === "REST";

      for (let d = 0; d < 7; d++) {
        const duty  = result[w][d];
        const isWkd = d < 5;          // weekday slot — the only ones we may modify

        if (isWork(duty) && isWkd && consec >= 7) {
          // Run too long — must insert a break here (applies to PD, DAY, and ND).
          // Look at what breaks have already been placed earlier in this calendar week.
          const priorDays  = result[w].slice(0, d);
          const weekHasOff  = priorDays.includes("OFF");
          const weekHasRest = priorDays.includes("REST") || wkendIsRest;

          if (!weekHasOff) {
            // First break in the week: place OFF (OFF must precede REST)
            result[w][d] = "OFF";
          } else if (!weekHasRest) {
            // Second break: place REST (only 1 REST permitted per week)
            result[w][d] = "REST";
          }
          // If both breaks already exist this week, leave as-is —
          // this can only happen if the generator packed more than 7 consecutive
          // working days into a single calendar week (structurally impossible with
          // the current weekend model, so this is a safety fallback).
          consec = 0;
        } else if (isWork(duty)) {
          consec++;
        } else {
          // OFF or REST — resets the consecutive counter
          consec = 0;
        }
      }
    }

    // ── Pass 2: balance hours — add OFFs to ND weeks until avg ≤ 42 h/week ──
    // Target: totalWorkDays × 8h ÷ numWeeks ≤ 42  →  maxWorkDays = ⌊42n/8⌋
    const numWeeks   = result.length;
    const maxWorkDays = Math.floor(42 * numWeeks / 8);   // 5.25 × numWeeks floored
    const workCount  = () => result.flat().filter(isWork).length;

    let surplus = workCount() - maxWorkDays;
    if (surplus > 0) {
      // Round-robin: one OFF per eligible ND week per pass until balanced.
      // Eligible = first ND weekday slot (Mon→Fri) that has no REST before it
      // in the same calendar week (preserves OFF-before-REST ordering).
      let changed = true;
      while (surplus > 0 && changed) {
        changed = false;
        for (let w = 0; w < numWeeks && surplus > 0; w++) {
          for (let d = 0; d < 5; d++) {
            if (result[w][d] !== "ND") continue;
            const restBefore = result[w].slice(0, d).some(x => x === "REST");
            if (!restBefore) {
              result[w][d] = "OFF";
              surplus--;
              changed = true;
              break;         // one OFF per week per round
            }
          }
        }
      }
    }

    return result;
  }

  function applyWeekSequences(wdSeq: string[], weekendSeq: string[], totalWeeks: number) {
    setPattern(p => {
      if (!p) return p;

      // Weekday expansion: duty weeks → all 5 days that duty type; ND weeks → all ND
      const expandWd = (duty: string): string[] =>
        (duty === "PD" || duty === "DAY") ? Array(5).fill(duty) : Array(5).fill("ND");

      // Weekend: Sat and Sun share the same duty type for the week
      const rawWeeks: string[][] = Array.from({ length: totalWeeks }, (_, w) => [
        ...expandWd(wdSeq[w]),  // Mon–Fri
        weekendSeq[w],          // Sat
        weekendSeq[w],          // Sun (same — whole weekend is one unit)
      ]);

      // Apply MOM / PUB HR constraints: ≤ 7 consecutive working days,
      // OFF before REST, ≤ 1 REST per calendar week.
      const newWeeks = enforceWorkConstraints(rawWeeks);

      // Resize teams: keep existing, add blanks, or trim
      const newTeams = [...p.teams];
      while (newTeams.length < totalWeeks) {
        const slot = newTeams.length + 1;
        newTeams.push({
          slot,
          catchment: "",
          unit: "",
          officers: [blankOfficer(1, `T${slot}`), blankOfficer(2, `T${slot}`)],
        });
      }
      if (newTeams.length > totalWeeks) newTeams.splice(totalWeeks);

      return { ...p, teamCount: totalWeeks, baseWeeks: newWeeks, teams: newTeams };
    });
    setPendingTeamCount(null);
    setIsDirty(true);
  }

  const handleAutoGenerateAll = () => {
    const result = buildWeekSequences(false);
    if (!result) return;
    applyWeekSequences(result.wdSeq, result.weekendSeq, result.totalWeeks);
    toast({ title: "Grid generated", description: `${result.totalWeeks} weeks, requirements applied to every day.` });
  };

  const handleShuffleAll = () => {
    const result = buildWeekSequences(true);
    if (!result) return;
    applyWeekSequences(result.wdSeq, result.weekendSeq, result.totalWeeks);
    toast({ title: "Grid shuffled", description: `${result.totalWeeks} weeks, requirements maintained.` });
  };

  // ── Delete pattern ───────────────────────────────────────────────────────────
  const handleDeletePattern = async () => {
    if (!pattern || pattern.isBuiltIn) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/roster-patterns/${pattern.id}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error ?? "Delete failed");
      }
      toast({ title: "Pattern deleted" });
      setDeleteConfirmOpen(false);
      setPattern(null);
      setIsNew(false);
      setIsDirty(false);
      await fetchPatterns();
    } catch (e: any) {
      toast({ title: e.message ?? "Delete failed", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const handleTeamCountInput = (val: string) => {
    setTeamCountRaw(val);
    const n = parseInt(val, 10);
    if (!isNaN(n) && n > 0) {
      setPendingTeamCount(n);
      // Immediately resize the units list to match
      setPattern(p => {
        if (!p) return p;
        const current = p.teams.slice(0, n);
        while (current.length < n) {
          const slot = current.length + 1;
          current.push({ slot, catchment: "", unit: "", officers: [blankOfficer(1, `t${slot}`), blankOfficer(2, `t${slot}`)] });
        }
        return { ...p, teamCount: n, teams: current };
      });
      setIsDirty(true);
    }
  };

  const handleRegeneratePattern = async () => {
    if (!pattern || !pendingTeamCount) return;
    if (pendingTeamCount % 4 !== 0) {
      toast({ title: "No. of teams must be a multiple of 4", variant: "destructive" });
      return;
    }
    const count = pendingTeamCount;
    setRegenLoading(true);
    try {
      const r = await fetch("/api/roster-patterns/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamCount: count }),
      });
      if (!r.ok) throw new Error();
      const { baseWeeks } = await r.json();
      // Resize teams array to match new teamCount
      const currentTeams = pattern.teams.slice(0, count);
      while (currentTeams.length < count) {
        const slot = currentTeams.length + 1;
        currentTeams.push({
          slot,
          catchment: "",
          unit: `T${slot}`,
          officers: [
            blankOfficer(1, `t${slot}`),
            blankOfficer(2, `t${slot}`),
          ],
        });
      }
      setPattern(p => p ? { ...p, teamCount: count, baseWeeks, teams: currentTeams } : p);
      setPendingTeamCount(null);
      setIsDirty(true);
      toast({ title: `Pattern regenerated for ${count} teams` });
    } catch {
      toast({ title: "Failed to regenerate pattern", variant: "destructive" });
    } finally {
      setRegenLoading(false);
    }
  };

  // ── Team editing ────────────────────────────────────────────────────────────
  const updateTeamField = (slot: number, field: keyof Omit<PatternTeam, "slot" | "officers">, value: string) => {
    setPattern(p => {
      if (!p) return p;
      // For colour: propagate to every team in the same catchment (matching unit-code prefix, e.g. "BU")
      if (field === "color") {
        const srcTeam = p.teams.find(t => t.slot === slot);
        const srcPrefix = srcTeam?.unit?.replace(/\d+$/, "") ?? "";
        return {
          ...p,
          teams: p.teams.map(t => {
            if (t.slot === slot) return { ...t, color: value };
            if (srcPrefix && t.unit?.replace(/\d+$/, "") === srcPrefix) return { ...t, color: value };
            return t;
          }),
        };
      }
      return {
        ...p,
        teams: p.teams.map(t => t.slot === slot ? { ...t, [field]: value } : t),
      };
    });
    setIsDirty(true);
  };

  const updateOfficerField = (slot: number, crewPos: number, field: keyof Omit<PatternOfficer, "id" | "crewPosition">, value: string, newId?: string) => {
    // When the name field is updated, always re-derive the stable ID from the name.
    // newId (from combobox selection) takes priority; manual typing falls back to nameToId.
    const idOverride = newId ?? (field === "name" && value.trim() ? nameToId(value) : undefined);
    setPattern(p => {
      if (!p) return p;
      return {
        ...p,
        teams: p.teams.map(t =>
          t.slot === slot
            ? { ...t, officers: t.officers.map(o => o.crewPosition === crewPos ? { ...o, [field]: value, ...(idOverride ? { id: idOverride } : {}) } : o) }
            : t
        ),
      };
    });
    setIsDirty(true);
  };

  // ── Subcatchment management ──────────────────────────────────────────────────
  const addSubcatchment = () => {
    const id = `sc_${Date.now()}`;
    const color = UNIT_PALETTE[(pattern?.subcatchments?.length ?? 0) % UNIT_PALETTE.length];
    setPattern(p => p ? { ...p, subcatchments: [...(p.subcatchments ?? []), { id, acronym: "", name: "", color }] } : p);
    setIsDirty(true);
  };

  const updateSubcatchment = (id: string, field: keyof Subcatchment, value: string) => {
    setPattern(p => {
      if (!p) return p;
      const subs = (p.subcatchments ?? []).map(s => s.id === id ? { ...s, [field]: value } : s);
      // Propagate colour change to all teams linked to this subcatchment
      if (field === "color") {
        return { ...p, subcatchments: subs, teams: p.teams.map(t => t.subcatchmentId === id ? { ...t, color: value } : t) };
      }
      return { ...p, subcatchments: subs };
    });
    setIsDirty(true);
  };

  const removeSubcatchment = (id: string) => {
    setPattern(p => {
      if (!p) return p;
      return {
        ...p,
        subcatchments: (p.subcatchments ?? []).filter(s => s.id !== id),
        teams: p.teams.map(t => t.subcatchmentId === id ? { ...t, subcatchmentId: undefined } : t),
      };
    });
    setIsDirty(true);
  };

  const setTeamSubcatchment = (slot: number, subcatchmentId: string) => {
    setPattern(p => {
      if (!p) return p;
      const sub = (p.subcatchments ?? []).find(s => s.id === subcatchmentId);
      return {
        ...p,
        teams: p.teams.map(t => t.slot === slot ? {
          ...t,
          subcatchmentId,
          catchment: sub?.name ?? t.catchment,
          color: sub?.color ?? t.color,
        } : t),
      };
    });
    setIsDirty(true);
  };

  const [subcatchmentColorOpen, setSubcatchmentColorOpen] = useState<Set<string>>(new Set());

  // ── Team reordering (▲/▼ — see file header) ─────────────────────────────────
  const reorderTeam = (fromSlot: number, toSlot: number) => {
    if (fromSlot === toSlot) return;
    setPattern(p => {
      if (!p) return p;
      const teams = [...p.teams];
      const fromIdx = teams.findIndex(t => t.slot === fromSlot);
      const toIdx   = teams.findIndex(t => t.slot === toSlot);
      if (fromIdx === -1 || toIdx === -1) return p;
      const [moved] = teams.splice(fromIdx, 1);
      teams.splice(toIdx, 0, moved);
      // Renumber slots 1..N to keep cycle offsets consistent with display order
      return { ...p, teams: teams.map((t, i) => ({ ...t, slot: i + 1 })) };
    });
    setExpandedSlots(new Set()); // slots renumbered — reset expanded state
    setIsDirty(true);
  };

  const moveTeam = (slot: number, dir: -1 | 1) => {
    if (!pattern) return;
    const dstSlot = slot + dir;
    if (dstSlot < 1 || dstSlot > pattern.teams.length) return;
    reorderTeam(slot, dstSlot);
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!pattern) return;
    const name = pattern.name.trim();
    if (!name) {
      toast({ title: "Please enter a pattern name", variant: "destructive" });
      setEditingName(true);
      return;
    }
    setSaving(true);
    try {
      let url = "/api/roster-patterns";
      let method = "POST";
      if (!isNew && pattern.id) {
        url = `/api/roster-patterns/${pattern.id}`;
        method = "PUT";
      }
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pattern),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? "Save failed");
      }
      const saved: FullPattern = await r.json();
      setPattern(saved);
      setIsNew(false);
      setIsDirty(false);
      await fetchPatterns();
      toast({ title: `Pattern "${saved.name}" saved` });
    } catch (e: any) {
      toast({ title: e.message ?? "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Create new blank pattern ─────────────────────────────────────────────────
  const handleCreateNew = () => {
    setDropdownOpen(false);
    const teamCount = 20;
    const blank: FullPattern = {
      id: "",
      name: "New Pattern",
      teamCount,
      weekdayPD: 4,
      weekdayDAY: 8,
      weekendPD: 3,
      weekendDAY: 3,
      isBuiltIn: false,
      baseWeeks: Array.from({ length: teamCount }, () => Array(7).fill("ND")),
      subcatchments: [],
      teams: Array.from({ length: teamCount }, (_, i) => ({
        slot: i + 1,
        catchment: "",
        unit: "",
        officers: [blankOfficer(1, `T${i + 1}`), blankOfficer(2, `T${i + 1}`)],
      })),
    };
    setPattern(blank);
    setIsNew(true);
    setIsDirty(true);
  };

  // ── Duplicate current pattern ─────────────────────────────────────────────────
  const handleDuplicate = () => {
    if (!pattern) return;
    const copy: FullPattern = {
      ...JSON.parse(JSON.stringify(pattern)),
      id: "",
      name: `${pattern.name} (Copy)`,
      isBuiltIn: false,
    };
    setPattern(copy);
    setIsNew(true);
    setIsDirty(true);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  // ── Implement ────────────────────────────────────────────────────────────────
  const handleImplement = async () => {
    if (!pattern) return;
    setImplementing(true);
    setImplResult(null);
    try {
      const id = pattern.id;
      if (!id) {
        toast({ title: "Save the pattern first before implementing", variant: "destructive" });
        setImplDialogOpen(false);
        return;
      }
      const r = await fetch(`/api/roster-patterns/${id}/implement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ implementDate: implDate, implementerName: user?.username ?? "an administrator" }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? "Implement failed");
      }
      const result = await r.json();
      setImplResult({ officersActivated: result.officersActivated, officersDeactivated: result.officersDeactivated });
      bumpVersion(); // other pages cache officers/cycle data — refresh them
      toast({ title: "Pattern implemented successfully!" });
    } catch (e: any) {
      toast({ title: e.message ?? "Implement failed", variant: "destructive" });
      setImplDialogOpen(false);
    } finally {
      setImplementing(false);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────
  const selectedPatternName = patterns.find(p => p.id === pattern?.id)?.name ?? pattern?.name ?? "—";

  if (listLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="max-w-5xl w-full mx-auto px-4 py-6 space-y-6">

        {/* ── Page title ── */}
        <div>
          <h1 className="text-xl font-bold">Roster Builder</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Design and implement duty cycle patterns for the entire roster.
          </p>
        </div>

        <Tabs defaultValue="build" className="w-full">
          <TabsList className="grid grid-cols-2 w-52">
            <TabsTrigger value="build">Build</TabsTrigger>
            <TabsTrigger value="requirements">Requirements</TabsTrigger>
          </TabsList>

          <TabsContent value="build" className="space-y-6 mt-4">
        {/* ─────────────── LINE 1: Pattern selector ─────────────── */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="font-bold text-sm shrink-0 mt-2">Pattern</div>
            <div className="relative flex-1 min-w-[260px]" ref={dropdownRef}>
              <button
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-background text-sm hover:bg-muted transition-colors"
                onClick={() => setDropdownOpen(v => !v)}
              >
                <span className="truncate font-medium">{selectedPatternName}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
              {dropdownOpen && (
                <div className="absolute left-0 top-full mt-1 z-30 w-full rounded-md border bg-popover shadow-lg py-1">
                  {patterns.map(p => (
                    <button
                      key={p.id}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2",
                        p.id === pattern?.id && "bg-muted font-medium"
                      )}
                      onClick={() => { setDropdownOpen(false); loadPattern(p.id); }}
                    >
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.isBuiltIn && (
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">Built-in</span>
                      )}
                    </button>
                  ))}
                  <div className="border-t mt-1 pt-1">
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-primary"
                      onClick={handleCreateNew}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create New Pattern
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Inline name editor */}
            {editingName ? (
              <div className="flex items-center gap-1">
                <Input
                  ref={nameInputRef}
                  value={pattern?.name ?? ""}
                  onChange={e => { setPattern(p => p ? { ...p, name: e.target.value } : p); setIsDirty(true); }}
                  className="h-8 text-sm w-60"
                  placeholder="Pattern name…"
                  onKeyDown={e => { if (e.key === "Enter") setEditingName(false); if (e.key === "Escape") setEditingName(false); }}
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingName(false)}>
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              pattern && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.focus(), 50); }} title="Rename pattern">
                    <PenLine className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleDuplicate} title="Duplicate pattern">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  {!pattern.isBuiltIn && (
                    <Button
                      size="icon" variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteConfirmOpen(true)}
                      title="Delete pattern"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )
            )}
          </div>

          {isDirty && (
            <p className="text-xs text-amber-600 font-medium">
              ⚠ Unsaved changes — click "Save Pattern" below to keep them.
            </p>
          )}
        </div>

        {patternLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!pattern && !patternLoading && (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            No patterns yet. Use the Pattern dropdown above to create one.
          </div>
        )}

        {pattern && !patternLoading && (
          <>
            {/* ─────────────── PATTERN GRID ─────────────── */}
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30">
                <p className="text-sm font-semibold">Base Rotation — Team Slot 1 (all others derive from this by offset)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tap a cell to cycle duty · Use ▲/▼ to move a week
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="w-12 px-2 py-1.5 text-left text-muted-foreground font-semibold bg-muted/20 border-b border-r">Wk</th>
                      {DAYS_LABEL.map((d, i) => (
                        <th key={d} className={cn(
                          "px-2 py-1.5 text-center font-semibold bg-muted/20 border-b border-r",
                          i >= 5 ? "text-blue-600" : "text-foreground"
                        )}>
                          {d}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-center font-semibold bg-muted/20 border-b text-muted-foreground whitespace-nowrap">
                        Hrs
                      </th>
                      <th className="w-14 px-1 py-1.5 text-center font-semibold bg-muted/20 border-b text-muted-foreground whitespace-nowrap">
                        Move
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pattern.baseWeeks.map((week, wi) => {
                      const hrs = weekHours(week);
                      return (
                        <tr
                          key={wi}
                          className={cn(
                            "hover:bg-muted/10",
                            wi % 4 === 0       ? "border-t-2 border-t-foreground/40" : "",
                            (wi + 1) % 4 === 0 ? "border-b-2 border-b-foreground/40" : ""
                          )}
                        >
                          {/* Week label */}
                          <td className={cn(
                            "px-2 py-0.5 text-muted-foreground font-medium border-r text-center border-l-2 border-l-foreground/40 select-none",
                            wi % 4 === 0       ? "border-t-2 border-t-foreground/40" : "",
                            (wi + 1) % 4 === 0 ? "border-b-2 border-b-foreground/40" : ""
                          )}>
                            W{wi + 1}
                          </td>
                          {week.map((duty, di) => (
                            <td key={di}
                              className={cn(
                                "border-r p-0.5",
                                di >= 5 ? "bg-muted/10" : "",
                                di === DAYS_LABEL.length - 1 ? "border-r-2 border-r-foreground/40" : "",
                                wi % 4 === 0       ? "border-t-2 border-t-foreground/40" : "",
                                (wi + 1) % 4 === 0 ? "border-b-2 border-b-foreground/40" : ""
                              )}
                            >
                              <button
                                className={cn(
                                  "w-full rounded px-1 py-0.5 font-semibold border transition-all hover:scale-105 hover:shadow-sm select-none",
                                  DUTY_COLORS[duty] ?? "bg-muted text-foreground border-muted-foreground/20"
                                )}
                                onClick={() => cycleCell(wi, di)}
                                title={`W${wi + 1} ${DAYS_LABEL[di]}: ${duty} — tap to change`}
                              >
                                {duty}
                              </button>
                            </td>
                          ))}
                          <td className={cn(
                            "px-2 py-0.5 text-center font-semibold text-foreground whitespace-nowrap border-r-2 border-r-foreground/40",
                            wi % 4 === 0       ? "border-t-2 border-t-foreground/40" : "",
                            (wi + 1) % 4 === 0 ? "border-b-2 border-b-foreground/40" : ""
                          )}>
                            {hrs}h
                          </td>
                          <td className={cn(
                            "px-1 py-0.5 text-center whitespace-nowrap",
                            wi % 4 === 0       ? "border-t-2 border-t-foreground/40" : "",
                            (wi + 1) % 4 === 0 ? "border-b-2 border-b-foreground/40" : ""
                          )}>
                            <div className="flex flex-col gap-0.5 items-center">
                              <button
                                type="button"
                                className="p-0.5 rounded hover:bg-muted disabled:opacity-25 disabled:cursor-default text-muted-foreground"
                                disabled={wi === 0}
                                onClick={() => moveWeek(wi, -1)}
                                title="Move week up"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                className="p-0.5 rounded hover:bg-muted disabled:opacity-25 disabled:cursor-default text-muted-foreground"
                                disabled={wi === pattern.baseWeeks.length - 1}
                                onClick={() => moveWeek(wi, 1)}
                                title="Move week down"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {(() => {
                      const weeks = pattern.baseWeeks;
                      const totalHrs = weeks.reduce((s, w) => s + weekHours(w), 0);
                      const avgHrs = weeks.length ? (totalHrs / weeks.length) : 0;

                      // Per-duty counts per day column
                      const dutyCounts = DUTY_CYCLE.map(duty =>
                        DAYS_LABEL.map((_, di) =>
                          weeks.reduce((s, w) => s + (w[di] === duty ? 1 : 0), 0)
                        )
                      );
                      const DUTY_COUNT_COLORS: Record<string, string> = {
                        PD:   "text-orange-700 dark:text-orange-400",
                        DAY:  "text-blue-700 dark:text-blue-400",
                        ND:   "text-yellow-700 dark:text-yellow-400",
                        OFF:  "text-green-700 dark:text-green-400",
                        REST: "text-pink-700 dark:text-pink-400",
                      };

                      return (
                        <>
                          {/* Duty count rows */}
                          {DUTY_CYCLE.map((duty, dci) => (
                            <tr key={duty} className={cn(
                              "border-t border-muted-foreground/10",
                              dci === 0 ? "border-t-2 border-muted-foreground/30" : ""
                            )}>
                              <td className={cn("px-2 py-0.5 font-bold border-r text-center text-[10px] uppercase tracking-wide", DUTY_COUNT_COLORS[duty])}>
                                {duty}
                              </td>
                              {dutyCounts[dci].map((count, i) => (
                                <td key={i} className={cn(
                                  "px-2 py-0.5 text-center text-[10px] font-medium border-r",
                                  i >= 5 ? "bg-blue-50 dark:bg-blue-950/20" : "",
                                  count === 0 ? "text-muted-foreground/30" : DUTY_COUNT_COLORS[duty],
                                )}>
                                  {count || "–"}
                                </td>
                              ))}
                              <td className={cn("px-2 py-0.5 text-center text-[10px] font-semibold", DUTY_COUNT_COLORS[duty])}>
                                {dutyCounts[dci].reduce((a, b) => a + b, 0)}
                              </td>
                              <td />
                            </tr>
                          ))}

                          <tr className="border-t-2 border-muted-foreground/20">
                            <td colSpan={8} className="px-2 py-1 text-right text-[10px] text-muted-foreground font-semibold pr-3">
                              Avg/wk
                            </td>
                            <td className="px-2 py-1 text-center font-bold text-primary text-[11px] whitespace-nowrap">
                              {avgHrs % 1 === 0 ? avgHrs : avgHrs.toFixed(1)}h
                            </td>
                            <td />
                          </tr>
                        </>
                      );
                    })()}
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ─────────────── GENERATE / SHUFFLE BUTTONS ─────────────── */}
            {(() => {
              const canGenerate = (pattern.weekdayPD > 0 || pattern.weekdayDAY > 0) &&
                                  (pattern.weekendPD > 0 || pattern.weekendDAY > 0);
              return (
                <div className="flex gap-2">
                  <Button
                    onClick={handleAutoGenerateAll}
                    disabled={!canGenerate}
                    className="flex-1 gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Auto Generate
                  </Button>
                  <Button
                    onClick={handleShuffleAll}
                    disabled={!canGenerate}
                    className="flex-1 gap-2"
                  >
                    <Shuffle className="h-4 w-4" />
                    Shuffle
                  </Button>
                </div>
              );
            })()}

            {/* ─────────────── REQUIREMENTS (pattern-level PD/DAY counts) ─────────────── */}
            <div className="rounded-lg border bg-card p-4 space-y-4">
              <h2 className="font-bold text-sm">Requirements</h2>

              {/* Team count */}
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="font-bold text-sm shrink-0">No. of teams</label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={teamCountRaw}
                    onFocus={e => e.target.select()}
                    onChange={e => handleTeamCountInput(e.target.value.replace(/[^0-9]/g, ""))}
                    onBlur={() => setTeamCountRaw(String(pattern?.teamCount ?? ""))}
                    className="h-8 w-24 text-sm"
                  />
                  <span className="text-[11px] text-muted-foreground">(in multiples of 4)</span>
                  {pendingTeamCount != null && pendingTeamCount !== pattern.teamCount && (
                    <Button size="sm" variant="outline" onClick={handleRegeneratePattern} disabled={regenLoading} className="gap-1.5 h-7 text-xs">
                      {regenLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Regenerate base pattern for {pendingTeamCount} teams
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Weekday */}
                <div className="space-y-2 rounded-md border p-3 bg-muted/10">
                  <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider text-xs">Weekday</p>
                  <div className="flex items-center gap-3">
                    <label className="font-bold text-sm w-24 shrink-0">No. of PD</label>
                    <Input
                      type="text" inputMode="numeric" pattern="[0-9]*"
                      value={wdPDRaw}
                      onFocus={e => e.target.select()}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        setWdPDRaw(raw);
                        const n = parseInt(raw, 10);
                        if (!isNaN(n)) updateReq("weekdayPD", n);
                      }}
                      onBlur={() => setWdPDRaw(String(pattern.weekdayPD))}
                      className="h-8 w-20 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="font-bold text-sm w-24 shrink-0">No. of DAY</label>
                    <Input
                      type="text" inputMode="numeric" pattern="[0-9]*"
                      value={wdDAYRaw}
                      onFocus={e => e.target.select()}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        setWdDAYRaw(raw);
                        const n = parseInt(raw, 10);
                        if (!isNaN(n)) updateReq("weekdayDAY", n);
                      }}
                      onBlur={() => setWdDAYRaw(String(pattern.weekdayDAY))}
                      className="h-8 w-20 text-sm"
                    />
                  </div>
                  {/* Auto-computed: min shifts per month for weekday */}
                  {(() => {
                    const teams = pendingTeamCount ?? pattern.teamCount;
                    const months = teams > 0 ? teams / 4 : 0;
                    const total = pattern.weekdayPD + pattern.weekdayDAY;
                    if (!months || !total) return null;
                    const val = total / months;
                    const lo = Math.floor(val), hi = Math.ceil(val);
                    const countHi = Math.round(total - lo * months);
                    const countLo = Math.round(months - countHi);
                    return (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground block">Min no. of weekday shift week per month</span>
                        <div className="space-y-0.5">
                          {lo === hi ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center justify-center w-8 h-7 rounded border bg-muted/40 text-sm font-semibold text-primary">{lo}</span>
                              <span className="text-xs text-muted-foreground">× {months} months</span>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center justify-center w-8 h-7 rounded border bg-muted/40 text-sm font-semibold text-primary">{lo}</span>
                                <span className="text-xs text-muted-foreground">× {countLo} {countLo === 1 ? "month" : "months"}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center justify-center w-8 h-7 rounded border bg-muted/40 text-sm font-semibold text-primary">{hi}</span>
                                <span className="text-xs text-muted-foreground">× {countHi} {countHi === 1 ? "month" : "months"}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="pt-1 border-t space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      Pattern <span className="font-normal text-muted-foreground/60">(optional)</span>
                      <span className="text-[10px] font-normal text-muted-foreground/70">(no. of shift duties a month)</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={weekdayPatternStr}
                        onChange={e => {
                          setWeekdayPatternStr(e.target.value);
                          setPattern(p => p ? { ...p, weekdayPattern: e.target.value } : p);
                          setIsDirty(true);
                        }}
                        className="h-8 text-sm font-mono"
                        placeholder="e.g. 2,3,2,2,3 (optional)"
                      />
                      <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs px-2" onClick={handleAutoGenerateWeekday}>
                        Apply
                      </Button>
                    </div>
                  </div>
                  <div className="pt-1 border-t space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground flex flex-col gap-0.5">
                      <span>Consecutive shifts <span className="font-normal text-muted-foreground/60">(optional)</span></span>
                      <span className="text-[10px] font-normal text-muted-foreground/70">(max duty weeks back-to-back before ND week)</span>
                    </label>
                    <Input
                      type="number" min={1} max={10}
                      value={consecutiveShiftsStr}
                      onChange={e => {
                        setConsecutiveShiftsStr(e.target.value);
                        const n = parseInt(e.target.value, 10);
                        setPattern(p => p ? { ...p, consecutiveShifts: isNaN(n) ? undefined : n } : p);
                        setIsDirty(true);
                      }}
                      className="h-8 w-24 text-sm"
                      placeholder="3"
                    />
                  </div>
                </div>
                {/* Weekend */}
                <div className="space-y-2 rounded-md border p-3 bg-muted/10">
                  <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider text-xs">Weekend</p>
                  <div className="flex items-center gap-3">
                    <label className="font-bold text-sm w-24 shrink-0">No. of PD</label>
                    <Input
                      type="text" inputMode="numeric" pattern="[0-9]*"
                      value={wePDRaw}
                      onFocus={e => e.target.select()}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        setWePDRaw(raw);
                        const n = parseInt(raw, 10);
                        if (!isNaN(n)) updateReq("weekendPD", n);
                      }}
                      onBlur={() => setWePDRaw(String(pattern.weekendPD))}
                      className="h-8 w-20 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="font-bold text-sm w-24 shrink-0">No. of DAY</label>
                    <Input
                      type="text" inputMode="numeric" pattern="[0-9]*"
                      value={weDAYRaw}
                      onFocus={e => e.target.select()}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        setWeDAYRaw(raw);
                        const n = parseInt(raw, 10);
                        if (!isNaN(n)) updateReq("weekendDAY", n);
                      }}
                      onBlur={() => setWeDAYRaw(String(pattern.weekendDAY))}
                      className="h-8 w-20 text-sm"
                    />
                  </div>
                  {/* Auto-computed: min shifts per month for weekend */}
                  {(() => {
                    const teams = pendingTeamCount ?? pattern.teamCount;
                    const months = teams > 0 ? teams / 4 : 0;
                    const total = pattern.weekendPD + pattern.weekendDAY;
                    if (!months || !total) return null;
                    const val = 2 * total / months;
                    const lo = Math.floor(val), hi = Math.ceil(val);
                    const countHi = Math.round(2 * total - lo * months);
                    const countLo = Math.round(months - countHi);
                    return (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground block">Min no. of weekend shift week per month</span>
                        <div className="space-y-0.5">
                          {lo === hi ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center justify-center w-8 h-7 rounded border bg-muted/40 text-sm font-semibold text-primary">{lo}</span>
                              <span className="text-xs text-muted-foreground">× {months} months</span>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center justify-center w-8 h-7 rounded border bg-muted/40 text-sm font-semibold text-primary">{lo}</span>
                                <span className="text-xs text-muted-foreground">× {countLo} {countLo === 1 ? "month" : "months"}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center justify-center w-8 h-7 rounded border bg-muted/40 text-sm font-semibold text-primary">{hi}</span>
                                <span className="text-xs text-muted-foreground">× {countHi} {countHi === 1 ? "month" : "months"}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="pt-1 border-t space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      Pattern <span className="font-normal text-muted-foreground/60">(optional)</span>
                      <span className="text-[10px] font-normal text-muted-foreground/70">(no. of consecutive weekend shifts a month)</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={weekendPatternStr}
                        onChange={e => {
                          setWeekendPatternStr(e.target.value);
                          setPattern(p => p ? { ...p, weekendPattern: e.target.value } : p);
                          setIsDirty(true);
                        }}
                        className="h-8 text-sm font-mono"
                        placeholder="e.g. 3,2,2,3,2 (optional)"
                      />
                      <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs px-2" onClick={handleAutoGenerateWeekend}>
                        Apply
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ─── Avg weekly hours over cycle (live — counts actual grid cells) ─── */}
              {(() => {
                const teams = pendingTeamCount ?? pattern.teamCount;
                if (!teams) return null;
                const workDays = (pattern.baseWeeks ?? []).flat()
                  .filter(d => d === "PD" || d === "DAY" || d === "ND").length;
                const avgHrs = (workDays * 8) / teams;
                return (
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm bg-muted/10">
                    <span className="font-medium text-muted-foreground">Avg weekly hours (over cycle)</span>
                    <span className="font-bold tabular-nums text-foreground">
                      {avgHrs % 1 === 0 ? avgHrs : avgHrs.toFixed(1)} h / week
                    </span>
                  </div>
                );
              })()}

            </div>

            {/* ─────────────── CATCHMENTS ─────────────── */}
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Catchments</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Define catchment groups and their colours. Units below are assigned to these catchments.</p>
                </div>
                <Button size="sm" variant="outline" onClick={addSubcatchment} className="gap-1.5 shrink-0">
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              {(pattern.subcatchments ?? []).length === 0 ? (
                <div className="px-4 py-5 text-center text-xs text-muted-foreground italic">
                  No catchments yet. Press Add to create one.
                </div>
              ) : (
                <div className="divide-y">
                  {(pattern.subcatchments ?? []).map(sub => (
                    <div key={sub.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setSubcatchmentColorOpen(prev => {
                            const next = new Set(prev);
                            next.has(sub.id) ? next.delete(sub.id) : next.add(sub.id);
                            return next;
                          });
                        }}
                        className="h-7 w-7 rounded border-2 border-white shadow-sm ring-1 ring-gray-300 transition-transform hover:scale-110 shrink-0"
                        style={{ backgroundColor: sub.color || "#94a3b8" }}
                        title="Pick colour"
                      />
                      <Input
                        value={sub.acronym ?? ""}
                        onChange={e => updateSubcatchment(sub.id, "acronym", e.target.value)}
                        className="h-7 text-xs font-bold w-14 shrink-0 uppercase"
                        placeholder="BU"
                        maxLength={4}
                      />
                      <div className="flex-1 min-w-[100px] space-y-1">
                        <Input
                          value={sub.name}
                          onChange={e => updateSubcatchment(sub.id, "name", e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Full name (e.g. Bukit Timah Urban)"
                        />
                        {subcatchmentColorOpen.has(sub.id) && (
                          <div className="p-2 rounded-lg border bg-card shadow-md w-fit">
                            <div className="grid grid-cols-10 gap-1">
                              {UNIT_PALETTE.map(hex => (
                                <button
                                  key={hex}
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    updateSubcatchment(sub.id, "color", hex);
                                    setSubcatchmentColorOpen(prev => {
                                      const next = new Set(prev);
                                      next.delete(sub.id);
                                      return next;
                                    });
                                  }}
                                  className={cn(
                                    "h-6 w-6 rounded border-2 transition-transform hover:scale-110",
                                    sub.color === hex ? "border-gray-800 scale-110" : "border-transparent"
                                  )}
                                  style={{ backgroundColor: hex }}
                                  title={hex}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <Input
                        value={sub.color || ""}
                        onChange={e => {
                          let v = e.target.value;
                          if (v && !v.startsWith("#")) v = "#" + v;
                          updateSubcatchment(sub.id, "color", v);
                        }}
                        className="h-7 text-xs font-mono w-24 shrink-0"
                        placeholder="#94a3b8"
                        maxLength={7}
                      />
                      <button
                        type="button"
                        onClick={() => removeSubcatchment(sub.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ─────────────── TEAM ROSTER ─────────────── */}
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Units — {pendingTeamCount ?? pattern.teamCount} units</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Assign each unit to a catchment, pick a unit number, and enter the two officer names.</p>
                </div>
              </div>

              <div className="divide-y">
                {pattern.teams.map(team => {
                  const expanded = expandedSlots.has(team.slot);
                  return (
                    <div key={team.slot}>
                      {/* Team header row — ▲/▼ reorder + expand button */}
                      <div className="flex items-stretch">
                        <div className="flex flex-col justify-center gap-0.5 px-1.5 shrink-0">
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-25 disabled:cursor-default text-muted-foreground"
                            disabled={team.slot === 1}
                            onClick={() => moveTeam(team.slot, -1)}
                            title="Move unit up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-25 disabled:cursor-default text-muted-foreground"
                            disabled={team.slot === pattern.teams.length}
                            onClick={() => moveTeam(team.slot, 1)}
                            title="Move unit down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {/* Expand / collapse button */}
                        <button
                          className="flex-1 flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
                          onClick={() => setExpandedSlots(prev => {
                            const next = new Set(prev);
                            if (next.has(team.slot)) next.delete(team.slot); else next.add(team.slot);
                            return next;
                          })}
                        >
                        <span className={cn(
                          "text-[10px] font-bold w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                          "bg-primary/10 text-primary"
                        )}>
                          {team.slot}
                        </span>
                        <div className="flex-1 min-w-0 flex items-center gap-3">
                          {(() => {
                            const sub = (pattern.subcatchments ?? []).find(s => s.id === team.subcatchmentId);
                            // Strip any leading letters from legacy unit values like "BU1" → "1"
                            const unitNum = team.unit?.replace(/^[A-Za-z]+/, "") || "";
                            const title = sub?.acronym && unitNum ? `${sub.acronym}${unitNum}` : null;
                            return title ? (
                              <span
                                className="font-bold text-sm px-2 py-0.5 rounded text-gray-800"
                                style={{ backgroundColor: sub?.color || undefined }}
                              >
                                {title}
                              </span>
                            ) : (
                              <span className="text-muted-foreground italic text-sm">Select catchment &amp; unit</span>
                            );
                          })()}
                          <span className="text-xs text-muted-foreground truncate">
                            {team.officers.filter(o => o.name).map(o => o.name).join(" / ")}
                          </span>
                        </div>
                          {expanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                        </button>
                      </div>{/* end flex header row */}

                      {/* Expanded editor */}
                      {expanded && (
                        <div className="px-4 pb-3 pt-1 bg-muted/10 space-y-3">
                          {/* Catchment + Unit Number */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-muted-foreground">Catchment</label>
                              {(pattern.subcatchments ?? []).length > 0 ? (
                                <select
                                  value={team.subcatchmentId ?? ""}
                                  onChange={e => {
                                    if (e.target.value) setTeamSubcatchment(team.slot, e.target.value);
                                    else updateTeamField(team.slot, "catchment", "");
                                  }}
                                  className="h-7 text-xs w-full rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  <option value="">— select —</option>
                                  {(pattern.subcatchments ?? []).map(s => (
                                    <option key={s.id} value={s.id}>
                                      {s.acronym ? `${s.acronym} — ${s.name || "(unnamed)"}` : s.name || "(unnamed)"}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <Input
                                  value={team.catchment}
                                  onChange={e => updateTeamField(team.slot, "catchment", e.target.value)}
                                  className="h-7 text-xs"
                                  placeholder="e.g. Bukit Timah"
                                />
                              )}
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-muted-foreground">Unit No.</label>
                              <select
                                value={team.unit}
                                onChange={e => updateTeamField(team.slot, "unit", e.target.value)}
                                className="h-7 text-xs w-full rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                              >
                                <option value="">— select —</option>
                                {Array.from({ length: 9 }, (_, i) => i + 1).map(n => (
                                  <option key={n} value={String(n)}>{n}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Officers — exactly 2 name fields with combobox search */}
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground">
                              Officers <span className="font-normal text-muted-foreground/60">(search or type new name)</span>
                            </p>
                            {team.officers.slice(0, 2).map((officer, idx) => (
                              <div key={officer.crewPosition} className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground w-4 shrink-0">{idx + 1}.</span>
                                <OfficerCombobox
                                  value={officer.name}
                                  onChange={(name, officerId) => updateOfficerField(team.slot, officer.crewPosition, "name", name, officerId)}
                                  officers={systemOfficers}
                                  placeholder={`Officer ${idx + 1} name`}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* bottom spacer — no Add New Unit button */}
                <div className="px-4 py-2 border-t">
                  <p className="text-[10px] text-muted-foreground italic">Units are generated automatically from No. of teams above.</p>
                </div>
              </div>
            </div>

            {/* ─────────────── ACTION BUTTONS ─────────────── */}
            <div className="flex items-center gap-3 flex-wrap pb-4">
              <Button
                onClick={handleSave}
                disabled={saving || (!isDirty && !isNew)}
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Pattern
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!pattern.id) {
                    toast({ title: "Save the pattern first before implementing", variant: "destructive" });
                    return;
                  }
                  if (isDirty) {
                    toast({ title: "Save your changes before implementing", variant: "destructive" });
                    return;
                  }
                  setImplDate(getNextMonday());
                  setImplResult(null);
                  setImplConfirmText("");
                  setImplDialogOpen(true);
                }}
                className="gap-2"
              >
                <Zap className="h-4 w-4" />
                Implement Pattern
              </Button>
              {!pattern.isBuiltIn && pattern.id && (
                <Button
                  variant="ghost"
                  className="gap-2 text-destructive hover:text-destructive ml-auto"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Pattern
                </Button>
              )}
            </div>
          </>
        )}
          </TabsContent>

          <TabsContent value="requirements" className="mt-4">
            <RosterRequirements />
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm" aria-describedby="del-desc">
          <DialogHeader>
            <DialogTitle>Delete Pattern</DialogTitle>
            <DialogDescription id="del-desc">
              This will permanently delete <strong>{pattern?.name}</strong>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeletePattern} disabled={deleting} className="gap-2">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────── IMPLEMENT DIALOG ─────────────── */}
      <Dialog open={implDialogOpen} onOpenChange={v => { setImplDialogOpen(v); if (!v) { setImplResult(null); setImplConfirmText(""); } }}>
        <DialogContent className="max-w-md" aria-describedby="impl-desc">
          <DialogHeader>
            <DialogTitle>Implement Pattern</DialogTitle>
            <DialogDescription id="impl-desc">
              Choose a start date. All roster duties from that date onwards will be replaced.
            </DialogDescription>
          </DialogHeader>

          {!implResult ? (
            <div className="space-y-4">
              <div className="rounded-md border bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 p-3 text-sm space-y-1">
                <p className="font-semibold">⚠ This action will:</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>Replace roster duties from the chosen date onwards</li>
                  <li>Remove overrides, manual swaps, and day adjustments from that date</li>
                  <li>Keep every existing leave record untouched, regardless of whether the officer stays in the new roster</li>
                  <li>Deactivate (not delete) officers no longer in the new pattern — their history stays intact and they remain reactivatable from the Officers page</li>
                  <li>Send a notification to all crew and managers</li>
                </ul>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-semibold">Implement from date</label>
                <Input
                  type="date"
                  value={implDate}
                  onChange={e => setImplDate(e.target.value)}
                  className="h-9 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  The cycle will start from this date. It is recommended to use a Monday.
                </p>
              </div>

              <p className="text-sm font-semibold">
                Pattern: <span className="text-primary">{pattern?.name}</span>
              </p>

              <div className="space-y-1">
                <label className="text-sm font-semibold">
                  Type <span className="font-mono text-destructive">IMPLEMENT</span> to confirm
                </label>
                <Input
                  value={implConfirmText}
                  onChange={e => setImplConfirmText(e.target.value)}
                  className="h-9 text-sm font-mono"
                  placeholder="IMPLEMENT"
                  autoComplete="off"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200 p-3 text-sm space-y-1">
                <p className="font-semibold">✓ Pattern implemented successfully!</p>
                <p className="text-xs">{implResult.officersActivated} officer(s) activated in the new roster.</p>
                {implResult.officersDeactivated > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {implResult.officersDeactivated} officer(s) deactivated (no longer in the new pattern) — their history and leave records are preserved.
                  </p>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                The new pattern is now active from <strong>{implDate}</strong>. The old patterns are preserved in the Roster Builder for future reference.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setImplDialogOpen(false); setImplResult(null); }}>
              {implResult ? "Close" : "Cancel"}
            </Button>
            {!implResult && (
              <Button
                variant="destructive"
                onClick={handleImplement}
                disabled={implementing || !implDate || implConfirmText !== "IMPLEMENT"}
                className="gap-2"
              >
                {implementing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Confirm — Implement from {implDate}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Requirements rich-text renderer ───────────────────────────────────────────
// Same inline markers as PH FAQ:  "..."  → <strong>  |  _..._  → <em>
function renderRequirementsText(raw: string): React.ReactNode {
  if (!raw) return null;
  const lines = raw.split("\n");
  return lines.map((line, li) => {
    const parts: React.ReactNode[] = [];
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

// ── Requirements Tab ──────────────────────────────────────────────────────────
function RosterRequirements() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "manager" || user?.role === "ic";

  const [text, setText] = useState("");
  const [editText, setEditText] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; loginRequired?: boolean } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadText = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/roster-requirements");
      const data = res.ok ? await res.json() : {};
      setText(data.text ?? "");
    } catch {
      setText("Failed to load requirements.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadText(); }, [loadText]);

  const handleEdit = () => { setEditText(text); setEditing(true); setMsg(null); };
  const handleCancel = () => { setEditing(false); setMsg(null); };

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("/api/roster-requirements", {
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
      setMsg({ ok: true, text: "Requirements saved." });
    } catch {
      setMsg({ ok: false, text: "Save failed. Please try again." });
    } finally { setSaving(false); }
  };

  const wrapSelection = (open: string, close: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.slice(s, e);
    const wrapped = `${open}${selected || "text"}${close}`;
    const next = value.slice(0, s) + wrapped + value.slice(e);
    setEditText(next);
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
            className="min-h-[500px] text-sm font-mono leading-relaxed rounded-t-none border-t-0"
            value={editText}
            onChange={e => setEditText(e.target.value)}
          />

          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2">
            <p className="text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Changes are not saved until you press <strong>Save</strong>.
            </p>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                <XIcon className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save
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
                Edit Requirements
              </Button>
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground bg-muted/40 rounded-lg p-5 border">
            {text ? renderRequirementsText(text) : <span className="text-muted-foreground">No requirements content yet.</span>}
          </div>
        </>
      )}

    </div>
  );
}
