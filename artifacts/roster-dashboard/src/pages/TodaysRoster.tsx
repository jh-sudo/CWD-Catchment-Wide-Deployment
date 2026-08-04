import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { format, addDays, subDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { useRosterVersion } from "@/context/RosterVersionContext";


import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCcw, ChevronLeft, ChevronRight, Copy, Check, Loader2 } from "lucide-react";
import { useGetRosterOfficers } from "@workspace/api-client-react";
import { RosterListView, ABSENT_DUTIES } from "@/components/RosterListView";
import { usePHActuals, SG_PH_META_MAP } from "@/lib/usePHActuals";
import { PHActualPanel } from "@/components/PHActualPanel";

export default function TodaysRoster() {
  const todayStr = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const { data: officers, isLoading: officersLoading } = useGetRosterOfficers();
  const { isPH, phName: phDayName, rows: phRows, loading: phLoading } = usePHActuals(selectedDate);
  const showPHPanel = isPH;
  const [dutyMap, setDutyMap] = useState<Record<string, string>>({});
  const [targetDutyMap, setTargetDutyMap] = useState<Record<string, string>>({});
  const [crossPostMap, setCrossPostMap] = useState<Record<string, string>>({});
  const [leaveMap, setLeaveMap] = useState<Record<string, string>>({});
  const [coveringMap, setCoveringMap] = useState<Record<string, string>>({});
  const [coverForMap, setCoverForMap] = useState<Record<string, boolean>>({});
  const [swapMap, setSwapMap] = useState<Record<string, string>>({});
  const [vehicleMap, setVehicleMap] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(true);
  const { version } = useRosterVersion();
  const touchXRef = useRef<number | null>(null);
  const touchYRef = useRef<number | null>(null);

  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dutyFilter, setDutyFilter] = useState<Set<string>>(new Set());
  const [sundayTargetMap, setSundayTargetMap] = useState<Record<string, string>>({});

  // OIL Monday: originalDate is a Sunday
  const oilOriginalDate = isPH ? SG_PH_META_MAP[selectedDate]?.originalDate : undefined;
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

  // PH / OIL: filter to duty units only, override shift columns
  const { effectiveOfficers, effectiveDutyMap, effectiveTargetMap } = useMemo(() => {
    const allOfficers = (officers ?? []).filter(o => o.active);
    if (!isPH || phRows.length === 0 || !allOfficers.length) {
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
  }, [isPH, isOIL, phRows, officers, dutyMap, targetDutyMap, sundayTargetMap]);

  const toggleDutyFilter = (duty: string) => {
    setDutyFilter(prev => {
      const next = new Set(prev);
      if (next.has(duty)) next.delete(duty); else next.add(duty);
      return next;
    });
  };
  const isFiltering = dutyFilter.size > 0;

  const handleCopySummary = useCallback(async () => {
    setCopying(true);
    try {
      const res = await fetch(`/api/roster-plan/summary?date=${selectedDate}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      await navigator.clipboard.writeText(data.text ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail — clipboard unavailable or API error
    } finally {
      setCopying(false);
    }
  }, [selectedDate]);

  const load = useCallback(async (dateStr: string) => {
    setFetching(true);
    try {
      const [schedRes, leaveRes] = await Promise.all([
        fetch(`/api/roster-plan/schedule?date=${dateStr}`),
        fetch(`/api/roster-plan/leave?date=${dateStr}`),
      ]);
      const sched = schedRes.ok ? await schedRes.json() : { duties: [] };
      const dm: Record<string, string> = {};
      const tdm: Record<string, string> = {};
      const cpm: Record<string, string> = {};
      const cm: Record<string, string> = {};
      const vm: Record<string, string> = {};
      const sm: Record<string, string> = {};
      for (const d of sched.duties ?? []) {
        if (d.date?.startsWith(dateStr)) {
          dm[d.officerId] = d.duty;
          if (d.targetDuty)             tdm[d.officerId] = d.targetDuty;
          if (d.crossPostedToUnit)      cpm[d.officerId] = d.crossPostedToUnit;
          if (d.coveredByOfficerName)   cm[d.officerId] = d.coveredByOfficerName;
          if (d.vehicle)                vm[d.officerId] = d.vehicle;
          if (d.swappedWithOfficerName) sm[d.officerId] = d.swappedWithOfficerName;
        }
      }
      setDutyMap(dm); setTargetDutyMap(tdm); setCrossPostMap(cpm); setVehicleMap(vm); setSwapMap(sm);

      const leaveArr = leaveRes.ok ? await leaveRes.json() : [];
      const lm: Record<string, string> = {};
      const cfm: Record<string, boolean> = {};
      for (const l of Array.isArray(leaveArr) ? leaveArr : []) {
        lm[l.officerId] = l.leaveType;
        if (l.coveringOfficerName) cm[l.officerId] = l.coveringOfficerName;
        if (l.coveringOfficerId)   cfm[l.coveringOfficerId] = true;
      }
      setLeaveMap(lm);
      setCoveringMap(cm);
      setCoverForMap(cfm);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { load(selectedDate); }, [load, selectedDate, version]);

  const isLoading = fetching || officersLoading;
  const isOnToday = selectedDate === todayStr;

  const goTo   = (d: string) => setSelectedDate(d);
  const goPrev = () => goTo(format(subDays(parseISO(selectedDate), 1), "yyyy-MM-dd"));
  const goNext = () => goTo(format(addDays(parseISO(selectedDate), 1), "yyyy-MM-dd"));

  const displayLabel = useMemo(() => {
    const base = format(parseISO(selectedDate), "EEEE, d MMMM yyyy");
    return phDayName ? `${base} (${phDayName})` : base;
  }, [selectedDate, phDayName]);

  const { ndCount, dayCount, pdCount, minimum, minLabel } = useMemo(() => {
    let nd = 0, day = 0, pd = 0;
    for (const o of officers ?? []) {
      if (leaveMap[o.id]) continue;
      const duty = dutyMap[o.id] ?? "";
      if (ABSENT_DUTIES.has(duty)) continue;
      if (duty === "ND") nd++;
      if (duty === "DAY") day++;
      if (duty === "PD") pd++;
    }
    const utcDay = new Date(selectedDate + "T00:00:00Z").getUTCDay();
    const weekend = utcDay === 0 || utcDay === 6;
    const min = isPH ? 12 : (weekend ? 12 : 24);
    const label = isPH ? "PH" : (weekend ? "Weekend" : "Weekday");
    return { ndCount: nd, dayCount: day, pdCount: pd, minimum: min, minLabel: label };
  }, [officers, dutyMap, leaveMap, selectedDate, isPH]);
  const totalStrength = ndCount + dayCount + pdCount;
  const strengthOk    = totalStrength >= minimum;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="shrink-0 bg-card border-b px-4 py-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={selectedDate}
            onChange={e => e.target.value && goTo(e.target.value)}
            className="h-8 px-2 text-xs border rounded-md bg-background cursor-pointer dark:[color-scheme:dark]"
          />
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={goPrev} title="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={goNext} title="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isOnToday && (
            <Button variant="outline" size="sm" className="h-8 text-xs px-2.5" onClick={() => goTo(todayStr)}>
              Today
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            onClick={handleCopySummary} disabled={copying || isLoading}
            title="Copy deployment summary"
          >
            {copying
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : copied
                ? <Check className="h-3.5 w-3.5 text-green-600" />
                : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            onClick={() => load(selectedDate)} disabled={isLoading} title="Refresh"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </Button>
        </div>

        <div className="flex items-center gap-2 min-h-[1.5rem]">
          {isOnToday && (
            <span className="text-[11px] font-bold bg-primary text-primary-foreground rounded px-2 py-0.5 shrink-0">
              TODAY
            </span>
          )}
          <span className={cn("text-sm font-semibold", isOnToday ? "text-primary" : "text-foreground")}>
            {displayLabel}
          </span>
        </div>
      </header>

      {/* ── Frozen strength strip ── */}
      {!isLoading && (officers?.length ?? 0) > 0 && (
        <div className={cn(
          "shrink-0 border-b px-4 py-1.5 flex items-center gap-2 text-[11px]",
          strengthOk
            ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
        )}>
          <span className={cn("font-bold", strengthOk ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
            Strength: {totalStrength} / {minimum}
          </span>
          <span className="text-muted-foreground text-[10px]">({minLabel} min)</span>
          <div className="flex items-center gap-1 ml-auto font-medium">
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
      )}

      {/* ── Roster content — horizontal swipe ── */}
      <div
        className="flex-1 overflow-auto p-4 md:p-6"
        style={{ touchAction: "pan-y" }}
        onTouchStart={e => {
          touchXRef.current = e.touches[0].clientX;
          touchYRef.current = e.touches[0].clientY;
        }}
        onTouchEnd={e => {
          if (touchXRef.current === null) return;
          const dx = e.changedTouches[0].clientX - touchXRef.current;
          const dy = e.changedTouches[0].clientY - (touchYRef.current ?? 0);
          touchXRef.current = null;
          touchYRef.current = null;
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          dx > 0 ? goPrev() : goNext();
        }}
      >
        {isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-36 rounded-lg" />)}
          </div>
        ) : showPHPanel ? (
          <PHActualPanel
            phName={phDayName || "Public Holiday"}
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
              date={selectedDate}
              hideStrengthBar
              filterDuty={dutyFilter}
              onFilterDutyChange={setDutyFilter}
            />
          </div>
        )}
      </div>
    </div>
  );
}
