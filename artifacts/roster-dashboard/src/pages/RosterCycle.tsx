import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRosterVersion } from "@/context/RosterVersionContext";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, isSameMonth, isToday, isSameDay, parseISO, isValid,
} from "date-fns";

import { SG_PH_SET, SG_PH_META_MAP } from "@/lib/usePHActuals";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, CalendarRange, CornerDownRight } from "lucide-react";
import { useGetRosterOfficers } from "@workspace/api-client-react";
import { RosterListView, ABSENT_DUTIES } from "@/components/RosterListView";
import { usePHActuals } from "@/lib/usePHActuals";
import { PHActualPanel } from "@/components/PHActualPanel";

function calendarDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days: Date[] = [];
  let cur = start;
  while (cur <= end) { days.push(cur); cur = addDays(cur, 1); }
  return days;
}

export default function RosterCycle() {
  const { data: officers, isLoading: officersLoading } = useGetRosterOfficers();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dutyMap, setDutyMap] = useState<Record<string, string>>({});
  const [targetDutyMap, setTargetDutyMap] = useState<Record<string, string>>({});
  const [crossPostMap, setCrossPostMap] = useState<Record<string, string>>({});
  const [leaveMap, setLeaveMap] = useState<Record<string, string>>({});
  const [coveringMap, setCoveringMap] = useState<Record<string, string>>({});
  const [coverForMap, setCoverForMap] = useState<Record<string, boolean>>({});
  const [swapMap, setSwapMap] = useState<Record<string, string>>({});
  const [vehicleMap, setVehicleMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [dutyFilter, setDutyFilter] = useState<Set<string>>(new Set());
  const isFiltering = dutyFilter.size > 0;
  const toggleDutyFilter = (duty: string) => {
    setDutyFilter(prev => {
      const next = new Set(prev);
      if (next.has(duty)) next.delete(duty); else next.add(duty);
      return next;
    });
  };
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef<number | null>(null);
  const dayTouchX = useRef<number | null>(null);

  const { version } = useRosterVersion();
  const selectedDateRef = useRef<Date | null>(null);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  // Tracks the date `loadDate()` was most recently called for, so a response for
  // a date the user has since navigated away from doesn't overwrite fresher state.
  const activeLoadDateRef = useRef<string>("");

  const days = useMemo(() => calendarDays(viewMonth), [viewMonth]);

  const loadDate = useCallback(async (date: Date) => {
    setSelectedDate(date);
    setLoading(true);
    const ds = format(date, "yyyy-MM-dd");
    activeLoadDateRef.current = ds;
    try {
      const [schedRes, leaveRes] = await Promise.all([
        fetch(`/api/roster-plan/schedule?date=${ds}`),
        fetch(`/api/roster-plan/leave?date=${ds}`),
      ]);
      const sched = schedRes.ok ? await schedRes.json() : { duties: [] };
      const dm: Record<string, string> = {};
      const tdm: Record<string, string> = {};
      const cpm: Record<string, string> = {};
      const cm: Record<string, string> = {};
      const vm: Record<string, string> = {};
      const sm: Record<string, string> = {};
      for (const d of sched.duties ?? []) {
        if (d.date?.startsWith(ds)) {
          dm[d.officerId] = d.duty;
          if (d.targetDuty)               tdm[d.officerId] = d.targetDuty;
          if (d.crossPostedToUnit)        cpm[d.officerId] = d.crossPostedToUnit;
          if (d.coveredByOfficerName)     cm[d.officerId] = d.coveredByOfficerName;
          if (d.vehicle)                  vm[d.officerId] = d.vehicle;
          if (d.swappedWithOfficerName)   sm[d.officerId] = d.swappedWithOfficerName;
        }
      }
      // Stale guard: if the user has navigated to a different date since this
      // fetch started, drop the response instead of overwriting fresher state.
      if (activeLoadDateRef.current !== ds) return;
      setDutyMap(dm);
      setTargetDutyMap(tdm);
      setCrossPostMap(cpm);
      setVehicleMap(vm);
      setSwapMap(sm);
      const leaveArr = leaveRes.ok ? await leaveRes.json() : [];
      const lm: Record<string, string> = {};
      const cfm: Record<string, boolean> = {};
      for (const l of Array.isArray(leaveArr) ? leaveArr : []) {
        lm[l.officerId] = l.leaveType;
        if (l.coveringOfficerName) cm[l.officerId] = l.coveringOfficerName;
        if (l.coveringOfficerId)   cfm[l.coveringOfficerId] = true;
      }
      if (activeLoadDateRef.current !== ds) return;
      setCoveringMap(cm);
      setCoverForMap(cfm);
      setLeaveMap(lm);
    } finally {
      // Only the still-active date's request should clear the loading spinner —
      // a superseded request's own finally block will handle its own state.
      if (activeLoadDateRef.current === ds) setLoading(false);
    }
  }, []);

  // Re-fetch current date whenever roster data changes elsewhere (or window regains focus)
  useEffect(() => {
    if (version > 0 && selectedDateRef.current) loadDate(selectedDateRef.current);
  }, [version, loadDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedDateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const selectedPHName = selectedDateStr ? (SG_PH_META_MAP[selectedDateStr]?.name ?? null) : null;
  const selectedLabel = selectedDate
    ? format(selectedDate, "EEEE, d MMMM yyyy") + (selectedPHName ? ` (${selectedPHName})` : "")
    : null;
  const { isPH: selectedIsPH, rows: phRows, loading: phLoading } = usePHActuals(selectedDateStr);
  const showPHPanel = selectedIsPH;

  // ── OIL Monday: fetch preceding Sunday's target duties (shown as "Actual") ──
  const [sundayTargetMap, setSundayTargetMap] = useState<Record<string, string>>({});
  const oilOriginalDate = selectedIsPH ? SG_PH_META_MAP[selectedDateStr]?.originalDate : undefined;
  const isOIL = !!oilOriginalDate && new Date(oilOriginalDate + "T12:00:00Z").getUTCDay() === 0;

  useEffect(() => {
    if (!isOIL || !oilOriginalDate) { setSundayTargetMap({}); return; }
    fetch(`/api/roster-plan/schedule?date=${oilOriginalDate}`)
      .then(r => r.ok ? r.json() : { duties: [] })
      .then(data => {
        const sdm: Record<string, string> = {};
        for (const d of data.duties ?? []) {
          if (d.date?.startsWith(oilOriginalDate)) sdm[d.officerId] = d.targetDuty ?? d.duty;
        }
        setSundayTargetMap(sdm);
      })
      .catch(() => setSundayTargetMap({}));
  }, [isOIL, oilOriginalDate]);

  // ── PH / OIL effective display data: filter to duty units, override shifts ──
  const { effectiveOfficers, effectiveDutyMap, effectiveTargetMap } = useMemo(() => {
    const allOfficers = (officers ?? []).filter(o => o.active);
    if (!selectedIsPH || phRows.length === 0 || !allOfficers.length) {
      return { effectiveOfficers: allOfficers, effectiveDutyMap: dutyMap, effectiveTargetMap: targetDutyMap };
    }
    if (isOIL) {
      const onSundayDuty = allOfficers.filter(o => {
        const d = sundayTargetMap[o.id] ?? "";
        return d && !ABSENT_DUTIES.has(d);
      });
      return { effectiveOfficers: onSundayDuty, effectiveDutyMap: sundayTargetMap, effectiveTargetMap: targetDutyMap };
    }
    const phDutyUnits = new Set(phRows.map(r => r.subCatchment));
    const phMap: Record<string, string> = {};
    for (const row of phRows) {
      for (const o of allOfficers) {
        if (o.unitCode === row.subCatchment) phMap[o.id] = row.shift;
      }
    }
    // OFF→ND exception: include officers with an individual override to a working duty
    // even when their unit is not scheduled for PH duty
    const WORKING_DUTIES = new Set(["ND", "DAY", "PD"]);
    const effectiveOfficersPH = allOfficers.filter(o =>
      phDutyUnits.has(o.unitCode) || WORKING_DUTIES.has(dutyMap[o.id] ?? "")
    );
    const effectiveDutyMapPH: Record<string, string> = { ...phMap };
    const effectiveTargetMapPH: Record<string, string> = { ...phMap };
    for (const o of effectiveOfficersPH) {
      if (!phDutyUnits.has(o.unitCode)) {
        effectiveDutyMapPH[o.id] = dutyMap[o.id] ?? "";
        effectiveTargetMapPH[o.id] = targetDutyMap[o.id] ?? dutyMap[o.id] ?? "";
      }
    }
    return {
      effectiveOfficers: effectiveOfficersPH,
      effectiveDutyMap: effectiveDutyMapPH,
      effectiveTargetMap: effectiveTargetMapPH,
    };
  }, [selectedIsPH, isOIL, phRows, officers, dutyMap, targetDutyMap, sundayTargetMap]);

  // ── Strength computation for the sticky strip ──────────────────────────────
  const { ndCount, dayCount, pdCount, minimum, strengthOk, totalStrength, minLabel } = useMemo(() => {
    let nd = 0, day = 0, pd = 0;
    for (const o of (officers ?? [])) {
      if (leaveMap[o.id]) continue;
      const duty = dutyMap[o.id] ?? "";
      if (ABSENT_DUTIES.has(duty)) continue;
      if (duty === "ND")  nd++;
      if (duty === "DAY") day++;
      if (duty === "PD")  pd++;
    }
    let weekend = false;
    let ph = false;
    if (selectedDate) {
      const ds = format(selectedDate, "yyyy-MM-dd");
      const utc = new Date(ds + "T00:00:00Z").getUTCDay();
      weekend = utc === 0 || utc === 6;
      ph = SG_PH_SET.has(ds);
    }
    const min = ph ? 12 : (weekend ? 12 : 24);
    const label = ph ? "PH" : (weekend ? "Weekend" : "Weekday");
    const total = nd + day + pd;
    return { ndCount: nd, dayCount: day, pdCount: pd, minimum: min, strengthOk: total >= min, totalStrength: total, minLabel: label };
  }, [officers, dutyMap, leaveMap, selectedDate]);

  const handleJump = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!jumpValue) return;
    const parsed = parseISO(jumpValue);
    if (!isValid(parsed)) return;
    setViewMonth(startOfMonth(parsed));
    loadDate(parsed);
    setJumpValue("");
    jumpInputRef.current?.blur();
  }, [jumpValue, loadDate]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="h-14 px-6 border-b flex items-center shrink-0 bg-card gap-2.5">
        <CalendarRange className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Roster Cycle</h2>
      </header>

      <div className="flex-1 overflow-auto">
        {/* Jump to date */}
        <div className="px-4 py-3 border-b bg-background">
          <form onSubmit={handleJump} className="flex items-center gap-2">
            <input
              ref={jumpInputRef}
              type="date"
              value={jumpValue}
              onChange={e => setJumpValue(e.target.value)}
              className="flex-1 border rounded-md px-3 py-2 text-sm bg-background text-foreground dark:[color-scheme:dark]"
            />
            <Button type="submit" variant="outline" size="sm" className="shrink-0 h-9 px-3 text-sm gap-1" disabled={!jumpValue}>
              <CornerDownRight className="h-3.5 w-3.5" />
              Go
            </Button>
          </form>
        </div>

        {/* Calendar */}
        <div
          className="p-4 md:p-6 border-b bg-card select-none"
          style={{ touchAction: "pan-y" }}
          onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={e => {
            if (touchStartX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            touchStartX.current = null;
            if (Math.abs(dx) < 60) return;
            setViewMonth(m => dx > 0 ? subMonths(m, 1) : addMonths(m, 1));
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <Button variant="ghost" size="sm" onClick={() => setViewMonth(m => subMonths(m, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold">{format(viewMonth, "MMMM yyyy")}</span>
            <Button variant="ghost" size="sm" onClick={() => setViewMonth(m => addMonths(m, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
              <div key={d} className="text-center text-[10px] font-bold uppercase text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day, i) => {
              const inMonth = isSameMonth(day, viewMonth);
              const todayDay = isToday(day);
              const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
              const dayStr = format(day, "yyyy-MM-dd");
              const isPH = inMonth && SG_PH_SET.has(dayStr);
              return (
                <button
                  key={i}
                  onClick={() => inMonth && loadDate(day)}
                  disabled={!inMonth}
                  className={cn(
                    "h-9 w-full rounded-md text-sm font-medium transition-colors flex flex-col items-center justify-center gap-0",
                    !inMonth && "opacity-20 cursor-default",
                    inMonth && !todayDay && !isSelected && "hover:bg-muted text-foreground",
                    todayDay && !isSelected && "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                    isSelected && "bg-primary text-primary-foreground",
                  )}
                >
                  <span className="leading-none">{format(day, "d")}</span>
                  {isPH && (
                    <span className={cn(
                      "block w-1 h-1 rounded-full mt-0.5",
                      isSelected ? "bg-primary-foreground/80" : "bg-red-500"
                    )} />
                  )}
                </button>
              );
            })}
          </div>

          {!selectedDate && (
            <p className="text-center text-xs text-muted-foreground mt-3">
              Tap a date or use the search above to view the roster
            </p>
          )}
        </div>

        {/* Sticky strength + date strip — appears once calendar scrolls past */}
        {selectedDate && !loading && !officersLoading && (
          <div className={cn(
            "sticky top-0 z-10 border-b px-4 py-2",
            strengthOk
              ? "bg-green-100 dark:bg-green-950"
              : "bg-red-100 dark:bg-red-950"
          )}>
            <p className="text-xs font-semibold text-muted-foreground mb-1">{selectedLabel}</p>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  "text-xs font-bold",
                  strengthOk ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
                )}>
                  Strength: {totalStrength} / {minimum}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  ({minLabel} min)
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
                  const isActive = dutyFilter.has(d);
                  return (
                    <button
                      key={d}
                      onClick={() => toggleDutyFilter(d)}
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
          </div>
        )}

        {/* Roster for selected date */}
        {selectedDate && (
          <div
            className="p-4 md:p-6"
            style={{ touchAction: "pan-y" }}
            onTouchStart={e => { e.stopPropagation(); dayTouchX.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              e.stopPropagation();
              if (dayTouchX.current === null) return;
              const dx = e.changedTouches[0].clientX - dayTouchX.current;
              dayTouchX.current = null;
              if (Math.abs(dx) < 100) return;
              const next = addDays(selectedDate, dx > 0 ? -1 : 1);
              if (!isSameMonth(next, viewMonth)) setViewMonth(startOfMonth(next));
              loadDate(next);
            }}
          >
            {loading || officersLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-36 rounded-lg" />)}
              </div>
            ) : showPHPanel ? (
              <PHActualPanel
                phName={SG_PH_META_MAP[selectedDateStr]?.name ?? "Public Holiday"}
                rows={phRows}
                loading={phLoading}
              />
            ) : (
              <div className="flex flex-col gap-4">
                <RosterListView
                  officers={effectiveOfficers}
                  dutyMap={effectiveDutyMap}
                  targetDutyMap={effectiveTargetMap}
                  crossPostMap={crossPostMap}
                  leaveMap={leaveMap}
                  coveringMap={coveringMap}
                  coverForMap={coverForMap}
                  swapMap={swapMap}
                  vehicleMap={vehicleMap}
                  date={format(selectedDate, "yyyy-MM-dd")}
                  hideStrengthBar
                  filterDuty={dutyFilter}
                  onFilterDutyChange={setDutyFilter}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
