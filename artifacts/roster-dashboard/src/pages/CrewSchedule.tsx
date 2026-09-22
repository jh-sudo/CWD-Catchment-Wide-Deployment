import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRosterVersion } from "@/context/RosterVersionContext";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, isSameMonth, isToday, parseISO,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useGetRosterOfficers } from "@workspace/api-client-react";
import { SG_PH_SET, SG_PH_META_MAP, usePHActuals } from "@/lib/usePHActuals";
import { PHActualPanel } from "@/components/PHActualPanel";

const DUTY_COLORS: Record<string, string> = {
  PD:   "bg-[#FDD9BB] text-orange-900 border-[#FDD9BB]",
  DAY:  "bg-[#D3E6F5] text-blue-900 border-[#D3E6F5]",
  ND:   "bg-[#FDFCCC] text-yellow-900 border-[#FDFCCC]",
  OFF:  "bg-[#A7FBC1] text-green-900 border-[#A7FBC1]",
  REST: "bg-[#F5C7F5] text-pink-900 border-[#F5C7F5]",
};
const LEAVE_COLOR = "bg-[#FF0000] text-white border-[#FF0000]";
const LEAVE_DUTIES = new Set(["OIL", "AL", "MC", "HOSP", "HL", "COMP", "PH"]);

function calendarDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days: Date[] = [];
  let cur = start;
  while (cur <= end) { days.push(cur); cur = addDays(cur, 1); }
  return days;
}

function mondaysFor(month: Date): string[] {
  return [
    ...new Set(
      calendarDays(month)
        .filter(d => d.getDay() === 1)
        .map(d => format(d, "yyyy-MM-dd"))
    ),
  ];
}

export default function CrewSchedule() {
  const { data: officers, isLoading: officersLoading } = useGetRosterOfficers();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [dutyMap, setDutyMap] = useState<Record<string, string>>({});
  const [targetDutyMap, setTargetDutyMap] = useState<Record<string, string>>({});
  const [partnerDutyMap, setPartnerDutyMap] = useState<Record<string, string>>({});
  const [actualPartnerMap, setActualPartnerMap] = useState<Record<string, string>>({});
  const [crossPostDaySet, setCrossPostDaySet] = useState<Set<string>>(new Set());
  const [selectedDayVehicle, setSelectedDayVehicle] = useState<string | null>(null);
  const { version } = useRosterVersion();
  const [leaveMap, setLeaveMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const calTouchX = useRef<number | null>(null);
  const dayTouchX = useRef<number | null>(null);

  const selectedOfficer = useMemo(
    () => officers?.find(o => o.id === selectedId) ?? null,
    [officers, selectedId]
  );

  const partner = useMemo(
    () =>
      selectedOfficer
        ? (officers?.find(o => o.unitCode === selectedOfficer.unitCode && o.id !== selectedOfficer.id) ?? null)
        : null,
    [officers, selectedOfficer]
  );
  const partnerFirst = partner?.name.split(" ")[0] ?? "";

  const filtered = useMemo(() => {
    if (!officers || !search.trim()) return [];
    const q = search.toLowerCase();
    return officers
      .filter(o => o.name.toLowerCase().includes(q) || o.unitCode.toLowerCase().includes(q))
      .slice(0, 12);
  }, [officers, search]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    const mondays = mondaysFor(viewMonth);
    Promise.all([
      ...mondays.map(mon =>
        fetch(`/api/roster-plan/schedule?date=${mon}`)
          .then(r => r.ok ? r.json() : { duties: [] })
          .catch(() => ({ duties: [] }))
      ),
      fetch("/api/leave-requests", { credentials: "include" })
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    ]).then(results => {
      const schedParts = results.slice(0, mondays.length) as { duties: any[] }[];
      const leaves = results[mondays.length] as any[];
      const dm: Record<string, string> = {};
      const tdm: Record<string, string> = {};
      const pdm: Record<string, string> = {};
      const lm: Record<string, string> = {};
      const cpds = new Set<string>();
      const dutiesByDate: Record<string, any[]> = {};
      for (const s of schedParts) {
        for (const d of s.duties ?? []) {
          const date = d.date?.slice(0, 10);
          if (!date) continue;
          if (d.officerId === selectedId) {
            dm[date] = d.duty;
            if (d.targetDuty) tdm[date] = d.targetDuty;
            // Use onLeave flag from schedule OR recognise leave-type duties directly
            if (d.onLeave || LEAVE_DUTIES.has(d.duty)) lm[date] = d.duty;
            if (d.crossPostedToUnit) cpds.add(date);
          }
          if (partner?.id && d.officerId === partner.id) pdm[date] = d.duty;
          if (!dutiesByDate[date]) dutiesByDate[date] = [];
          dutiesByDate[date].push(d);
        }
      }

      // Determine actual partner per day from live schedule data
      const selectedUnitCode = selectedOfficer?.unitCode ?? "";
      const officerById = new Map((officers ?? []).map((o: any) => [o.id, o]));
      const WORKING = new Set(["ND", "DAY", "PD"]);
      const apm: Record<string, string> = {};
      for (const [date, dayDuties] of Object.entries(dutiesByDate)) {
        const selfRow = dayDuties.find((d: any) => d.officerId === selectedId);
        // Effective unit for partner lookup: the destination unit when the
        // selected officer is themselves cross-posted elsewhere that day,
        // otherwise their home unit — previously always used the home unit,
        // so a cross-posted officer's day showed no partner (or the wrong
        // one) instead of their actual co-worker at the destination.
        // .scratch/replit-resync-2026-09-21/issues/14.
        const effectiveUnitCode = selfRow?.crossPostedToUnit || selectedUnitCode;
        const sameUnitIds = new Set(
          (officers ?? [])
            .filter((o: any) => o.unitCode === effectiveUnitCode && o.id !== selectedId)
            .map((o: any) => o.id)
        );
        let pname = "";
        // 1. Unit partner present at the effective unit (not cross-posted away, on a real shift)
        for (const d of dayDuties) {
          if (!sameUnitIds.has(d.officerId) || d.crossPostedToUnit) continue;
          if (WORKING.has(d.duty)) { pname = (officerById.get(d.officerId) as any)?.name ?? ""; break; }
        }
        // 2. Officer cross-posted INTO the effective unit
        if (!pname) {
          for (const d of dayDuties) {
            if (d.crossPostedToUnit !== effectiveUnitCode || d.officerId === selectedId) continue;
            pname = (officerById.get(d.officerId) as any)?.name ?? "";
            if (pname) break;
          }
        }
        // 3. The effective-unit partner is on leave, but someone was
        // explicitly named as their cover — show the cover instead of no
        // partner at all.
        if (!pname) {
          for (const d of dayDuties) {
            if (!sameUnitIds.has(d.officerId)) continue;
            if (d.coveredByOfficerName) { pname = d.coveredByOfficerName; break; }
          }
        }
        if (pname) apm[date] = pname.split(" ")[0];
      }
      setActualPartnerMap(apm);
      // Augment with formal leave requests (AL, MC, etc.) — no month restriction
      for (const l of leaves) {
        if (l.officerId !== selectedId) continue;
        const d = l.date?.slice(0, 10);
        if (d && !["CANCELLED", "REJECTED"].includes(l.status)) {
          lm[d] = l.leaveType;
        }
      }
      setDutyMap(dm);
      setTargetDutyMap(tdm);
      setPartnerDutyMap(pdm);
      setLeaveMap(lm);
      setCrossPostDaySet(cpds);
    }).finally(() => setLoading(false));
  }, [selectedId, viewMonth, partner?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => calendarDays(viewMonth), [viewMonth]);

  // Server-resolved daily plate for the selected officer on the selected day —
  // not their static home-vehicle field, which never reflects a reassignment.
  // .scratch/replit-resync-2026-09-21/issues/05.
  useEffect(() => {
    if (!selectedDay || !selectedId) { setSelectedDayVehicle(null); return; }
    let cancelled = false;
    fetch(`/api/vehicle-arrangement/officer-map?date=${selectedDay}`)
      .then(r => r.ok ? r.json() : { officerMap: {} })
      .then(data => { if (!cancelled) setSelectedDayVehicle(data.officerMap?.[selectedId] ?? null); })
      .catch(() => { if (!cancelled) setSelectedDayVehicle(null); });
    return () => { cancelled = true; };
  }, [selectedDay, selectedId, version]);

  const clearSelection = () => {
    setSearch("");
    setSelectedId(null);
    setShowDropdown(false);
    setDutyMap({});
    setTargetDutyMap({});
    setPartnerDutyMap({});
    setActualPartnerMap({});
    setLeaveMap({});
    setSelectedDay(null);
  };

  const navigateDay = (direction: 1 | -1) => {
    const base = selectedDay ? parseISO(selectedDay) : new Date();
    const newDate = addDays(base, direction);
    const newStr = format(newDate, "yyyy-MM-dd");
    setSelectedDay(newStr);
    if (!isSameMonth(newDate, viewMonth)) setViewMonth(startOfMonth(newDate));
  };

  const selDuty  = selectedDay ? dutyMap[selectedDay] : undefined;
  const selLeave = selectedDay ? leaveMap[selectedDay] : undefined;
  const partDuty = selectedDay ? partnerDutyMap[selectedDay] : undefined;
  const { isPH: selDayIsPH, rows: phRows, loading: phLoading } = usePHActuals(selectedDay ?? "");
  const showPHPanel = selDayIsPH;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="h-14 px-4 md:px-6 border-b flex items-center justify-between shrink-0 bg-card">
        <h2 className="text-lg font-semibold">Crew Schedule</h2>
        {selectedId && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewMonth(m => subMonths(m, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold w-32 text-center">{format(viewMonth, "MMMM yyyy")}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewMonth(m => addMonths(m, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar */}
        <div className="px-4 md:px-6 py-3 border-b bg-card/80 shrink-0">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Search by name or unit code…"
              className="pl-9 pr-9 h-9"
            />
            {(search || selectedId) && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
                onMouseDown={e => { e.preventDefault(); clearSelection(); }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}

            {showDropdown && search.trim() && (
              <div className="absolute top-full left-0 right-0 z-20 bg-card border rounded-md shadow-lg mt-1 max-h-60 overflow-auto">
                {officersLoading ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>
                ) : filtered.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No officers found</div>
                ) : filtered.map(o => (
                  <button
                    key={o.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-0"
                    onMouseDown={e => {
                      e.preventDefault();
                      setSelectedId(o.id);
                      setSearch(o.name);
                      setShowDropdown(false);
                      setSelectedDay(null);
                    }}
                  >
                    <span className="font-medium">{o.name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{o.unitCode} · {o.catchment}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedOfficer && (
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedOfficer.name}</span>
              <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-bold">{selectedOfficer.unitCode}</span>
              <span>{selectedOfficer.catchment}</span>
              {partner && (
                <span>Partner: <span className="font-semibold text-foreground">{partner.name}</span></span>
              )}
            </div>
          )}
        </div>

        {/* Calendar or empty state */}
        <div className="flex-1 overflow-auto p-3 md:p-4">
          {!selectedId ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Search className="h-12 w-12 opacity-15" />
              <p className="text-sm text-center">
                Search for a crew member above<br />to view their monthly schedule.
              </p>
            </div>
          ) : (
            <>
              {/* Calendar grid — swipe left/right to change month */}
              <div
                style={{ touchAction: "pan-y" }}
                onTouchStart={e => { calTouchX.current = e.touches[0].clientX; }}
                onTouchEnd={e => {
                  if (calTouchX.current === null) return;
                  const dx = e.changedTouches[0].clientX - calTouchX.current;
                  calTouchX.current = null;
                  if (Math.abs(dx) < 60) return;
                  setViewMonth(m => dx > 0 ? subMonths(m, 1) : addMonths(m, 1));
                }}
              >
                <div className="grid grid-cols-7 mb-1">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                    <div key={d} className="text-center text-[10px] font-bold uppercase text-muted-foreground py-1.5">
                      {d}
                    </div>
                  ))}
                </div>

                {loading ? (
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: days.length }).map((_, i) => (
                      <Skeleton key={i} className="min-h-[5.5rem] rounded-md" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1">
                    {days.map((day, i) => {
                      const ds = format(day, "yyyy-MM-dd");
                      const inMonth = isSameMonth(day, viewMonth);
                      const todayDay = isToday(day);
                      const isSelected = selectedDay === ds;
                      const actualDuty = dutyMap[ds];
                      const targetDuty = targetDutyMap[ds];
                      const leaveType = leaveMap[ds];
                      // Effective duty is authoritative. The original roster duty
                      // is reference-only when leave/override changes the day.
                      // .scratch/replit-resync-2026-09-21/issues/34.
                      const primaryDuty = actualDuty ?? targetDuty;
                      const secondaryDuty = (targetDuty && actualDuty && actualDuty !== targetDuty)
                        ? targetDuty : undefined;
                      const primaryIsLeave = primaryDuty != null && (leaveType != null || LEAVE_DUTIES.has(primaryDuty));
                      const primaryClr = primaryIsLeave
                        ? LEAVE_COLOR
                        : (DUTY_COLORS[primaryDuty ?? ""] ?? "");
                      const secondaryClr = secondaryDuty
                        ? (DUTY_COLORS[secondaryDuty] ?? "bg-muted text-foreground border-border")
                        : "";

                      return (
                        <div
                          key={i}
                          onClick={() => inMonth && setSelectedDay(ds)}
                          className={cn(
                            "min-h-[5.5rem] rounded-md p-1.5 flex flex-col gap-1 border transition-colors",
                            !inMonth && "opacity-25 bg-muted/10 border-transparent cursor-default",
                            inMonth && "cursor-pointer",
                            inMonth && isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
                            inMonth && !isSelected && todayDay && "border-blue-400 bg-blue-50/40",
                            inMonth && !isSelected && !todayDay && "border-border bg-card hover:bg-muted/20",
                          )}
                        >
                          <span className={cn(
                            "text-xs font-bold self-start leading-none",
                            todayDay && inMonth ? "text-blue-600" : "text-foreground"
                          )}>
                            {format(day, "d")}
                          </span>
                          {inMonth && primaryDuty && (
                            <span className={cn(
                              "text-[9px] font-bold px-1 py-0.5 rounded border text-center leading-tight",
                              primaryClr
                            )}>
                              {primaryDuty}
                            </span>
                          )}
                          {inMonth && secondaryDuty && (
                            <span className={cn(
                              "text-[9px] font-bold px-1 py-0.5 rounded border text-center leading-tight",
                              secondaryClr
                            )}>
                              {secondaryDuty}
                            </span>
                          )}
                          {inMonth && primaryDuty && !secondaryDuty && (actualPartnerMap[ds] ?? partnerFirst) && (
                            <span className="text-[9px] text-muted-foreground leading-tight truncate">
                              w/ {actualPartnerMap[ds] ?? partnerFirst}
                            </span>
                          )}
                          {inMonth && SG_PH_SET.has(ds) && (
                            <span className="block w-1.5 h-1.5 rounded-full bg-red-400 mt-auto" title={SG_PH_META_MAP[ds]?.name} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Day detail panel — swipe left/right to navigate days */}
              {selectedDay && (
                <div
                  className="mt-4 rounded-xl border bg-card shadow-sm overflow-hidden select-none"
                  style={{ touchAction: "pan-y" }}
                  onTouchStart={e => { e.stopPropagation(); dayTouchX.current = e.touches[0].clientX; }}
                  onTouchEnd={e => {
                    e.stopPropagation();
                    if (dayTouchX.current === null) return;
                    const dx = e.changedTouches[0].clientX - dayTouchX.current;
                    dayTouchX.current = null;
                    if (Math.abs(dx) < 60) return;
                    navigateDay(dx > 0 ? -1 : 1);
                  }}
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                    <button onClick={() => navigateDay(-1)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-semibold">
                      {format(parseISO(selectedDay), "EEE, d MMM yyyy")}
                    </span>
                    <button onClick={() => navigateDay(1)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  {showPHPanel ? (
                    <PHActualPanel
                      phName={SG_PH_META_MAP[selectedDay]?.name ?? "Public Holiday"}
                      rows={phRows}
                      loading={phLoading}
                    />
                  ) : (
                    <div className="grid grid-cols-3 divide-x">
                      <div className="px-4 py-3 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Shift</p>
                        {(() => {
                          const selTarget = selectedDay ? targetDutyMap[selectedDay] : undefined;
                          const selActual = selDuty;
                          const showBoth = selTarget && selActual && selActual !== selTarget;
                          const actualIsLeave = !!selLeave || (selActual ? LEAVE_DUTIES.has(selActual) : false);
                          if (!selTarget && !selActual) return <span className="text-xs text-muted-foreground italic">No data</span>;
                          // Primary badge = actual duty (falling back to scheduled when
                          // there's no override/leave) so an officer on approved leave
                          // sees that prominently instead of their original working
                          // shift. Scheduled duty is relegated to a secondary line only
                          // when it differs. .scratch/replit-resync-2026-09-21/issues/14.
                          const primaryDuty = selActual ?? selTarget;
                          return (
                            <div className="space-y-1">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[9px] text-muted-foreground font-medium">{showBoth ? "Actual" : "Scheduled"}</span>
                                <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded border inline-block", actualIsLeave ? LEAVE_COLOR : (DUTY_COLORS[primaryDuty ?? ""] ?? "bg-muted text-foreground border-border"))}>
                                  {primaryDuty}
                                </span>
                              </div>
                              {showBoth && (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[9px] text-muted-foreground font-medium">Scheduled</span>
                                  <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded border inline-block", DUTY_COLORS[selTarget!] ?? "bg-muted text-foreground border-border")}>
                                    {selTarget}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="px-4 py-3 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Partner</p>
                        {(() => {
                          // Resolved per-day partner (handles the selected officer being
                          // cross-posted elsewhere, and a covering officer standing in for
                          // an on-leave partner) — previously always showed the static
                          // home-unit partner regardless of the actual day.
                          // .scratch/replit-resync-2026-09-21/issues/14.
                          const resolvedName = selectedDay ? actualPartnerMap[selectedDay] : undefined;
                          const displayName = resolvedName
                            ? (partner?.name.startsWith(resolvedName) ? partner!.name : resolvedName)
                            : partner?.name;
                          const showStaticDuty = !!displayName && displayName === partner?.name;
                          if (!displayName) return <span className="text-xs text-muted-foreground italic">—</span>;
                          return (
                            <div className="space-y-0.5">
                              <p className="text-xs font-semibold leading-tight">{displayName}</p>
                              {showStaticDuty && partDuty && (
                                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border inline-block", DUTY_COLORS[partDuty] ?? "bg-muted text-foreground border-border")}>
                                  {partDuty}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="px-4 py-3 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Vehicle</p>
                        {selectedDayVehicle ? (
                          <p className="text-xs font-semibold">{selectedDayVehicle}</p>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">—</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t">
                {Object.entries(DUTY_COLORS).map(([duty, cls]) => (
                  <span key={duty} className={cn("text-[10px] font-bold px-2 py-0.5 rounded border", cls)}>
                    {duty}
                  </span>
                ))}
                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded border", LEAVE_COLOR)}>
                  LEAVE
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
