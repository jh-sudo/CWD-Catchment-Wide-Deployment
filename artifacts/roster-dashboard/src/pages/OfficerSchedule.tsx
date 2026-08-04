import React, { useState, useEffect, useMemo } from "react";
import { format, addDays, startOfWeek } from "date-fns";
import { useGetRosterOfficers } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const DUTY_COLORS: Record<string, string> = {
  PD:   "bg-purple-100 text-purple-800 border-purple-200",
  DAY:  "bg-amber-100 text-amber-800 border-amber-200",
  ND:   "bg-indigo-100 text-indigo-800 border-indigo-200",
  OFF:  "bg-gray-100 text-gray-500 border-gray-200",
  REST: "bg-teal-100 text-teal-800 border-teal-200",
};

const CATCHMENT_ORDER = [
  "Bukit Timah & Urban",
  "Jurong & Pandan",
  "Kranji & Woodlands",
  "Changi & Punggol",
  "Kallang & Geylang",
];

interface ScheduleDay {
  date: string;
  duty: string;
  onLeave: boolean;
  leaveType?: string;
}

async function fetchScheduleForDate(date: string) {
  const res = await fetch(`/api/roster-plan/schedule?date=${date}`);
  if (!res.ok) throw new Error("schedule fetch failed");
  return res.json();
}

async function fetchLeavesForDate(date: string) {
  const res = await fetch(`/api/roster-plan/leave?date=${date}`);
  if (!res.ok) return [];
  return res.json();
}

export default function OfficerSchedule() {
  const { data: officers, isLoading: officersLoading } = useGetRosterOfficers();
  const [selectedId, setSelectedId] = useState<string>("");
  const [schedDays, setSchedDays] = useState<ScheduleDay[]>([]);
  const [loading, setLoading] = useState(false);

  // Sorted officer list by catchment then unit code
  const sortedOfficers = useMemo(() => {
    if (!officers) return [];
    return officers.filter(o => o.active).sort((a, b) => {
      const ca = CATCHMENT_ORDER.indexOf(a.catchment);
      const cb = CATCHMENT_ORDER.indexOf(b.catchment);
      if (ca !== cb) return ca - cb;
      return a.unitCode.localeCompare(b.unitCode) || a.crewPosition - b.crewPosition;
    });
  }, [officers]);

  useEffect(() => {
    if (!selectedId) { setSchedDays([]); return; }

    setLoading(true);
    const today = new Date();
    // Generate 30 day dates
    const days = Array.from({ length: 30 }, (_, i) =>
      format(addDays(today, i), "yyyy-MM-dd")
    );
    // Get unique Mondays to fetch schedule
    const mondays = [...new Set(days.map((d) =>
      format(startOfWeek(new Date(d + "T00:00:00Z"), { weekStartsOn: 1 }), "yyyy-MM-dd")
    ))];

    Promise.all([
      ...mondays.map(fetchScheduleForDate),
      ...days.map(fetchLeavesForDate),
    ]).then((results) => {
      const schedResults = results.slice(0, mondays.length) as any[];
      const leaveResults = results.slice(mondays.length) as any[][];

      const leaveLookup: Record<string, string> = {};
      days.forEach((d, i) => {
        const leaves = leaveResults[i] ?? [];
        const entry = leaves.find((l: any) => l.officerId === selectedId);
        if (entry) leaveLookup[d] = entry.leaveType;
      });

      // Build duty map: date → duty
      const dutyMap: Record<string, string> = {};
      for (const sched of schedResults) {
        for (const cell of sched.duties ?? []) {
          if (cell.officerId === selectedId) {
            const d = cell.date.slice(0, 10);
            dutyMap[d] = cell.duty;
          }
        }
      }

      const result: ScheduleDay[] = days.map((d) => ({
        date: d,
        duty: dutyMap[d] ?? "—",
        onLeave: !!leaveLookup[d],
        leaveType: leaveLookup[d],
      }));

      setSchedDays(result);
    }).catch(() => {
      setSchedDays([]);
    }).finally(() => setLoading(false));
  }, [selectedId]);

  // Group by week
  const weeks = useMemo(() => {
    if (!schedDays.length) return [];
    const groups: ScheduleDay[][] = [];
    let current: ScheduleDay[] = [];
    for (const day of schedDays) {
      current.push(day);
      if (current.length === 7 || day === schedDays[schedDays.length - 1]) {
        // end a group when we hit Sunday or end of list
        const d = new Date(day.date + "T00:00:00Z");
        if (d.getUTCDay() === 0 || day === schedDays[schedDays.length - 1]) {
          groups.push(current);
          current = [];
        }
      }
    }
    if (current.length > 0) groups.push(current);
    return groups;
  }, [schedDays]);

  // Duty summary counts
  const summaryCounts = useMemo(() => {
    const counts: Record<string, number> = { PD: 0, DAY: 0, ND: 0, OFF: 0, REST: 0, LEAVE: 0 };
    for (const d of schedDays) {
      if (d.onLeave) { counts.LEAVE++; continue; }
      if (counts[d.duty] !== undefined) counts[d.duty]++;
    }
    return counts;
  }, [schedDays]);

  const selectedOfficer = officers?.find((o) => o.id === selectedId);
  const todayStr = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="h-14 px-6 border-b flex items-center justify-between shrink-0 bg-card">
        <h2 className="text-lg font-semibold">Officer Schedule</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Select officer to view 30-day schedule:</span>
          {officersLoading ? (
            <Skeleton className="h-9 w-52" />
          ) : (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-56 h-9">
                <SelectValue placeholder="Choose an officer..." />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {sortedOfficers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name} ({o.unitCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <p className="text-sm">Select an officer above to view their upcoming 30-day duty schedule.</p>
          </div>
        ) : loading ? (
          <div className="space-y-3 max-w-2xl">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="max-w-2xl space-y-4">
            {/* Officer info + summary counts */}
            {selectedOfficer && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">{selectedOfficer.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedOfficer.unitCode}{selectedOfficer.vehicle ? ` · ${selectedOfficer.vehicle}` : ""} · {selectedOfficer.catchment}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {summaryCounts.PD > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-800 border border-purple-200 font-semibold">
                      PD ×{summaryCounts.PD}
                    </span>
                  )}
                  {summaryCounts.DAY > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-semibold">
                      DAY ×{summaryCounts.DAY}
                    </span>
                  )}
                  {summaryCounts.ND > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200 font-semibold">
                      ND ×{summaryCounts.ND}
                    </span>
                  )}
                  {summaryCounts.LEAVE > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200 font-semibold">
                      LEAVE ×{summaryCounts.LEAVE}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Day-by-day schedule grouped by week */}
            {weeks.map((week, wi) => {
              const firstDate = new Date(week[0].date + "T00:00:00Z");
              const lastDate = new Date(week[week.length - 1].date + "T00:00:00Z");
              const weekLabel = `${format(firstDate, "d MMM")} – ${format(lastDate, "d MMM yyyy")}`;
              return (
                <Card key={wi} className="overflow-hidden border shadow-sm">
                  <div className="bg-muted/40 px-4 py-2 border-b">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {weekLabel}
                    </span>
                  </div>
                  <div className="divide-y">
                    {week.map((day) => {
                      const isToday = day.date === todayStr;
                      const d = new Date(day.date + "T00:00:00Z");
                      const dayOfWeek = format(d, "EEE");
                      const dayNum = format(d, "d MMM");
                      const colorClass = day.onLeave
                        ? "bg-orange-100 text-orange-700 border-orange-200"
                        : DUTY_COLORS[day.duty] ?? "bg-gray-100 text-gray-500 border-gray-200";

                      return (
                        <div
                          key={day.date}
                          className={cn(
                            "flex items-center px-4 py-3 gap-4 transition-colors",
                            isToday ? "bg-blue-50/60 dark:bg-blue-950/20" : "hover:bg-muted/20"
                          )}
                        >
                          {/* Day label */}
                          <div className="w-20 shrink-0">
                            <div className={cn("text-sm font-semibold", isToday ? "text-blue-700" : "text-foreground")}>
                              {dayOfWeek}
                            </div>
                            <div className="text-xs text-muted-foreground">{dayNum}</div>
                          </div>

                          {/* Today indicator */}
                          <div className="w-4 shrink-0 flex justify-center">
                            {isToday && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                          </div>

                          {/* Duty badge */}
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "inline-flex items-center justify-center px-3 py-1 text-xs font-bold rounded-md border min-w-[3rem]",
                              colorClass,
                              day.onLeave && "line-through opacity-80"
                            )}>
                              {day.duty}
                            </span>
                            {day.onLeave && day.leaveType && (
                              <span className="text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-sm">
                                {day.leaveType}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
