import React, { useState, useMemo, useCallback } from "react";
import { format, addDays, addWeeks, subDays, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, X, Download, Loader2, Edit2 } from "lucide-react";
import * as XLSX from "xlsx";
import {
  useGetRosterSchedule,
  useGetRosterConfig,
  useUpdateRosterConfig,
  useUpdateRosterOfficer,
  getGetRosterScheduleQueryKey,
  getGetRosterConfigQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const DUTY_COLORS: Record<string, string> = {
  PD:   "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800",
  DAY:  "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  ND:   "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800",
  OFF:  "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  REST: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800",
};

const LEAVE_COLORS = "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";

const LEAVE_TYPES = ["VL","VL(AM)","VL(PM)","MC","OVL","OIL","OIL(AM)","OIL(PM)","TO","TO(AM)","TO(PM)","CCL","PL","SPL","FCL","BL","SL","SL(WO/MC)","CSL","MA","NS","NS(ICT)","C","EL","CPL","UNPAID L"];

interface LeaveEntry {
  id: string;
  officerId: string;
  officerName: string;
  date: string;
  leaveType: string;
  coveringOfficerId?: string;
  coveringOfficerName?: string;
}

interface Officer {
  id: string;
  name: string;
  unitCode: string;
  vehicle: string;
  catchment: string;
  teamSlot: number;
  crewPosition: number;
}

async function fetchLeaves(date: string): Promise<LeaveEntry[]> {
  const res = await fetch(`/api/roster-plan/leave?date=${date}`);
  if (!res.ok) throw new Error("Failed to fetch leaves");
  return res.json();
}

async function postLeave(
  officerId: string,
  date: string,
  leaveType: string,
  coveringOfficerId?: string,
): Promise<LeaveEntry> {
  const res = await fetch("/api/roster-plan/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officerId, date, leaveType, coveringOfficerId }),
  });
  if (!res.ok) throw new Error("Failed to save leave");
  return res.json();
}

async function deleteLeave(id: string): Promise<void> {
  const res = await fetch(`/api/roster-plan/leave/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove leave");
}

export default function Roster() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [selectedCatchment, setSelectedCatchment] = useState("All");
  const [shiftFilter, setShiftFilter] = useState<"ALL" | "DAY" | "PD" | "ND" | "REST" | "OFF" | "OIL" | "TO">("ALL");
  const [vehicleEdit, setVehicleEdit] = useState<{ officerId: string; draft: string } | null>(null);
  const dateStr = format(currentDate, "yyyy-MM-dd");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateOfficer = useUpdateRosterOfficer();

  const handleVehicleSave = (officer: any) => {
    if (!vehicleEdit) return;
    updateOfficer.mutate(
      { id: officer.id, data: { ...officer, vehicle: vehicleEdit.draft.toUpperCase().trim() } },
      {
        onSuccess: () => {
          setVehicleEdit(null);
          refetch();
          toast({ title: "Vehicle updated", description: `${officer.name} → ${vehicleEdit.draft.toUpperCase().trim() || "(none)"}` });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      }
    );
  };

  const { data: config, isLoading: isConfigLoading } = useGetRosterConfig();
  const updateConfig = useUpdateRosterConfig();
  const { data: schedule, isLoading: isScheduleLoading, refetch } = useGetRosterSchedule(
    { date: dateStr },
    { query: { queryKey: getGetRosterScheduleQueryKey({ date: dateStr }) } }
  );

  // ── Leave state ─────────────────────────────────────────────────────────────
  const [leavesByDate, setLeavesByDate] = useState<Record<string, LeaveEntry[]>>({});
  const [leaveLoading, setLeaveLoading] = useState(false);

  const weekDates = useMemo(() => {
    if (!schedule) return [];
    return Array.from({ length: 7 }, (_, i) =>
      format(addDays(new Date(schedule.startDate + "T00:00:00Z"), i), "yyyy-MM-dd")
    );
  }, [schedule?.startDate]);

  const loadLeaves = useCallback(async (dates: string[]) => {
    setLeaveLoading(true);
    try {
      const results = await Promise.all(dates.map((d) => fetchLeaves(d)));
      const map: Record<string, LeaveEntry[]> = {};
      dates.forEach((d, i) => { map[d] = results[i]; });
      setLeavesByDate(map);
    } finally {
      setLeaveLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (weekDates.length > 0) loadLeaves(weekDates);
  }, [weekDates.join(",")]);

  const getLeaveForOfficerDate = (officerId: string, d: string): LeaveEntry | undefined =>
    leavesByDate[d]?.find((l) => l.officerId === officerId);

  // ── Covering map: date:coverId → leave entry (the person being covered) ────
  const coveringMap = useMemo(() => {
    const m: Record<string, LeaveEntry> = {};
    for (const [date, leaves] of Object.entries(leavesByDate)) {
      for (const leave of leaves) {
        if (leave.coveringOfficerId) {
          m[`${date}:${leave.coveringOfficerId}`] = leave;
        }
      }
    }
    return m;
  }, [leavesByDate]);

  const handleMarkLeave = async (
    officerId: string,
    d: string,
    leaveType: string,
    coveringOfficerId?: string,
  ) => {
    await postLeave(officerId, d, leaveType, coveringOfficerId);
    await loadLeaves(weekDates);
    refetch();
  };

  const handleClearLeave = async (leaveId: string, d: string) => {
    await deleteLeave(leaveId);
    await loadLeaves(weekDates);
    refetch();
  };

  // ── Actual duty counts per day (excludes officers on leave) ─────────────────
  const actualCounts = useMemo(() => {
    if (!schedule) return {} as Record<string, { PD: number; DAY: number; ND: number }>;
    const result: Record<string, { PD: number; DAY: number; ND: number }> = {};
    for (const d of weekDates) {
      const leaveIds = new Set((leavesByDate[d] ?? []).map((l) => l.officerId));
      let PD = 0, DAY = 0, ND = 0;
      for (const cell of schedule.duties.filter((c) => c.date.startsWith(d))) {
        if (leaveIds.has(cell.officerId)) continue;
        if (cell.duty === "PD") PD++;
        else if (cell.duty === "DAY") DAY++;
        else if (cell.duty === "ND") ND++;
      }
      result[d] = { PD, DAY, ND };
    }
    return result;
  }, [schedule?.duties, weekDates, leavesByDate]);

  // ── Officers grouped by catchment ──────────────────────────────────────────
  const CATCHMENT_ORDER = [
    "Bukit Timah & Urban",
    "Jurong & Pandan",
    "Kranji & Woodlands",
    "Changi & Punggol",
    "Kallang & Geylang",
  ];

  const officersByCatchment = useMemo(() => {
    if (!schedule?.officers) return [];
    const grouped: Record<string, Officer[]> = {};
    for (const officer of schedule.officers as Officer[]) {
      const key = officer.catchment || "Pending Recruitment";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(officer);
    }
    const known = CATCHMENT_ORDER.map((c) => ({ catchment: c, officers: grouped[c] ?? [] })).filter(
      (g) => g.officers.length > 0
    );
    const pending = grouped["Pending Recruitment"];
    if (pending?.length) known.push({ catchment: "Pending Recruitment", officers: pending });
    return known;
  }, [schedule?.officers]);

  const getDuty = (officerId: string, d: string) => {
    if (!schedule) return "-";
    return schedule.duties.find((x) => x.officerId === officerId && x.date.startsWith(d))?.duty ?? "-";
  };

  const LEAVE_FILTER_TYPES = new Set(["OIL", "TO"]);

  const filteredCatchments = useMemo(() => {
    let groups = selectedCatchment === "All"
      ? officersByCatchment
      : officersByCatchment.filter((g) => g.catchment === selectedCatchment);
    if (shiftFilter !== "ALL") {
      const isLeaveFilter = LEAVE_FILTER_TYPES.has(shiftFilter);
      groups = groups
        .map(({ catchment, officers }) => ({
          catchment,
          officers: officers.filter((o) =>
            weekDates.some((d) => {
              if (!schedule) return false;
              if (isLeaveFilter) {
                return (leavesByDate[d] ?? []).some(
                  (l) => l.officerId === o.id && l.leaveType === shiftFilter
                );
              }
              return (schedule.duties.find((x) => x.officerId === o.id && x.date.startsWith(d))?.duty ?? "-") === shiftFilter;
            })
          ),
        }))
        .filter((g) => g.officers.length > 0);
    }
    return groups;
  }, [officersByCatchment, selectedCatchment, shiftFilter, weekDates, schedule, leavesByDate]);

  // ── Officers available to cover on each date (ND / OFF / REST only) ─────────
  const COVERABLE_DUTIES = new Set(["ND", "OFF", "REST"]);
  const coverableByDate = useMemo(() => {
    if (!schedule) return {} as Record<string, Officer[]>;
    const result: Record<string, Officer[]> = {};
    for (const d of weekDates) {
      result[d] = (schedule.officers as Officer[]).filter((o) => {
        const duty = schedule.duties.find((x) => x.officerId === o.id && x.date.startsWith(d))?.duty ?? "-";
        return COVERABLE_DUTIES.has(duty);
      });
    }
    return result;
  }, [schedule?.duties, weekDates]);


  // ── Invalidate all roster queries ──────────────────────────────────────────
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetRosterConfigQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRosterScheduleQueryKey({ date: dateStr }) });
  }, [queryClient, dateStr]);

  // ── Team count change ──────────────────────────────────────────────────────
  const handleTeamCountChange = (val: string) => {
    if (!config) return;
    updateConfig.mutate(
      { data: { teamCount: parseInt(val, 10) as 20 | 24 | 28, cycleStartDate: config.cycleStartDate } },
      { onSuccess: invalidateAll }
    );
  };

  // ── Excel export (full cycle) ────────────────────────────────────────────────
  const handleDownloadExcel = useCallback(async () => {
    if (!config || !schedule) return;
    setIsExporting(true);
    try {
      const teamCount = config.teamCount;
      const currentWeek = schedule.cycleWeek;

      // Monday of cycle week 1 for the current lap
      const currentMonday = startOfWeek(currentDate, { weekStartsOn: 1 });
      const cycleWeek1Monday = addWeeks(currentMonday, -(currentWeek - 1));

      // Dates for each week in the cycle
      const weekMondays = Array.from({ length: teamCount }, (_, i) =>
        format(addWeeks(cycleWeek1Monday, i), "yyyy-MM-dd")
      );

      // Fetch all week schedules in parallel (batch 5 at a time)
      const weekSchedules: any[] = [];
      for (let i = 0; i < weekMondays.length; i += 5) {
        const batch = await Promise.all(
          weekMondays.slice(i, i + 5).map(async (monday) => {
            const res = await fetch(`/api/roster-plan/schedule?date=${monday}`);
            if (!res.ok) throw new Error(`Schedule fetch failed for ${monday}`);
            return res.json();
          })
        );
        weekSchedules.push(...batch);
      }

      // Fetch ALL leaves in one request, then group by date client-side
      const allLeavesRes = await fetch("/api/roster-plan/leave");
      if (!allLeavesRes.ok) throw new Error("Failed to fetch leaves");
      const allLeavesFlat: LeaveEntry[] = await allLeavesRes.json();
      const allLeavesByDate: Record<string, LeaveEntry[]> = {};
      for (const leave of allLeavesFlat) {
        if (!allLeavesByDate[leave.date]) allLeavesByDate[leave.date] = [];
        allLeavesByDate[leave.date].push(leave);
      }

      const wb = XLSX.utils.book_new();

      for (let wi = 0; wi < weekSchedules.length; wi++) {
        const wsSched = weekSchedules[wi];
        const wsMonday = weekMondays[wi];
        const wsDates = Array.from({ length: 7 }, (_, i) =>
          format(addDays(new Date(wsMonday + "T00:00:00Z"), i), "yyyy-MM-dd")
        );

        // Covering map for this week
        const wsCoveringMap: Record<string, LeaveEntry> = {};
        for (const d of wsDates) {
          for (const leave of (allLeavesByDate[d] ?? [])) {
            if (leave.coveringOfficerId) wsCoveringMap[`${d}:${leave.coveringOfficerId}`] = leave;
          }
        }

        // Actual counts per day
        const wsActualCounts: Record<string, { PD: number; DAY: number; ND: number }> = {};
        for (const d of wsDates) {
          const leaveIds = new Set((allLeavesByDate[d] ?? []).map((l: LeaveEntry) => l.officerId));
          let PD = 0, DAY = 0, ND = 0;
          for (const cell of (wsSched.duties ?? []).filter((c: any) => c.date.startsWith(d))) {
            if (leaveIds.has(cell.officerId)) continue;
            if (cell.duty === "PD") PD++;
            else if (cell.duty === "DAY") DAY++;
            else if (cell.duty === "ND") ND++;
          }
          wsActualCounts[d] = { PD, DAY, ND };
        }

        const wsData: string[][] = [];
        wsData.push([`Duty Roster — ${wsSched.weekLabel ?? wsMonday} (Cycle Week ${wi + 1}/${teamCount})`]);
        wsData.push([
          "Officer", "Unit / Vehicle", "Slot",
          ...wsDates.flatMap((d) => [
            format(new Date(d + "T00:00:00Z"), "EEE d MMM") + " (Plan)",
            format(new Date(d + "T00:00:00Z"), "EEE d MMM") + " (Actual)",
          ]),
        ]);

        for (const { catchment, officers: grpOfficers } of officersByCatchment) {
          wsData.push([catchment, "", "", ...wsDates.flatMap(() => ["", ""])]);
          for (const officer of grpOfficers) {
            const row: string[] = [
              officer.name,
              `${officer.unitCode}${officer.vehicle ? " · " + officer.vehicle : ""}`,
              `T${officer.teamSlot}-C${officer.crewPosition}`,
            ];
            for (const d of wsDates) {
              const cell = (wsSched.duties ?? []).find((c: any) => c.officerId === officer.id && c.date.startsWith(d));
              const duty = cell?.duty ?? "—";
              const leave = (allLeavesByDate[d] ?? []).find((l: LeaveEntry) => l.officerId === officer.id);
              const coveringFor = wsCoveringMap[`${d}:${officer.id}`];
              row.push(duty);
              if (leave) {
                row.push(`${leave.leaveType}${leave.coveringOfficerName ? " (COV: " + leave.coveringOfficerName + ")" : ""}`);
              } else if (coveringFor) {
                row.push(`${duty} (COV ${coveringFor.officerName})`);
              } else {
                row.push(duty);
              }
            }
            wsData.push(row);
          }
        }

        wsData.push([
          "", "", "Actual Counts",
          ...wsDates.flatMap((d) => {
            const c = wsActualCounts[d];
            if (!c) return ["", ""];
            const label = [c.DAY > 0 && `DAY:${c.DAY}`, c.PD > 0 && `PD:${c.PD}`, c.ND > 0 && `ND:${c.ND}`]
              .filter(Boolean).join(" / ");
            return ["", label];
          }),
        ]);

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws["!cols"] = [
          { wch: 18 }, { wch: 18 }, { wch: 8 },
          ...wsDates.flatMap(() => [{ wch: 14 }, { wch: 18 }]),
        ];
        const sheetName = `Wk${String(wi + 1).padStart(2, "0")} ${format(new Date(wsMonday + "T00:00:00Z"), "dMMM")}`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }

      const cycleStartLabel = format(new Date(weekMondays[0] + "T00:00:00Z"), "MMMyyyy");
      XLSX.writeFile(wb, `Roster_${teamCount}T_${cycleStartLabel}.xlsx`);
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [config, schedule, currentDate, officersByCatchment, toast]);

  const totalCols = 2 + weekDates.length * 2;

  const handleCycleWeekJump = (val: string) => {
    if (!schedule) return;
    const targetWeek = parseInt(val, 10);
    const currentMonday = startOfWeek(currentDate, { weekStartsOn: 1 });
    const cycleWeek1Monday = addWeeks(currentMonday, -(schedule.cycleWeek - 1));
    setCurrentDate(addWeeks(cycleWeek1Monday, targetWeek - 1));
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header — two rows on mobile, one row on desktop */}
      <header className="px-4 md:px-6 py-2 border-b shrink-0 bg-card">
        {/* Row 1: title + week nav + download */}
        <div className="flex items-center gap-2">
          <h2 className="text-base md:text-lg font-semibold shrink-0">Schedule</h2>

          {/* Week navigator */}
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5 flex-1 min-w-0">
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-foreground dark:text-foreground" onClick={() => setCurrentDate((d) => subDays(d, 7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs md:text-sm font-medium flex-1 text-center truncate px-1 text-foreground">
              {schedule?.weekLabel ?? "Loading..."}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-foreground dark:text-foreground" onClick={() => setCurrentDate((d) => addDays(d, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Download — icon only on mobile, label on desktop */}
          <Button size="sm" variant="outline" onClick={handleDownloadExcel} disabled={!schedule || isExporting} className="shrink-0 h-8 px-2 md:px-3">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden md:inline ml-1.5">{isExporting ? "Exporting…" : "Excel"}</span>
          </Button>
        </div>

        {/* Row 2: cycle week + group filter + shift filter */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {/* Cycle week jump */}
          {schedule && config && (
            <Select value={String(schedule.cycleWeek)} onValueChange={handleCycleWeekJump}>
              <SelectTrigger className="w-32 h-7 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: config.teamCount }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>Cycle Wk {i + 1}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Group filter */}
          <Select value={selectedCatchment} onValueChange={setSelectedCatchment}>
            <SelectTrigger className="flex-1 max-w-xs h-7 text-xs">
              <SelectValue placeholder="All Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Groups</SelectItem>
              {officersByCatchment.map(({ catchment }) => (
                <SelectItem key={catchment} value={catchment}>{catchment}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Shift filter toggles */}
          {(() => {
            const SHIFT_ACTIVE_COLORS: Record<string, string> = {
              ALL:  "bg-muted text-foreground",
              DAY:  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
              PD:   "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
              ND:   "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
              REST: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
              OFF:  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
              OIL:  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
              TO:   "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
            };
            return (
              <div className="flex items-center rounded-md border border-border overflow-hidden shrink-0 flex-wrap">
                {(["ALL", "DAY", "PD", "ND", "REST", "OFF", "OIL", "TO"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setShiftFilter(s)}
                    className={`px-2 h-7 text-[11px] font-semibold transition-colors border-r last:border-r-0 border-border
                      ${shiftFilter === s
                        ? SHIFT_ACTIVE_COLORS[s]
                        : "bg-background text-muted-foreground hover:bg-muted/50"
                      }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isScheduleLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <Card className="border-0 shadow-sm rounded-lg">
            <div>
              <table className="text-sm text-left border-collapse">
                <thead className="text-xs uppercase text-muted-foreground sticky top-0 z-20 bg-muted">
                  {/* Row 1 — day labels */}
                  <tr>
                    <th rowSpan={2} className="px-2 md:px-4 py-2 font-semibold w-28 md:w-44 border-b border-border align-bottom sticky top-0 left-0 z-30 bg-muted">Officer</th>
                    <th rowSpan={2} className="px-1 md:px-3 py-2 font-semibold w-12 md:w-16 border-b border-border align-bottom sticky top-0 left-28 md:left-44 z-30 bg-muted">Slot</th>
                    {weekDates.map((d, i) => {
                      const isToday = d === format(new Date(), "yyyy-MM-dd");
                      return (
                        <th
                          key={i}
                          colSpan={2}
                          className={`px-2 py-1.5 font-semibold text-center border-l border-border ${isToday ? "bg-blue-50 dark:bg-blue-950" : ""}`}
                        >
                          <div className="flex flex-col items-center gap-0">
                            <span className="text-[10px] text-muted-foreground leading-tight">
                              {format(new Date(d + "T00:00:00Z"), "EEE")}
                            </span>
                            <span className="text-base font-bold text-foreground leading-tight">
                              {format(new Date(d + "T00:00:00Z"), "d")}
                            </span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                  {/* Row 2 — Plan / Actual sub-labels */}
                  <tr className="bg-muted">
                    {weekDates.map((d, i) => {
                      const counts = actualCounts[d];
                      const isToday = d === format(new Date(), "yyyy-MM-dd");
                      return (
                        <React.Fragment key={i}>
                          <th className={`px-1 py-1 text-center text-[9px] font-medium tracking-wide w-16 border-l border-t border-border text-muted-foreground/70 ${isToday ? "bg-blue-50 dark:bg-blue-950" : ""}`}>
                            Plan
                          </th>
                          <th className={`px-1 py-1 text-center w-24 border-t border-border ${isToday ? "bg-blue-50 dark:bg-blue-950" : ""}`}>
                            <div className="text-[9px] font-medium tracking-wide text-muted-foreground/70 mb-0.5">Actual</div>
                            {counts && (
                              <div className="flex items-center gap-0.5 flex-wrap justify-center">
                                {counts.DAY > 0 && (
                                  <span className="text-[9px] font-bold px-1 py-0 rounded bg-amber-100 text-amber-700 border border-amber-200 leading-4">
                                    D·{counts.DAY}
                                  </span>
                                )}
                                {counts.PD > 0 && (
                                  <span className="text-[9px] font-bold px-1 py-0 rounded bg-purple-100 text-purple-700 border border-purple-200 leading-4">
                                    P·{counts.PD}
                                  </span>
                                )}
                                {counts.ND > 0 && (
                                  <span className="text-[9px] font-bold px-1 py-0 rounded bg-indigo-100 text-indigo-700 border border-indigo-200 leading-4">
                                    N·{counts.ND}
                                  </span>
                                )}
                              </div>
                            )}
                          </th>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredCatchments.map(({ catchment, officers }) => (
                    <React.Fragment key={catchment}>
                      <tr className="bg-muted border-y border-border">
                        <td colSpan={totalCols} className="px-4 py-1.5 font-bold text-primary text-xs uppercase tracking-wide sticky left-0 bg-muted">
                          {catchment}
                        </td>
                      </tr>
                      {officers.map((officer) => (
                        <tr key={officer.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                          <td className="px-2 md:px-4 py-2 sticky left-0 z-[5] bg-card overflow-hidden max-w-0">
                            <div className="font-medium text-foreground text-sm truncate">{officer.name}</div>
                            <Popover
                              open={vehicleEdit?.officerId === officer.id}
                              onOpenChange={(open) => {
                                if (open) setVehicleEdit({ officerId: officer.id, draft: officer.vehicle ?? "" });
                                else setVehicleEdit(null);
                              }}
                            >
                              <PopoverTrigger asChild>
                                <button className="text-xs text-muted-foreground mt-0.5 hover:text-foreground transition-colors group flex items-center gap-1">
                                  {officer.unitCode}
                                  {officer.vehicle
                                    ? <><span className="opacity-50">·</span> <span className="underline underline-offset-2 decoration-dotted">{officer.vehicle}</span></>
                                    : <span className="italic opacity-50">no vehicle</span>}
                                  <Edit2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-40 shrink-0" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-52 p-3" align="start">
                                <p className="text-xs font-medium mb-2 text-muted-foreground">Vehicle — {officer.name}</p>
                                <Input
                                  className="h-8 text-sm uppercase mb-2"
                                  placeholder="e.g. TST0004A"
                                  value={vehicleEdit?.draft ?? ""}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVehicleEdit((v) => v ? { ...v, draft: e.target.value } : v)}
                                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                    if (e.key === "Enter") handleVehicleSave(officer);
                                    if (e.key === "Escape") setVehicleEdit(null);
                                  }}
                                  autoFocus
                                />
                                <div className="flex gap-1.5">
                                  <Button size="sm" className="h-7 text-xs flex-1" onClick={() => handleVehicleSave(officer)} disabled={updateOfficer.isPending}>
                                    {updateOfficer.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setVehicleEdit(null)}>Cancel</Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </td>
                          <td className="px-1 md:px-3 py-2 text-muted-foreground text-xs sticky left-28 md:left-44 z-[5] bg-card">
                            T{officer.teamSlot}-C{officer.crewPosition}
                          </td>
                          {weekDates.map((colDate) => {
                            const duty = getDuty(officer.id, colDate);
                            const leave = getLeaveForOfficerDate(officer.id, colDate);
                            const coveringFor = coveringMap[`${colDate}:${officer.id}`];
                            const isToday = colDate === format(new Date(), "yyyy-MM-dd");
                            return (
                              <React.Fragment key={colDate}>
                                {/* Plan cell — read-only */}
                                <td className={`px-1 py-2 text-center border-l border-border/50 ${isToday ? "bg-blue-50/30 dark:bg-blue-950/10" : ""}`}>
                                  <PlanCell duty={duty} />
                                </td>
                                {/* Actual cell — interactive */}
                                <td className={`px-1 py-2 text-center ${isToday ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}>
                                  <ActualCell
                                    duty={duty}
                                    leave={leave}
                                    coveringFor={coveringFor}
                                    officerId={officer.id}
                                    date={colDate}
                                    officers={(coverableByDate[colDate] ?? []).filter((o) => o.id !== officer.id)}
                                    onMarkLeave={handleMarkLeave}
                                    onClearLeave={handleClearLeave}
                                  />
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── PlanCell — read-only planned duty badge ───────────────────────────────────
function PlanCell({ duty }: { duty: string }) {
  const colorClass = DUTY_COLORS[duty] ?? "bg-transparent text-muted-foreground/40";
  if (duty === "-" || duty === "REST" || duty === "OFF") {
    return (
      <span className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium rounded border opacity-50 ${colorClass}`}>
        {duty}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center justify-center px-2 py-1 text-xs font-bold rounded-md border ${colorClass}`}>
      {duty}
    </span>
  );
}

// ── ActualCell — interactive cell with leave + covering support ───────────────
interface ActualCellProps {
  duty: string;
  leave: LeaveEntry | undefined;
  coveringFor: LeaveEntry | undefined;
  officerId: string;
  date: string;
  officers: Officer[];
  onMarkLeave: (officerId: string, date: string, leaveType: string, coveringOfficerId?: string) => Promise<void>;
  onClearLeave: (leaveId: string, date: string) => Promise<void>;
}

function ActualCell({ duty, leave, coveringFor, officerId, date, officers, onMarkLeave, onClearLeave }: ActualCellProps) {
  const [open, setOpen] = useState(false);
  const [pendingLeaveType, setPendingLeaveType] = useState<string>("");
  const [pendingCoverId, setPendingCoverId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const handleOpen = (val: boolean) => {
    setOpen(val);
    if (val && leave) {
      setPendingLeaveType(leave.leaveType);
      setPendingCoverId(leave.coveringOfficerId ?? "");
    }
    if (!val) {
      setPendingLeaveType("");
      setPendingCoverId("");
    }
  };

  const handleConfirm = async () => {
    if (!pendingLeaveType) return;
    setSaving(true);
    try {
      await onMarkLeave(officerId, date, pendingLeaveType, pendingCoverId || undefined);
    } finally {
      setSaving(false);
      setOpen(false);
      setPendingLeaveType("");
      setPendingCoverId("");
    }
  };

  const handleClear = async () => {
    if (!leave) return;
    setSaving(true);
    try {
      await onClearLeave(leave.id, date);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  const availableOfficers = officers.filter((o) => o.id !== officerId);
  const dutyColorClass = DUTY_COLORS[duty] ?? "bg-transparent text-muted-foreground";

  // ── Popover content (shared for both leave and no-leave states) ─────────────
  const popoverContent = (
    <PopoverContent className="w-68 p-3" align="center" style={{ width: "270px" }}>
      <p className="text-xs font-semibold text-foreground mb-2">
        {leave ? "Edit leave" : "Mark as leave"}
      </p>

      {/* Leave type picker */}
      <div className="grid grid-cols-4 gap-1 mb-3">
        {LEAVE_TYPES.map((lt) => (
          <button
            key={lt}
            onClick={() => setPendingLeaveType(lt)}
            className={`text-xs px-1.5 py-1.5 rounded border font-semibold transition-colors ${
              pendingLeaveType === lt
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-background hover:bg-orange-50 border-border text-foreground"
            }`}
          >
            {lt}
          </button>
        ))}
      </div>

      {/* Covering officer picker */}
      <div className="mb-3">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
          Covering officer (optional)
        </label>
        <select
          value={pendingCoverId}
          onChange={(e) => setPendingCoverId(e.target.value)}
          className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">— None —</option>
          {availableOfficers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.unitCode})
            </option>
          ))}
        </select>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={saving || !pendingLeaveType}
          className="flex-1 text-xs px-3 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
        {leave && (
          <button
            onClick={handleClear}
            disabled={saving}
            className="text-xs px-2 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 font-medium flex items-center gap-1 transition-colors"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>
    </PopoverContent>
  );

  // ── Officer on leave ─────────────────────────────────────────────────────────
  if (leave) {
    return (
      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger asChild>
          <button className="inline-flex flex-col items-center gap-0.5 cursor-pointer group">
            <span className={`inline-flex items-center justify-center px-2 py-1 text-xs font-bold rounded-md border line-through opacity-60 ${dutyColorClass}`}>
              {duty}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0 rounded border leading-5 ${LEAVE_COLORS}`}>
              {leave.leaveType}
            </span>
          </button>
        </PopoverTrigger>
        {popoverContent}
      </Popover>
    );
  }

  // ── No leave — show duty badge with optional covering indicator ──────────────
  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex flex-col items-center gap-0.5 cursor-pointer group">
          <span className={`inline-flex items-center justify-center px-2 py-1 text-xs font-bold rounded-md border hover:opacity-80 transition-opacity ${dutyColorClass}`}>
            {duty}
          </span>
          {coveringFor && (
            <span className="text-[9px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1 rounded border border-blue-200 dark:border-blue-800 leading-4 max-w-[72px] truncate">
              COV {coveringFor.officerName.split(" ")[0]}
            </span>
          )}
        </button>
      </PopoverTrigger>
      {popoverContent}
    </Popover>
  );
}
