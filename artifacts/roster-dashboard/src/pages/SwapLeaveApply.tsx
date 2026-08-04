import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { format, addDays, parseISO, isValid, eachDayOfInterval } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, CheckCircle2, Info, UserCheck,
  ChevronDown, Search, X, ArrowLeftRight,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCreateRosterSwap, useGetRosterOfficers } from "@workspace/api-client-react";
import { useRosterVersion } from "@/context/RosterVersionContext";
import { SG_PH_SET } from "@/lib/usePHActuals";

const LEAVE_CODES = [
  "VL","VL(AM)","VL(PM)",
  "AMC","AMMA","AMOVL","AMTO","BL","C","CCL","CSL","FCL","HL",
  "MA","MC","ML","NS","OIL","OIL(AM)","OIL(PM)","OVL","PCL","PMC","PMMA","PMOVL","PMTO",
  "PPTW","SL","SLWOMC","SPL","TO","TO(AM)","TO(PM)","UL",
];


const MAX_RANGE_DAYS = 30;

function isWeekendOrPH(dateStr: string) {
  const d = parseISO(dateStr);
  const dow = d.getDay();
  return dow === 0 || dow === 6 || SG_PH_SET.has(dateStr);
}

interface CoverOption { id: string; name: string; unitCode: string; duty: string; }
type CoverPriority = "ND" | "OFF" | "OFF_REST" | "none";
interface DateCoverInfo {
  loading: boolean; myDuty: string; needsCover: boolean;
  covers: CoverOption[]; priority: CoverPriority; selectedCoverId: string;
}

function DutyBadge({ duty }: { duty: string }) {
  const colors: Record<string, string> = {
    ND:  "bg-blue-50 text-blue-700 border-blue-200",
    DAY: "bg-green-50 text-green-700 border-green-200",
    PD:  "bg-purple-50 text-purple-700 border-purple-200",
    OFF: "bg-amber-50 text-amber-700 border-amber-200",
    REST:"bg-amber-50 text-amber-700 border-amber-200",
  };
  const cls = colors[duty] ?? "bg-muted text-muted-foreground border-border";
  return <span className={cn("text-[11px] font-semibold border rounded px-1.5 py-0.5", cls)}>{duty || "—"}</span>;
}

function LeaveTypePicker({
  value, onChange,
}: { value: string; onChange: (v: string) => void; }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return LEAVE_CODES.filter(c => c.toLowerCase().includes(q));
  }, [search]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 40); }, [open]);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between border rounded-md px-3 py-2 text-sm bg-background hover:bg-muted/40 transition-colors text-left h-9">
        <span className={value ? "text-foreground" : "text-muted-foreground"}>
          {value || "Select…"}
        </span>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {value && (
            <span role="button" onClick={e => { e.stopPropagation(); onChange(""); setSearch(""); }}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded">
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg">
          <div className="p-2 border-b flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search leave type…"
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0
              ? <div className="px-3 py-4 text-sm text-muted-foreground text-center">No results</div>
              : filtered.map(c => (
                <button key={c} type="button"
                  className={cn("w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted",
                    value === c && "bg-primary/10 text-primary font-medium")}
                  onClick={() => { onChange(c); setOpen(false); setSearch(""); }}>
                  {c}
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

function OfficerPicker({
  officers, value, onChange, placeholder = "Search officer…",
}: { officers: any[]; value: string; onChange: (id: string) => void; placeholder?: string; }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return officers.filter(o =>
      o.name.toLowerCase().includes(q) || o.unitCode.toLowerCase().includes(q)
    );
  }, [officers, search]);
  const selected = officers.find(o => o.id === value);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 40); }, [open]);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between border rounded-md px-3 py-2 text-sm bg-background hover:bg-muted/40 transition-colors text-left">
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? `${selected.name} — ${selected.unitCode}` : placeholder}
        </span>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {value && (
            <span role="button" onClick={e => { e.stopPropagation(); onChange(""); setSearch(""); }}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded">
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg">
          <div className="p-2 border-b flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Name or unit…"
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0
              ? <div className="px-3 py-4 text-sm text-muted-foreground text-center">No officers found</div>
              : filtered.map((o: any) => (
                <button key={o.id} type="button"
                  className={cn("w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted",
                    value === o.id && "bg-primary/10 text-primary font-medium")}
                  onClick={() => { onChange(o.id); setOpen(false); setSearch(""); }}>
                  {o.name} — {o.unitCode}
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

function CoverOfficerPicker({
  covers, value, onChange,
}: { covers: CoverOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return covers.filter(o =>
      o.name.toLowerCase().includes(q) ||
      o.unitCode.toLowerCase().includes(q) ||
      o.duty.toLowerCase().includes(q)
    );
  }, [covers, search]);
  const selected = covers.find(o => o.id === value);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 40); }, [open]);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between border rounded-md px-2.5 py-1.5 text-xs bg-background hover:bg-muted/40 transition-colors text-left h-8">
        <span className={selected ? "text-foreground truncate" : "text-muted-foreground"}>
          {selected
            ? <><span className="font-bold">[{selected.duty}]</span> {selected.name} · {selected.unitCode}</>
            : "Select cover (optional)…"}
        </span>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {value && (
            <span role="button" onClick={e => { e.stopPropagation(); onChange(""); setSearch(""); }}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded">
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg">
          <div className="p-1.5 border-b flex items-center gap-1.5">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Name, unit or duty…"
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0
              ? <div className="px-3 py-3 text-xs text-muted-foreground text-center">No officers available</div>
              : filtered.map(o => (
                <button key={o.id} type="button"
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs transition-colors hover:bg-muted",
                    value === o.id && "bg-primary/10 text-primary font-medium"
                  )}
                  onClick={() => { onChange(o.id); setOpen(false); setSearch(""); }}>
                  <span className="font-bold">[{o.duty}]</span> {o.name} · {o.unitCode}
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

export default function SwapLeaveApply() {
  const { user } = useAuth();
  const { bumpVersion } = useRosterVersion();
  const { data: officers } = useGetRosterOfficers();
  const createSwap = useCreateRosterSwap();

  const [tab, setTab] = useState<"leave" | "swap">("leave");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState("");

  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");

  // ── Leave state ──────────────────────────────────────────────────────────────
  const [leaveOfficerId, setLeaveOfficerId] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState(tomorrow);
  const [endDate, setEndDate] = useState(tomorrow);
  const [dateCovers, setDateCovers] = useState<Record<string, DateCoverInfo>>({});
  const fetchedDatesRef = useRef<Set<string>>(new Set());

  // ── Swap state ───────────────────────────────────────────────────────────────
  const [swapDate, setSwapDate] = useState(tomorrow);
  const [swapOfficerAId, setSwapOfficerAId] = useState("");
  const [swapOfficerBId, setSwapOfficerBId] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [swapDuties, setSwapDuties] = useState<{ a: string; b: string }>({ a: "", b: "" });
  const [swapDutiesLoading, setSwapDutiesLoading] = useState(false);

  const allOfficers = useMemo(
    () => ((officers ?? []) as any[]).filter((o: any) => o.active).sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [officers]
  );
  const leaveOfficerName = useMemo(
    () => allOfficers.find((o: any) => o.id === leaveOfficerId)?.name ?? "",
    [allOfficers, leaveOfficerId]
  );

  const dates = useMemo(() => {
    try {
      const s = parseISO(startDate); const e = parseISO(endDate);
      if (!isValid(s) || !isValid(e)) return [];
      const safeEnd = e < s ? s : e;
      return eachDayOfInterval({ start: s, end: safeEnd }).slice(0, MAX_RANGE_DAYS).map(d => format(d, "yyyy-MM-dd"));
    } catch { return []; }
  }, [startDate, endDate]);

  useEffect(() => { fetchedDatesRef.current.clear(); setDateCovers({}); }, [leaveOfficerId]);

  useEffect(() => {
    if (tab !== "leave" || !leaveOfficerId) return;
    const validSet = new Set(dates);
    fetchedDatesRef.current.forEach(d => { if (!validSet.has(d)) fetchedDatesRef.current.delete(d); });
    setDateCovers(prev => {
      const next: Record<string, DateCoverInfo> = {};
      dates.forEach(d => { next[d] = prev[d] ?? { loading: true, myDuty: "", needsCover: false, covers: [], priority: "none", selectedCoverId: "" }; });
      return next;
    });
    dates.filter(d => !fetchedDatesRef.current.has(d)).forEach(date => {
      fetchedDatesRef.current.add(date);
      Promise.all([
        fetch(`/api/roster-plan/schedule?date=${date}`).then(r => r.ok ? r.json() : { duties: [], officers: [] }),
        fetch(`/api/leave-requests`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ])
        .then(([s, allLeaves]: [{ duties: any[]; officers: any[] }, any[]]) => {
          const allOff = s.officers ?? []; const duties = s.duties ?? [];
          // Officers already committed as cover on this specific date
          const committedCoverIds = new Set(
            allLeaves
              .filter((l: any) =>
                l.date === date &&
                l.coverOfficerId &&
                l.status !== "CANCELLED" &&
                l.status !== "REJECTED" &&
                l.coverStatus !== "DECLINED"
              )
              .map((l: any) => l.coverOfficerId as string)
          );
          const myEntry = duties.find((d: any) => d.officerId === leaveOfficerId && d.date?.startsWith(date));
          const myDuty = myEntry?.duty ?? "";
          const needsCover = ["DAY", "PD"].includes(myDuty);
          const getCovers = (allowed: string[]): CoverOption[] =>
            allOff.filter(o => {
              if (o.id === leaveOfficerId) return false;
              if (committedCoverIds.has(o.id)) return false;
              const e = duties.find((d: any) => d.officerId === o.id && d.date?.startsWith(date));
              return e && !e.onLeave && e.duty !== "LEAVE" && allowed.includes(e.duty);
            }).map(o => {
              const e = duties.find((d: any) => d.officerId === o.id && d.date?.startsWith(date));
              return { id: o.id, name: o.name, unitCode: o.unitCode, duty: e?.duty ?? "" };
            });
          let covers: CoverOption[] = []; let priority: CoverPriority = "none";
          if (needsCover) {
            if (isWeekendOrPH(date)) { const c = getCovers(["OFF", "REST"]); if (c.length) { covers = c; priority = "OFF_REST"; } }
            else {
              const nd = getCovers(["ND"]);
              if (nd.length) { covers = nd; priority = "ND"; }
              else { const off = getCovers(["OFF"]); if (off.length) { covers = off; priority = "OFF"; } }
            }
          }
          setDateCovers(prev => ({ ...prev, [date]: { loading: false, myDuty, needsCover, covers, priority, selectedCoverId: prev[date]?.selectedCoverId ?? "" } }));
        })
        .catch(() => setDateCovers(prev => ({ ...prev, [date]: { loading: false, myDuty: "", needsCover: false, covers: [], priority: "none", selectedCoverId: "" } })));
    });
  }, [dates, tab, leaveOfficerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCoverForDate = useCallback((date: string, coverId: string) => {
    setDateCovers(prev => ({ ...prev, [date]: { ...prev[date], selectedCoverId: coverId } }));
  }, []);

  useEffect(() => {
    if (!swapDate || (!swapOfficerAId && !swapOfficerBId)) { setSwapDuties({ a: "", b: "" }); return; }
    setSwapDutiesLoading(true);
    fetch(`/api/roster-plan/schedule?date=${swapDate}`)
      .then(r => r.ok ? r.json() : { duties: [] })
      .then((s: { duties: any[] }) => {
        const duties = s.duties ?? [];
        const getDuty = (id: string) => id ? (duties.find((d: any) => d.officerId === id && d.date?.startsWith(swapDate))?.duty ?? "—") : "";
        setSwapDuties({ a: getDuty(swapOfficerAId), b: getDuty(swapOfficerBId) });
      })
      .catch(() => setSwapDuties({ a: "—", b: "—" }))
      .finally(() => setSwapDutiesLoading(false));
  }, [swapDate, swapOfficerAId, swapOfficerBId]);

  const canSubmitLeave = useMemo(() => {
    if (!leaveType || dates.length === 0 || !leaveOfficerId) return false;
    return dates.every(d => { const info = dateCovers[d]; return info && !info.loading; });
  }, [leaveOfficerId, leaveType, dates, dateCovers]);

  const reset = () => {
    setLeaveType(""); setStartDate(tomorrow); setEndDate(tomorrow); setLeaveOfficerId("");
    setDateCovers({}); fetchedDatesRef.current.clear();
    setSwapOfficerAId(""); setSwapOfficerBId(""); setSwapReason(""); setSwapDate(tomorrow);
    setSwapDuties({ a: "", b: "" });
    setError(""); setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSuccess(null); setSubmitting(true);
    try {
      if (tab === "leave") {
        if (!leaveType) throw new Error("Please select a leave type");
        if (!leaveOfficerId) throw new Error("Please select an officer");
        if (dates.length === 0) throw new Error("Invalid dates");
        const results = await Promise.allSettled(
          dates.map(date => {
            const info = dateCovers[date];
            return fetch("/api/leave-requests", {
              method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
              body: JSON.stringify({ date, leaveType, officerId: leaveOfficerId, coverOfficerId: info?.selectedCoverId || undefined }),
            }).then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || `Failed for ${date}`); return d; }));
          })
        );
        const failures = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
        if (failures.length > 0) throw new Error(failures.map(r => r.reason?.message).filter(Boolean).join("; "));
        setSuccess(`${leaveType} leave applied for ${leaveOfficerName}${dates.length > 1 ? ` (${dates.length} days)` : ""}.`);

      } else if (tab === "swap") {
        if (!swapOfficerAId || !swapOfficerBId) throw new Error("Please select both officers");
        const nameA = allOfficers.find((o: any) => o.id === swapOfficerAId)?.name ?? "";
        const nameB = allOfficers.find((o: any) => o.id === swapOfficerBId)?.name ?? "";
        await new Promise<void>((resolve, reject) => {
          createSwap.mutate(
            { data: { requesterId: swapOfficerAId, targetId: swapOfficerBId, date: swapDate, reason: swapReason } },
            { onSuccess: () => resolve(), onError: (err: any) => reject(new Error(err?.message || "Swap failed")) }
          );
        });
        setSuccess(`Roster updated — ${nameA} ⇄ ${nameB} swapped on ${format(parseISO(swapDate), "d MMM yyyy")}.`);

      }
      bumpVersion();
      reset();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 bg-card border-b px-4 py-2">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <span className="text-base font-bold shrink-0">Leave / Swap</span>
          <div className="flex flex-1 rounded-lg border bg-muted/30 p-0.5 gap-0.5">
            {(["leave", "swap"] as const).map(t => (
              <button key={t} type="button"
                onClick={() => { setTab(t); setError(""); setSuccess(null); }}
                className={cn(
                  "flex-1 py-1.5 rounded-md text-sm font-semibold transition-colors capitalize",
                  tab === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                {t === "leave" ? "Apply Leave" : "Swap"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-3 pb-8 space-y-3">

          {success && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
            </div>
          )}
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">

            {/* ── Leave tab ── */}
            {tab === "leave" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Officer *</Label>
                  <OfficerPicker officers={allOfficers} value={leaveOfficerId} onChange={setLeaveOfficerId} placeholder="Search and select officer…" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Leave Type *</Label>
                  <LeaveTypePicker value={leaveType} onChange={setLeaveType} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Start Date</Label>
                    <input type="date" value={startDate}
                      onChange={e => { const v = e.target.value; setStartDate(v); if (v > endDate) setEndDate(v); fetchedDatesRef.current.clear(); setDateCovers({}); }}
                      className="w-full border rounded-md px-2 py-2 text-sm bg-background h-9" required />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">End Date <span className="text-muted-foreground font-normal">(multi-day)</span></Label>
                    <input type="date" value={endDate} min={startDate}
                      onChange={e => { fetchedDatesRef.current.clear(); setDateCovers({}); setEndDate(e.target.value); }}
                      className="w-full border rounded-md px-2 py-2 text-sm bg-background h-9" required />
                  </div>
                </div>

                {leaveOfficerId && dates.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Cover Officers <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      {dates.length > 1 && <span className="text-xs text-muted-foreground">{dates.length} days</span>}
                    </div>
                    {dates.map(date => {
                      const info = dateCovers[date];
                      const wkend = isWeekendOrPH(date);

                      return (
                        <div key={date} className="rounded-md border px-3 py-2 space-y-1.5 bg-card">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold">{format(parseISO(date), "EEE, d MMM")}</span>
                            <div className="flex items-center gap-1.5">
                              {!info || info.loading
                                ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                : <DutyBadge duty={info.myDuty} />}
                              <span className={cn("text-[10px] font-bold uppercase", wkend ? "text-orange-600" : "text-slate-500")}>
                                {SG_PH_SET.has(date) ? "PH" : wkend ? "WE" : "WD"}
                              </span>
                            </div>
                          </div>
                          {info && !info.loading && (
                            <>
                              {info.needsCover && (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-muted-foreground">Cover</span>
                                    {info.priority === "ND" && <span className="text-[11px] text-blue-600 font-medium">ND avail.</span>}
                                    {info.priority === "OFF" && <span className="text-[11px] text-amber-600 font-medium">OFF avail.</span>}
                                    {info.priority === "OFF_REST" && <span className="text-[11px] text-amber-600 font-medium">OFF/REST avail.</span>}
                                    {info.priority === "none" && <span className="text-[11px] text-muted-foreground">None avail.</span>}
                                  </div>
                                  {(info.covers ?? []).length > 0 ? (
                                    <CoverOfficerPicker
                                      covers={info.covers}
                                      value={info.selectedCoverId}
                                      onChange={v => setCoverForDate(date, v)}
                                    />
                                  ) : (
                                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                      <Info className="h-3 w-3 shrink-0" /> No officers available
                                    </div>
                                  )}
                                </div>
                              )}
                              {!info.needsCover && info.myDuty && (
                                <div className="flex items-center gap-1 text-[11px] text-green-600">
                                  <UserCheck className="h-3 w-3" /> No cover needed
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {!leaveOfficerId && (
                  <p className="text-xs text-center text-muted-foreground py-1">Select an officer to continue.</p>
                )}

                <Button type="submit" className="w-full h-9" disabled={submitting || !canSubmitLeave}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Apply {leaveType || "Leave"}
                  {dates.length > 1 ? ` · ${dates.length} days` : ""}
                  {leaveOfficerName ? ` for ${leaveOfficerName}` : ""}
                </Button>
              </>
            )}

            {/* ── Swap tab ── */}
            {tab === "swap" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <input type="date" value={swapDate} min={format(new Date(), "yyyy-MM-dd")}
                    onChange={e => setSwapDate(e.target.value)}
                    className="w-full border rounded-md px-2 py-2 text-sm bg-background h-9" required />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Officer A</Label>
                  <OfficerPicker officers={allOfficers} value={swapOfficerAId} onChange={id => { setSwapOfficerAId(id); if (id === swapOfficerBId) setSwapOfficerBId(""); }} placeholder="Select officer A…" />
                  {swapOfficerAId && (
                    <div className="flex items-center gap-1.5 pl-1 mt-1">
                      <span className="text-[11px] text-muted-foreground">Current duty:</span>
                      {swapDutiesLoading ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        : swapDuties.a ? <DutyBadge duty={swapDuties.a} /> : <span className="text-[11px] text-muted-foreground">—</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-center py-0.5">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="h-px w-16 bg-border" />
                    <ArrowLeftRight className="h-4 w-4" />
                    <div className="h-px w-16 bg-border" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Officer B</Label>
                  <OfficerPicker officers={allOfficers.filter((o: any) => o.id !== swapOfficerAId)} value={swapOfficerBId} onChange={setSwapOfficerBId} placeholder="Select officer B…" />
                  {swapOfficerBId && (
                    <div className="flex items-center gap-1.5 pl-1 mt-1">
                      <span className="text-[11px] text-muted-foreground">Current duty:</span>
                      {swapDutiesLoading ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        : swapDuties.b ? <DutyBadge duty={swapDuties.b} /> : <span className="text-[11px] text-muted-foreground">—</span>}
                    </div>
                  )}
                </div>
                {swapOfficerAId && swapOfficerBId && !swapDutiesLoading && swapDuties.a && swapDuties.b && (
                  <div className="flex items-center justify-center gap-2 text-xs bg-muted/40 border rounded-md px-3 py-2">
                    <DutyBadge duty={swapDuties.a} />
                    <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <DutyBadge duty={swapDuties.b} />
                    <span className="text-muted-foreground ml-1">will be swapped</span>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea value={swapReason} onChange={e => setSwapReason(e.target.value)}
                    placeholder="Briefly describe the reason…" rows={2} className="text-sm resize-none" />
                </div>
                <Button type="submit" className="w-full h-9" disabled={submitting || !swapOfficerAId || !swapOfficerBId}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Apply Swap & Update Roster
                </Button>
              </>
            )}

          </form>
        </div>
      </div>
    </div>
  );
}
