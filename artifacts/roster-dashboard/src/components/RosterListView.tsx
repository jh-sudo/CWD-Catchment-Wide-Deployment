import React, { useMemo, useState } from "react";
import { parseISO } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getContrastColor } from "@/lib/contrast";

const DUTY_COLORS: Record<string, string> = {
  PD:   "bg-[#FDD9BB] text-orange-900 border-[#FDD9BB]",
  DAY:  "bg-[#D3E6F5] text-blue-900 border-[#D3E6F5]",
  ND:   "bg-[#FDFCCC] text-yellow-900 border-[#FDFCCC]",
  OFF:  "bg-[#A7FBC1] text-green-900 border-[#A7FBC1]",
  REST: "bg-[#F5C7F5] text-pink-900 border-[#F5C7F5]",
};

export const CATCHMENT_ORDER = [
  "Bukit Timah & Urban",
  "Jurong & Pandan",
  "Kranji & Woodlands",
  "Changi & Punggol",
  "Kallang & Geylang",
];

export const CATCHMENT_CODE: Record<string, string> = {
  "Bukit Timah & Urban": "BU",
  "Jurong & Pandan":     "PJ",
  "Kranji & Woodlands":  "WK",
  "Changi & Punggol":    "CP",
  "Kallang & Geylang":   "KG",
};

export const CATCHMENT_BG: Record<string, string> = {
  BU: "#FFFFCC",
  PJ: "#EDEDED",
  WK: "#FCE4D6",
  CP: "#E2EFDA",
  KG: "#DDEBF7",
};

export interface RosterOfficer {
  id: string;
  name: string;
  unitCode: string;
  catchment: string;
  crewPosition: number;
  vehicle?: string;
}

interface Props {
  officers: RosterOfficer[];
  /** actual duty (override or cycle-computed) */
  dutyMap: Record<string, string>;
  /** Excel target duty (original scheduled shift) */
  targetDutyMap?: Record<string, string>;
  /** unit the officer is cross-posted to (absent from home unit) */
  crossPostMap?: Record<string, string>;
  /** IC-approved leave types */
  leaveMap: Record<string, string>;
  /** name of officer covering this officer's slot */
  coveringMap?: Record<string, string>;
  /** officers who are covering someone else (covering officer ID → true) */
  coverForMap?: Record<string, boolean>;
  /** officer ID → name of the officer they swapped duties with */
  swapMap?: Record<string, string>;
  /** ISO date string for strength calculation (e.g. "2026-06-05") */
  date?: string;
  /** override vehicle plate per officer ID — takes priority over officer record vehicle */
  vehicleMap?: Record<string, string>;
  /** hide the built-in strength bar (when parent renders its own frozen strip) */
  hideStrengthBar?: boolean;
  /** externally-controlled duty filter — if provided, parent owns the state */
  filterDuty?: Set<string>;
  /** called when a duty badge is toggled (only used when filterDuty is provided) */
  onFilterDutyChange?: (next: Set<string>) => void;
}

export function groupOfficers(officers: RosterOfficer[]) {
  const byUnit: Record<string, RosterOfficer[]> = {};
  for (const o of officers) {
    const key = `${o.catchment}|||${o.unitCode}`;
    if (!byUnit[key]) byUnit[key] = [];
    byUnit[key].push(o);
  }
  for (const key in byUnit) byUnit[key].sort((a, b) => a.crewPosition - b.crewPosition);
  return CATCHMENT_ORDER.map(catchment => {
    const code = CATCHMENT_CODE[catchment] ?? "";
    const units = Object.entries(byUnit)
      .filter(([k]) => k.startsWith(catchment + "|||"))
      .map(([k, list]) => ({ unitCode: k.split("|||")[1], list }))
      .sort((a, b) => a.unitCode.localeCompare(b.unitCode));
    return { catchment, code, units };
  }).filter(g => g.units.length > 0);
}

export const ABSENT_DUTIES = new Set([
  "VL","SL","MC","CCL","FCL","PL","SPL","UL","ML","BL","C","CSL",
  "SLWOMC","AMC","AMMA","AMTO","PMTO","C/PMTO","NS","PPTW","TO","OVL",
]);

const SHIFT_DUTIES = new Set(["ND", "DAY", "PD"]);

function absenceBracket(duty: string, onLeave: boolean, leaveType: string, crossPosted: boolean): string {
  if (onLeave)             return leaveType;   // IC-approved leave code e.g. VL
  if (duty === "OVL")      return "cvg";       // doing overtime elsewhere
  if (crossPosted)         return "cvg";       // physically at another unit
  if (ABSENT_DUTIES.has(duty)) return duty;    // course, PPTW, SL, etc.
  return "cvg";
}

const FILTERABLE_DUTIES = ["ND", "DAY", "PD"] as const;

export function RosterListView({
  officers,
  dutyMap,
  targetDutyMap = {},
  crossPostMap = {},
  leaveMap,
  coveringMap = {},
  coverForMap = {},
  swapMap = {},
  date,
  vehicleMap = {},
  hideStrengthBar = false,
  filterDuty,
  onFilterDutyChange,
}: Props) {
  // Internal filter state — used when parent doesn't control it
  const [localFilter, setLocalFilter] = useState<Set<string>>(new Set());
  const activeFilter: Set<string> = filterDuty ?? localFilter;

  const toggleDuty = (duty: string) => {
    const next = new Set(activeFilter);
    if (next.has(duty)) next.delete(duty); else next.add(duty);
    if (filterDuty !== undefined) {
      onFilterDutyChange?.(next);
    } else {
      setLocalFilter(next);
    }
  };

  const isFiltering = activeFilter.size > 0;

  const grouped = useMemo(() => groupOfficers(officers), [officers]);

  // ── Name → unit lookup (for bracket display on covering officers) ─────────────
  const nameToUnitMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const o of officers) m[o.name.trim().toLowerCase()] = o.unitCode;
    return m;
  }, [officers]);

  // ── Reverse covering map: covering officer name (lower) → unit they're covering at ──
  // Enables showing [KG2] on Rizdwan in KG3's row when he covers Nasri (KG2).
  const coveredAtUnitByName = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const o of officers) {
      const coverName = coveringMap[o.id];
      if (coverName) m[coverName.trim().toLowerCase()] = o.unitCode;
    }
    return m;
  }, [officers, coveringMap]);

  // ── Cross-post incoming map ────────────────────────────────────────────────────
  // Officers cross-posted away appear as [cvg] at home; build a per-unit list of
  // { name, crewPos, fromUnit } so we can render each covering officer BESIDE the
  // specific home officer they're covering (matched by crew position) and show
  // their home unit code in brackets, e.g. "Adino [KG3]".
  const crossPostInMap = useMemo<Record<string, { name: string; crewPos: number; fromUnit: string; duty: string }[]>>(() => {
    const inMap: Record<string, { name: string; crewPos: number; fromUnit: string; duty: string }[]> = {};
    for (const o of officers) {
      const dest = crossPostMap[o.id];
      if (!dest) continue;
      if (!inMap[dest]) inMap[dest] = [];
      inMap[dest].push({ name: o.name, crewPos: o.crewPosition, fromUnit: o.unitCode, duty: dutyMap[o.id] ?? "" });
    }
    return inMap;
  }, [officers, crossPostMap, dutyMap]);

  // ── Auto-redirect ─────────────────────────────────────────────────────────────
  // When an officer's slot is already covered (coveringMap[o.id] set) but the officer
  // has NO recorded absence, they are surplus at their unit → auto-redirect them to the
  // covering officer's home unit (which now has a vacancy because that officer left).
  const { autoRedirectOutMap, autoRedirectInMap } = useMemo(() => {
    const nameToUnit: Record<string, string> = {};
    for (const o of officers) nameToUnit[o.name.trim().toLowerCase()] = o.unitCode;

    const outMap: Record<string, string> = {};   // officerId → destUnitCode
    const inMap:  Record<string, string[]> = {}; // unitCode  → [officerName, ...]

    for (const o of officers) {
      const coveringName = coveringMap[o.id];
      if (!coveringName) continue;
      const onLeave = !!leaveMap[o.id];
      const duty    = dutyMap[o.id] ?? "";
      const alreadyAbsent = onLeave || ABSENT_DUTIES.has(duty)
        || !!crossPostMap[o.id] || !!coverForMap[o.id] || !!swapMap[o.id];
      if (alreadyAbsent) continue;                          // normal absence, not surplus
      const destUnit = nameToUnit[coveringName.trim().toLowerCase()];
      if (!destUnit || destUnit === o.unitCode) continue;   // same unit or unknown
      outMap[o.id] = destUnit;
      if (!inMap[destUnit]) inMap[destUnit] = [];
      inMap[destUnit].push(o.name);
    }
    return { autoRedirectOutMap: outMap, autoRedirectInMap: inMap };
  }, [officers, coveringMap, leaveMap, dutyMap, crossPostMap, coverForMap, swapMap]);

  // ── Strength bar ─────────────────────────────────────────────────────────────
  const { ndCount, dayCount, pdCount, minimum, isWeekend } = useMemo(() => {
    let nd = 0, day = 0, pd = 0;
    for (const o of officers) {
      if (leaveMap[o.id]) continue;                  // on leave
      const duty = dutyMap[o.id] ?? "";
      if (ABSENT_DUTIES.has(duty)) continue;         // absent
      if (duty === "ND")  nd++;
      if (duty === "DAY") day++;
      if (duty === "PD")  pd++;
    }
    let weekend = false;
    if (date) {
      try {
        const d = parseISO(date);
        const dow = d.getDay(); // 0=Sun 6=Sat in local time; use UTC
        const utc = new Date(date + "T00:00:00Z").getUTCDay();
        weekend = utc === 0 || utc === 6;
        void dow;
      } catch { /* ignore */ }
    }
    const min = weekend ? 12 : 24;
    return { ndCount: nd, dayCount: day, pdCount: pd, minimum: min, isWeekend: weekend };
  }, [officers, dutyMap, leaveMap, date]);

  const totalStrength = ndCount + dayCount + pdCount;
  const strengthOk = totalStrength >= minimum;

  if (grouped.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm py-16">
        No roster data found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Strength bar ── */}
      {!hideStrengthBar && date && (
        <div className={cn(
          "rounded-lg border px-3 py-2 flex items-center justify-between gap-3",
          strengthOk
            ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
            : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
        )}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "text-xs font-bold",
              strengthOk ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
            )}>
              Strength: {totalStrength} / {minimum}
            </span>
            <span className="text-muted-foreground text-[11px]">
              ({isWeekend ? "Weekend" : "Weekday"} min)
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium shrink-0">
            {(["ND", "DAY", "PD"] as const).map(d => {
              const count = d === "ND" ? ndCount : d === "DAY" ? dayCount : pdCount;
              const baseCls = d === "ND"
                ? "bg-[#FDFCCC] text-yellow-900 border-yellow-200"
                : d === "DAY"
                  ? "bg-[#D3E6F5] text-blue-900 border-blue-200"
                  : "bg-[#FDD9BB] text-orange-900 border-orange-200";
              const isActive = activeFilter.has(d);
              return (
                <button
                  key={d}
                  onClick={() => toggleDuty(d)}
                  className={cn(
                    "rounded px-1.5 py-0.5 border transition-all",
                    baseCls,
                    isFiltering && !isActive && "opacity-30",
                    isActive && "ring-2 ring-offset-1 ring-gray-500 font-bold"
                  )}
                  title={isActive ? `Remove ${d} filter` : `Show only ${d}`}
                >
                  {d} {count}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Catchment groups ── */}
      {grouped.map(({ catchment, code, units }) => {
        const bg = CATCHMENT_BG[code] ?? "#F5F5F5";
        // When a filter is active, only show units whose duty badge matches
        const visibleUnits = isFiltering
          ? units.filter(({ list }) => {
              const fid = list[0]?.id ?? "";
              const uDuty = targetDutyMap[fid] ?? dutyMap[fid] ?? "";
              return activeFilter.has(uDuty);
            })
          : units;
        if (visibleUnits.length === 0) return null;
        return (
          <div key={catchment} className="rounded-lg overflow-hidden border border-gray-300 shadow-sm">
            {/* Catchment header */}
            <div className="px-3 py-1.5 border-b border-gray-300" style={{ backgroundColor: bg, color: getContrastColor(bg) }}>
              <span className="text-[11px] font-extrabold tracking-widest uppercase">
                [{code}] {catchment}
              </span>
            </div>

            {/* Unit rows */}
            <div className="divide-y divide-gray-200">
              {visibleUnits.map(({ unitCode, list }) => {
                const firstId = list[0]?.id ?? "";
                // The badge shows the target (scheduled) duty.  Exception: if the home unit is
                // on REST/OFF but a named covering officer is working a shift duty, show that
                // shift instead — the unit is effectively operational thanks to the cover.
                let unitDuty = targetDutyMap[firstId] ?? dutyMap[firstId] ?? "";
                if (unitDuty === "OFF" || unitDuty === "REST" || !unitDuty) {
                  for (const o of list) {
                    const coverName = coveringMap[o.id];
                    if (!coverName) continue;
                    const coverOfficer = officers.find(
                      oo => oo.name.trim().toLowerCase() === coverName.trim().toLowerCase()
                    );
                    if (coverOfficer) {
                      const coverDuty = dutyMap[coverOfficer.id] ?? "";
                      if (SHIFT_DUTIES.has(coverDuty)) { unitDuty = coverDuty; break; }
                    }
                  }
                }
                const isOffRest = unitDuty === "OFF" || unitDuty === "REST";
                const dutyBadgeCls = DUTY_COLORS[unitDuty] ?? "bg-gray-100 text-gray-500 border-gray-300";

                // ── Sequential cross-post-in matching ─────────────────────────────
                // n-th absent home officer gets the n-th incoming cross-poster
                // (cross-posters sorted by their home crewPosition for stability).
                const _crossPosters = (crossPostInMap[unitCode] ?? [])
                  .slice().sort((a, b) => a.crewPos - b.crewPos);
                const _cpForId: Record<string, { name: string; fromUnit: string; duty: string }> = {};
                {
                  let ai = 0;
                  for (const o of list) {
                    const _abs = !!autoRedirectOutMap[o.id] || !!leaveMap[o.id]
                      || ABSENT_DUTIES.has(dutyMap[o.id] ?? "") || !!crossPostMap[o.id]
                      || !!coverForMap[o.id] || !!swapMap[o.id];
                    if (_abs && _crossPosters[ai]) {
                      _cpForId[o.id] = { name: _crossPosters[ai].name, fromUnit: _crossPosters[ai].fromUnit, duty: _crossPosters[ai].duty };
                      ai++;
                    }
                  }
                }

                // ── Sequential auto-redirect-in matching ──────────────────────────
                // When officer A (from this unit) leaves to cover officer B elsewhere,
                // B becomes surplus and is redirected back to A's unit.
                // Pair each isCoveringOther officer with the corresponding redirect-in
                // name so it renders INLINE (next to A) rather than at the row end.
                const _autoRedirsIn = (autoRedirectInMap[unitCode] ?? []).slice();
                const _autoRedirInForId: Record<string, string> = {};
                {
                  let ai = 0;
                  for (const o of list) {
                    if (!!coverForMap[o.id] && ai < _autoRedirsIn.length) {
                      _autoRedirInForId[o.id] = _autoRedirsIn[ai];
                      ai++;
                    }
                  }
                }
                const _pairedAutoRedirNames = new Set(Object.values(_autoRedirInForId));

                // Understaffed warning: DAY / PD units must have 2 filled slots.
                const NEEDS_TWO = new Set(["DAY", "PD"]);
                const isUnderstaffed = NEEDS_TWO.has(unitDuty) && (() => {
                  let filled = 0;
                  for (const o of list) {
                    const oLeave     = !!leaveMap[o.id];
                    const oDuty      = dutyMap[o.id] ?? "";
                    const oAutoRedir = !!autoRedirectOutMap[o.id];
                    const oAbsent    = oAutoRedir || oLeave || ABSENT_DUTIES.has(oDuty) || !!crossPostMap[o.id] || !!coverForMap[o.id] || !!swapMap[o.id];
                    const oCovered   = !!coveringMap[o.id] || !!swapMap[o.id] || !!_cpForId[o.id];
                    if (!oAbsent || oCovered) filled++;
                  }
                  filled += (autoRedirectInMap[unitCode] ?? []).length;
                  return filled < 2;
                })();

                return (
                  <div
                    key={unitCode}
                    className="relative px-3 py-1.5 min-h-[2rem]"
                    style={{ backgroundColor: bg, color: getContrastColor(bg) }}
                  >
                    {/* Dim overlay for OFF/REST rows — absolutely positioned so content
                        can sit above it via z-index, keeping ND Avail elements visible */}
                    {isOffRest && (
                      <div className="absolute inset-0 bg-black/30 pointer-events-none" />
                    )}
                    {/* Content wrapper — always rendered above the overlay */}
                    <div className="relative z-10 flex items-center gap-2 w-full min-w-0">
                    {/* Unit code */}
                    <span className="text-[11px] font-bold w-9 shrink-0">{unitCode}</span>

                    {/* Officers — inline */}
                    <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                      {(() => {
                        // Track whether any name has been output so the "&" separator
                        // only appears between slots that actually render visible names.
                        let prevHadOutput = false;
                        return list.map((o) => {
                          const onLeave         = !!leaveMap[o.id];
                          const duty            = dutyMap[o.id] ?? "";
                          const crossDestUnit   = crossPostMap[o.id];   // e.g. "BU3"
                          const crossPosted     = !!crossDestUnit;
                          // coveringOfficer: IC-approved covering name takes priority;
                          // fall back to sequential cross-post-in match (only for absent officers)
                          const isCoveringOther = !!coverForMap[o.id];
                          // Which unit is this officer covering? Derived from reverse of coveringMap.
                          const coveredAtUnit   = isCoveringOther
                            ? coveredAtUnitByName[o.name.trim().toLowerCase()]
                            : undefined;
                          const swappedWith     = swapMap[o.id];
                          const isSwapped       = !!swappedWith;
                          const autoRedirDest   = autoRedirectOutMap[o.id];
                          const isAutoRedirOut  = !!autoRedirDest;
                          const isAbsent =
                            isAutoRedirOut || onLeave || ABSENT_DUTIES.has(duty) || crossPosted || isCoveringOther || isSwapped;

                          // Officer working a shift they were originally scheduled OFF/REST for
                          const originalDuty     = targetDutyMap[o.id] ?? duty;
                          const originalWasOff   = originalDuty === "OFF" || originalDuty === "REST";
                          // Case B — direct override: officer is present but duty was changed from OFF/REST
                          const isWorkingFromOff = !isAbsent && SHIFT_DUTIES.has(duty) && originalWasOff;

                          const _cpEntry = isAbsent ? _cpForId[o.id] : undefined;
                          const coveringOfficer = coveringMap[o.id] ?? _cpEntry?.name;
                          // Source unit bracket for the covering officer:
                          // prefer the cross-post-in fromUnit; fall back to looking up by name
                          const coveringFromUnit: string | undefined =
                            _cpEntry?.fromUnit
                            ?? (coveringMap[o.id]
                                ? nameToUnitMap[coveringMap[o.id].trim().toLowerCase()]
                                : undefined);

                          // For swapped officers: show the partner's home unit, not generic [swp]
                          const swapPartnerUnit = isSwapped && swappedWith
                            ? nameToUnitMap[swappedWith.trim().toLowerCase()]
                            : undefined;

                          // Determine the swap destination duty: the partner's home/target duty
                          // tells us what shift this officer is being sent to cover.
                          // ND destination → [swp] orange; PD/DAY destination → [unit code] red.
                          const _swapPartnerOfficer = isSwapped && swappedWith
                            ? officers.find(oo => oo.name.trim().toLowerCase() === swappedWith.trim().toLowerCase())
                            : undefined;
                          const _swapDestDuty = _swapPartnerOfficer
                            ? (targetDutyMap[_swapPartnerOfficer.id] ?? dutyMap[_swapPartnerOfficer.id] ?? "ND")
                            : "ND"; // default orange when partner not found
                          const swapGoingToND = _swapDestDuty === "ND" || _swapDestDuty === "REST" || !_swapDestDuty;

                          const _rawBracket = isAbsent
                            ? (isAutoRedirOut
                                ? "swp"
                                : isSwapped
                                  ? (swapPartnerUnit ?? "swp")   // e.g. [KG3] — where partner is from
                                  : isCoveringOther
                                    ? (coveredAtUnit ?? "cvg")   // e.g. [KG2] — unit being covered
                                    : absenceBracket(duty, onLeave, leaveMap[o.id] ?? "", crossPosted))
                            : "";
                          // Cross-posted officers with crossDestUnit take priority for bracket text.
                          const bracket = (_rawBracket === "cvg" && crossDestUnit)
                            ? (duty === "ND" ? "swp" : crossDestUnit)
                            : _rawBracket;

                          // Colour flags
                          const isCvg = bracket === "cvg" || (isCoveringOther && !!coveredAtUnit);
                          // [swp] / swap bracket is orange ONLY when the officer is going to an ND
                          // shift; swaps to PD or DAY are treated as a covering-catchment (red).
                          // Auto-redirect [swp] and cross-post destination brackets stay orange.
                          const isSwapBracket = bracket === "swp" && !isSwapped   // auto-redirect swp → always orange
                            || (isSwapped && swapGoingToND)                        // swap → orange only to ND
                            || (crossPosted && !!crossDestUnit);                   // cross-post → orange

                          // ── Deduplication rule ────────────────────────────────────────────
                          // Auto-redirected officers appear ONLY at their destination — suppress
                          // the home-slot name.
                          // Swapped, cross-posted, and covering officers all keep their home-slot
                          // entry (red strikethrough + destination/swap bracket) so the home unit
                          // always shows the original two-officer structure, while the replacement
                          // renders inline next to the strikethrough name.
                          const shouldHideSelf = isAutoRedirOut;

                          // Will this slot produce any visible output?
                          const hasReplacement =
                            (isSwapped && !!swappedWith) ||
                            (!isSwapped && !!coveringOfficer) ||
                            (isCoveringOther && !coveringOfficer && !!_autoRedirInForId[o.id]);
                          // Every officer slot always counts for separator tracking so the "&"
                          // between the two officer positions is preserved even when one is away
                          // with no replacement assigned.
                          const hasOutput = true;

                          const sep = prevHadOutput && hasOutput;
                          if (hasOutput) prevHadOutput = true;

                          return (
                            <React.Fragment key={o.id}>
                              {sep && (
                                <span className={cn("text-[11px] font-medium select-none", isOffRest ? "text-gray-600" : "text-gray-400")}>&amp;</span>
                              )}

                              {/* Officer away with no replacement — show faded name + bracket as
                                  a placeholder so the two-officer structure remains visible */}
                              {shouldHideSelf && !hasReplacement && (
                                <>
                                  <span className="text-[12px] font-medium leading-snug opacity-30">
                                    {o.name}
                                  </span>
                                  {bracket && (
                                    <span className={cn(
                                      "text-[9px] font-bold -ml-0.5 leading-snug opacity-50",
                                      isSwapBracket ? "text-amber-600" : "text-gray-400"
                                    )}>
                                      [{bracket}]
                                    </span>
                                  )}
                                </>
                              )}

                              {/* Officer name */}
                              {!shouldHideSelf && (
                                <span className={cn(
                                  "text-[12px] font-medium leading-snug",
                                  isWorkingFromOff ? "font-bold text-green-500 dark:text-green-400" :
                                  !isAbsent        ? "" :
                                                     "line-through text-red-500 dark:text-red-400"
                                )}>
                                  {o.name}
                                </span>
                              )}

                              {/* [ND Avail] badge — officer is working a shift on their scheduled OFF/REST day */}
                              {!shouldHideSelf && isWorkingFromOff && (
                                <span className="text-[8px] font-bold leading-none px-1 py-0.5 rounded bg-green-400 text-slate-900 ml-0.5">
                                  ND Avail
                                </span>
                              )}

                              {/* Bracket — only shown alongside the officer's own name.
                                  [swp] / destination unit = orange; [leave type] = red;
                                  [covering catchment] = red (officer is absent, covering elsewhere) */}
                              {!shouldHideSelf && isAbsent && bracket && (
                                <span className={cn(
                                  "text-[9px] font-bold -ml-0.5 leading-snug",
                                  isSwapBracket ? "text-amber-600" : "text-red-600"
                                )}>
                                  [{bracket}]
                                </span>
                              )}

                              {/* Replacement officer — always rendered regardless of shouldHideSelf
                                  (this IS the person actually working this slot) */}
                              {isSwapped && swappedWith && (() => {
                                // Covering officer fills the swapped slot — show green name + green originating unit
                                const partnerUnit = nameToUnitMap[swappedWith.trim().toLowerCase()];
                                return (
                                  <>
                                    <span className="text-[12px] font-semibold text-green-700 leading-snug">
                                      {swappedWith}
                                    </span>
                                    {partnerUnit && (
                                      <span className="text-[9px] font-bold -ml-0.5 leading-snug text-green-600">
                                        [{partnerUnit}]
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                              {!isSwapped && coveringOfficer && (() => {
                                const isCpIn      = !!_cpEntry;
                                const cpInDuty    = _cpEntry?.duty ?? "";
                                // Cross-poster → always show their home unit code e.g. [CP1];
                                // IC-approved covering → show source unit if known
                                const bracketText = isCpIn
                                  ? (_cpEntry!.fromUnit || (cpInDuty === "ND" ? "swp" : null))
                                  : coveringFromUnit ?? null;
                                return (
                                  <>
                                    <span className="text-[12px] font-semibold text-green-700 leading-snug">
                                      {coveringOfficer}
                                    </span>
                                    {bracketText && (
                                      <span className="text-[9px] font-bold -ml-0.5 leading-snug text-green-600">
                                        [{bracketText}]
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                              {/* Auto-redirect-in: surplus officer from the covered unit — green name, orange [swp] */}
                              {isCoveringOther && !coveringOfficer && _autoRedirInForId[o.id] && (
                                <>
                                  <span className="text-[12px] font-semibold text-green-700 leading-snug">
                                    {_autoRedirInForId[o.id]}
                                  </span>
                                  <span className="text-[9px] font-bold -ml-0.5 leading-snug text-amber-600">
                                    [swp]
                                  </span>
                                </>
                              )}
                            </React.Fragment>
                          );
                        });
                      })()}

                      {/* Auto-redirected-in officers that were not paired inline above */}
                      {(autoRedirectInMap[unitCode] ?? [])
                        .filter(name => !_pairedAutoRedirNames.has(name))
                        .map((name) => (
                        <React.Fragment key={`autoredir-in-${name}`}>
                          <span className="text-[12px] font-medium leading-snug">{name}</span>
                          <span className="text-[9px] font-bold -ml-0.5 leading-snug text-amber-600">[swp]</span>
                        </React.Fragment>
                      ))}

                    </div>

                    {/* Vehicle plate — override vehicle takes priority over officer record */}
                    {(vehicleMap[firstId] ?? list[0]?.vehicle) && (
                      <span className={cn(
                        "text-[10px] font-mono shrink-0",
                        vehicleMap[firstId] ? "text-orange-600 font-semibold" : "text-gray-500"
                      )}>
                        {vehicleMap[firstId] ?? list[0]?.vehicle}
                      </span>
                    )}

                    {/* Understaffed warning */}
                    {isUnderstaffed && (
                      <AlertTriangle
                        className="h-3.5 w-3.5 text-amber-500 shrink-0"
                        title="Understaffed — fewer than 2 officers present for this shift"
                      />
                    )}

                    {/* Duty badge — always shows target (scheduled) duty only */}
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0",
                      dutyBadgeCls
                    )}>
                      {unitDuty || "—"}
                    </span>
                    </div>{/* end content wrapper */}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
