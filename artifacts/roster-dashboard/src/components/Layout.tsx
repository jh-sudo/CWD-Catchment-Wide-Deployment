import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Calendar, Users, ArrowLeftRight, CalendarDays, CalendarRange,
  Copy, Check, Loader2, FileText, ChevronLeft, ChevronRight,
  ClipboardList, ShieldCheck, LogOut, UserCog, Menu, X, Moon, Sun, Upload, Star,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { format, addDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth, isToday, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetRosterConfig, useUpdateRosterConfig, getGetRosterConfigQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useRosterVersion } from "@/context/RosterVersionContext";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { getContrastColor } from "@/lib/contrast";

interface LayoutProps {
  children: React.ReactNode;
}

async function fetchSummary(date: string): Promise<string> {
  const res = await fetch(`/api/roster-plan/summary?date=${date}`);
  if (!res.ok) throw new Error("Failed to fetch summary");
  const data = await res.json();
  return data.text as string;
}

// ── Lightweight mini-calendar ──────────────────────────────────────────────────
function MiniCalendar({ onDateSelect, selectedDate }: {
  onDateSelect: (date: Date) => void;
  selectedDate: Date | null;
}) {
  const { dark } = useTheme();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const containerRef = useRef<HTMLDivElement>(null);
  const [fg, setFg] = useState<string>("#000000");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Walk up DOM tree to find the first non-transparent background
    let node: HTMLElement | null = el;
    while (node) {
      const bg = window.getComputedStyle(node).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        setFg(getContrastColor(bg));
        return;
      }
      node = node.parentElement;
    }
  }, [dark]);

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const end   = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    const days: Date[] = [];
    let cur = start;
    while (cur <= end) { days.push(cur); cur = addDays(cur, 1); }
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [viewMonth]);

  return (
    <div ref={containerRef} className="px-2 py-1 select-none" style={{ color: fg }}>
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          className="p-1 rounded hover:bg-muted"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-semibold">
          {format(viewMonth, "MMM yyyy")}
        </span>
        <button
          onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          className="p-1 rounded hover:bg-muted"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d) => (
          <div key={d} className="text-center text-[9px] font-semibold py-0.5 opacity-60">{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((day, di) => {
            const inMonth  = isSameMonth(day, viewMonth);
            const todayDay = isToday(day);
            const selected = selectedDate ? isSameDay(day, selectedDate) : false;
            return (
              <button
                key={di}
                onClick={() => onDateSelect(day)}
                className={cn(
                  "text-[11px] w-full aspect-square flex items-center justify-center rounded-md transition-colors font-medium",
                  !inMonth && "opacity-30",
                  todayDay && !selected && "bg-blue-100 text-blue-700 font-bold",
                  selected && "bg-primary text-primary-foreground",
                  !todayDay && !selected && "hover:bg-muted",
                )}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────
export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { dark, toggleTheme } = useTheme();

  // Subscribe crew accounts to push notifications so they receive leave/swap updates
  usePushSubscription(user?.role === "crew" ? user.officerId : undefined);

  // Role-based nav items
  const navItems = useMemo(() => {
    if (!user) return [];
    const role = user.role;

    if (role === "admin") {
      return [
        { href: "/",               label: "Deployment Roster", icon: Calendar },
        { href: "/crew-schedule",  label: "Crew Schedule",     icon: CalendarDays },
        { href: "/roster-cycle",   label: "Roster Cycle",      icon: CalendarRange },
        { href: "/upload-brief",   label: "Excel", icon: Upload },
        { href: "/apply",          label: "Leave / Swap",      icon: ArrowLeftRight },
        { href: "/applications",   label: "Applications",      icon: ShieldCheck },
        { href: "/officers",       label: "Officers",          icon: Users },
        { href: "/users",          label: "Users",             icon: UserCog },
        { href: "/public-holiday", label: "Public Holiday",    icon: Star },
      ];
    }
    if (role === "manager") {
      return [
        { href: "/",               label: "Deployment Roster", icon: Calendar },
        { href: "/crew-schedule",  label: "Crew Schedule",     icon: CalendarDays },
        { href: "/roster-cycle",   label: "Roster Cycle",      icon: CalendarRange },
        { href: "/upload-brief",   label: "Excel", icon: Upload },
        { href: "/apply",          label: "Leave / Swap",      icon: ArrowLeftRight },
        { href: "/applications",   label: "Applications",      icon: ShieldCheck },
        { href: "/officers",       label: "Officers",          icon: Users },
        { href: "/public-holiday", label: "Public Holiday",    icon: Star },
      ];
    }
    if (role === "ic") {
      return [
        { href: "/",               label: "Deployment Roster", icon: Calendar },
        { href: "/crew-schedule",  label: "Crew Schedule",     icon: CalendarDays },
        { href: "/roster-cycle",   label: "Roster Cycle",      icon: CalendarRange },
        { href: "/upload-brief",   label: "Excel", icon: Upload },
        { href: "/apply",          label: "Leave / Swap",      icon: ArrowLeftRight },
        { href: "/applications",   label: "Applications",      icon: ShieldCheck },
        { href: "/public-holiday", label: "Public Holiday",    icon: Star },
      ];
    }
    if (role === "crew") {
      return [
        { href: "/",               label: "Deployment Roster", icon: Calendar },
        { href: "/schedule",       label: "My Schedule",       icon: CalendarDays },
        { href: "/roster-cycle",   label: "Roster Cycle",      icon: CalendarRange },
        { href: "/my-applications",label: "My Leave Status",   icon: ClipboardList },
        { href: "/public-holiday", label: "Public Holiday",    icon: Star },
      ];
    }
    return [];
  }, [user]);

  // Show summary calendar only for admin/manager/ic
  const showSummary = user?.role === "admin" || user?.role === "manager" || user?.role === "ic";

  // Summary modal state
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  const [summaryText,    setSummaryText]    = useState("");
  const [summaryDate,    setSummaryDate]    = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [copied,         setCopied]         = useState(false);
  const [calSelected,    setCalSelected]    = useState<Date | null>(null);

  const { version } = useRosterVersion();

  const openSummaryForDate = useCallback(async (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    setSidebarOpen(false);
    setSummaryDate(dateStr);
    setSummaryText("");
    setSummaryOpen(true);
    setSummaryLoading(true);
    setCopied(false);
    try {
      const text = await fetchSummary(dateStr);
      setSummaryText(text);
    } catch {
      setSummaryText("⚠️ Could not load summary — check API server is running.");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Re-fetch summary whenever roster data changes (leave/swap/Excel override) and modal is open
  useEffect(() => {
    if (!summaryOpen || !summaryDate) return;
    let cancelled = false;
    setSummaryLoading(true);
    fetchSummary(summaryDate)
      .then(text => { if (!cancelled) setSummaryText(text); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [version, summaryOpen, summaryDate]);

  const handleCalSelect = (date: Date) => {
    setCalSelected(date);
    openSummaryForDate(date);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const queryClient = useQueryClient();
  const canManageTeams = user?.role === "admin" || user?.role === "manager";
  const { data: rosterConfig, isLoading: isConfigLoading } = useGetRosterConfig();
  const updateConfig = useUpdateRosterConfig();

  const handleTeamCountChange = useCallback((val: string) => {
    if (!rosterConfig) return;
    updateConfig.mutate(
      { data: { teamCount: parseInt(val, 10) as 20 | 24 | 28, cycleStartDate: rosterConfig.cycleStartDate } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetRosterConfigQueryKey() }) }
    );
  }, [rosterConfig, updateConfig, queryClient]);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change (mobile nav)
  useEffect(() => { setSidebarOpen(false); }, [location]);

  const today    = new Date();
  const tomorrow = addDays(today, 1);

  const summaryDateLabel = summaryDate
    ? new Date(summaryDate + "T00:00:00Z").toLocaleDateString("en-SG", {
        weekday: "short", day: "numeric", month: "short", year: "2-digit", timeZone: "UTC",
      })
    : "";

  const sidebarContent = (
    <>
      {/* Brand + user chip */}
      <div className="h-14 flex items-center px-5 border-b shrink-0 justify-between">
        <h1 className="text-base font-bold tracking-tight text-primary">Duty Roster</h1>
        <div className="flex items-center gap-1">
          {/* Dark mode toggle */}
          <button
            onClick={toggleTheme}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          {user && (
            <>
              <span className="text-[10px] text-muted-foreground font-medium truncate max-w-[70px]" title={user.username}>
                {user.officerName ?? user.username}
              </span>
              <button
                onClick={logout}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {/* Close button on mobile */}
          <button
            className="md:hidden p-1 rounded hover:bg-muted text-muted-foreground ml-1"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Role badge */}
      {user && (
        <div className="px-5 py-1.5 border-b shrink-0">
          <span className={cn(
            "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
            user.role === "admin"   && "bg-red-100 text-red-700",
            user.role === "manager" && "bg-purple-100 text-purple-700",
            user.role === "ic"      && "bg-blue-100 text-blue-700",
            user.role === "crew"    && "bg-green-100 text-green-700",
          )}>
            {user.role === "admin" ? "Admin" :
             user.role === "manager" ? "Manager" :
             user.role === "ic" ? "Roster IC" : "Crew"}
          </span>
        </div>
      )}

      {/* Nav */}
      <nav className="px-3 pt-4 pb-2 space-y-0.5 shrink-0">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}>
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Teams cycle length — admin/manager only */}
      {canManageTeams && (
        <>
          <Separator className="mx-3 my-2 w-auto" />
          <div className="px-3 pb-2 shrink-0">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground px-1 mb-2">
              Cycle Teams
            </p>
            <Select
              disabled={isConfigLoading || updateConfig.isPending}
              value={rosterConfig?.teamCount?.toString() ?? ""}
              onValueChange={handleTeamCountChange}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {["20","24","28"].map((v) => (
                  <SelectItem key={v} value={v}>{v} Teams</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {showSummary && (
        <>
          <Separator className="mx-3 my-2 w-auto" />
          <div className="px-3 pb-2 shrink-0">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground px-1 mb-2">
              Quick Summary
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 text-xs h-8" onClick={() => openSummaryForDate(today)}>
                <FileText className="h-3 w-3 mr-1.5" />
                Today
              </Button>
              <Button variant="outline" size="sm" className="flex-1 text-xs h-8" onClick={() => openSummaryForDate(tomorrow)}>
                <FileText className="h-3 w-3 mr-1.5" />
                Tomorrow
              </Button>
            </div>
          </div>
          <Separator className="mx-3 my-2 w-auto" />
          <div className="flex-1 overflow-y-auto pb-3">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground px-4 mb-1">
              Calendar
            </p>
            <MiniCalendar onDateSelect={handleCalSelect} selectedDate={calSelected} />
            <p className="text-[10px] text-muted-foreground text-center mt-1 px-3">
              Tap a date to view its summary
            </p>
          </div>
        </>
      )}

      {!showSummary && <div className="flex-1" />}
    </>
  );

  return (
    <div className="flex w-full bg-muted/40" style={{ height: "100dvh" }}>

      {/* ── Mobile overlay backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar — desktop: always visible; mobile: slide-in overlay ── */}
      <aside className={cn(
        "w-64 border-r bg-card flex flex-col overflow-hidden transition-transform duration-200 z-40",
        "fixed inset-y-0 left-0 md:relative md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
      )}>
        {sidebarContent}
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Mobile top bar — sticky so it never scrolls away */}
        <div className="md:hidden sticky top-0 z-20 flex items-center gap-3 px-4 h-12 border-b bg-card shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold text-primary">Duty Roster</span>
        </div>
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {children}
        </div>
      </main>

      {/* ── Summary Modal ── */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-lg" aria-describedby="summary-desc">
          <DialogHeader>
            <DialogTitle>Deployment Summary — {summaryDateLabel}</DialogTitle>
          </DialogHeader>
          <div id="summary-desc">
            {summaryLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <pre className="text-xs font-mono bg-muted rounded-md p-4 whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto border">
                {summaryText}
              </pre>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSummaryOpen(false)}>Close</Button>
            <Button onClick={handleCopy} disabled={summaryLoading} className="min-w-[100px]">
              {copied
                ? <><Check className="h-4 w-4 mr-2" />Copied</>
                : <><Copy className="h-4 w-4 mr-2" />Copy</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
