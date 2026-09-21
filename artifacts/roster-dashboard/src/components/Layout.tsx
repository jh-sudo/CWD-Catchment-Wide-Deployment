import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Calendar, Users, ArrowLeftRight, CalendarDays, CalendarRange, Clock,
  Copy, Check, Loader2, FileText, ChevronLeft, ChevronRight,
  ClipboardList, ShieldCheck, LogOut, UserCog, Menu, X, Moon, Sun, Upload, Star, Bell, LayoutGrid, Truck, Eye, CalendarClock,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { format, parseISO, addDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth, isToday, isSameDay } from "date-fns";
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
import { useToast } from "@/hooks/use-toast";
import { useMeetings, type Meeting } from "@/hooks/useMeetings";

interface LayoutProps {
  children: React.ReactNode;
}

async function fetchSummary(date: string): Promise<string> {
  const res = await fetch(`/api/roster-plan/summary?date=${date}`);
  if (!res.ok) throw new Error("Failed to fetch summary");
  const data = await res.json();
  return data.text as string;
}

function formatRelativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface ActivityEntry {
  id: string;
  type: "roster-implement" | "leave-applied";
  title: string;
  body: string;
  createdAt: string;
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
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { dark, toggleTheme } = useTheme();
  const { toast } = useToast();

  // Subscribe every role to push notifications, not just crew — see
  // usePushSubscription's own comment. .scratch/replit-resync-2026-09-21/issues/18.
  usePushSubscription(user);

  // ── Meeting scheduler: sidebar shortcut + in-app alert popup ─────────────
  // Polls independently of push (the 15s useMeetings() refetch) so an
  // invitation/reminder/progress notice still surfaces even without browser
  // push permission. .scratch/replit-resync-2026-09-21/issues/33.
  const { data: managerMeetings = [] } = useMeetings(user?.role === "manager");
  const [meetingAlert, setMeetingAlert] = useState<{
    key: string;
    title: string;
    body: string;
  } | null>(null);

  const meetingShortcut = useMemo(() => {
    if (user?.role !== "manager" || !managerMeetings.length) return null;

    const today = format(new Date(), "yyyy-MM-dd");
    const meetingDate = (meeting: Meeting) => {
      if (meeting.status === "confirmed") {
        return meeting.proposedSlots.find((slot) => slot.id === meeting.confirmedSlotId)?.date ?? "9999-12-31";
      }
      return meeting.proposedSlots
        .map((slot) => slot.date)
        .filter((date) => date >= today)
        .sort()[0] ?? "9999-12-31";
    };
    const pendingAction = managerMeetings
      .filter((meeting: Meeting) =>
        meeting.status !== "confirmed" &&
        ((meeting.attendeeIds.includes(user.id) && !meeting.responses[user.id]) ||
          (meeting.organizerId === user.id && meeting.status === "ready")),
      )
      .sort((a: Meeting, b: Meeting) => meetingDate(a).localeCompare(meetingDate(b)))[0];

    const futureConfirmed = managerMeetings
      .filter((m: Meeting) => m.status === "confirmed" && m.confirmedSlotId)
      .sort((a: Meeting, b: Meeting) => {
        const slotA = a.proposedSlots.find((s) => s.id === a.confirmedSlotId)?.date || "9999-12-31";
        const slotB = b.proposedSlots.find((s) => s.id === b.confirmedSlotId)?.date || "9999-12-31";
        return slotA.localeCompare(slotB);
      })
      .find((m: Meeting) => {
         const slot = m.proposedSlots.find((s) => s.id === m.confirmedSlotId);
         return slot && slot.date >= today;
      });

    const futurePending = managerMeetings
      .filter((m: Meeting) => m.status !== "confirmed")
      .map(m => {
         const sortedSlots = [...m.proposedSlots].sort((a, b) => a.date.localeCompare(b.date));
         const earliestSlot = sortedSlots.find(s => s.date >= today);
         return { meeting: m, date: earliestSlot?.date || "9999-12-31" };
      })
      .filter(item => item.date !== "9999-12-31")
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    if (pendingAction) {
      return {
        type: pendingAction.organizerId === user.id && pendingAction.status === "ready"
          ? "confirmation"
          : "pending",
        title: pendingAction.title,
        date: null,
        label: pendingAction.organizerId === user.id && pendingAction.status === "ready"
          ? "Ready to Confirm"
          : "Pending Vote",
      };
    } else if (futureConfirmed && futurePending) {
       const confirmedDate = futureConfirmed.proposedSlots.find((s) => s.id === futureConfirmed.confirmedSlotId)?.date || "9999-12-31";
       if (confirmedDate <= futurePending.date) {
          const slot = futureConfirmed.proposedSlots.find((s) => s.id === futureConfirmed.confirmedSlotId);
          return { type: "confirmed", title: futureConfirmed.title, date: slot ? `${format(parseISO(slot.date), "d MMM yyyy")} · ${slot.period}` : null };
       } else {
          return { type: "pending", title: futurePending.meeting.title, date: `${format(parseISO(futurePending.date), "d MMM yyyy")} (TBC)` };
       }
    } else if (futureConfirmed) {
       const slot = futureConfirmed.proposedSlots.find((s) => s.id === futureConfirmed.confirmedSlotId);
       return { type: "confirmed", title: futureConfirmed.title, date: slot ? `${format(parseISO(slot.date), "d MMM yyyy")} · ${slot.period}` : null };
    } else if (futurePending) {
       return { type: "pending", title: futurePending.meeting.title, date: `${format(parseISO(futurePending.date), "d MMM yyyy")} (TBC)` };
    }
    return null;
  }, [managerMeetings, user]);

  useEffect(() => {
    if (user?.role !== "manager" || meetingAlert) return;
    const candidates = managerMeetings.flatMap((meeting: Meeting) => {
      const isAttendee = meeting.attendeeIds.includes(user.id);
      const hasResponded = Boolean(meeting.responses[user.id]);
      if (isAttendee && !hasResponded && meeting.status !== "confirmed") {
        const noticeTime = meeting.reminderState[user.id]?.lastSentAt ?? meeting.createdAt;
        return [{
          key: `availability:${meeting.id}:${noticeTime}`,
          title: "Meeting availability needed",
          body: `${meeting.organizerName} is waiting for your availability for "${meeting.title}".`,
          time: noticeTime,
        }];
      }
      if (isAttendee && meeting.lastUpdateNotice) {
        return [{
          key: `updated:${meeting.id}:${meeting.lastUpdateNotice.at}`,
          title: "Meeting updated",
          body: `"${meeting.title}": ${meeting.lastUpdateNotice.summary}.`,
          time: meeting.lastUpdateNotice.at,
        }];
      }
      if (isAttendee && meeting.status === "confirmed") {
        const slot = meeting.proposedSlots.find((item) => item.id === meeting.confirmedSlotId);
        const noticeTime = meeting.confirmedAt ?? meeting.updatedAt;
        return [{
          key: `confirmed:${meeting.id}:${noticeTime}`,
          title: "Meeting confirmed",
          body: slot
            ? `"${meeting.title}" is confirmed for ${format(parseISO(slot.date), "EEE, d MMM yyyy")} ${slot.period}.`
            : `"${meeting.title}" has been confirmed.`,
          time: noticeTime,
        }];
      }
      if (meeting.organizerId === user.id && meeting.status === "ready") {
        const noticeTime = meeting.readyNotifiedAt ?? meeting.updatedAt;
        return [{
          key: `ready:${meeting.id}:${noticeTime}`,
          title: "Meeting ready to confirm",
          body: `All required managers have responded to "${meeting.title}".`,
          time: noticeTime,
        }];
      }
      if (meeting.organizerId === user.id && meeting.lastResponseProgress) {
        const progress = meeting.lastResponseProgress;
        return [{
          key: `progress:${meeting.id}:${progress.at}`,
          title: progress.remainingCount === 0 ? "Everyone responded" : "Meeting response received",
          body: progress.remainingCount === 0
            ? `${progress.responderName} responded to "${meeting.title}". Everyone has now responded.`
            : `${progress.responderName} responded to "${meeting.title}". ${progress.respondedCount} responded, ${progress.remainingCount} left.`,
          time: progress.at,
        }];
      }
      return [];
    }).sort((a, b) => b.time.localeCompare(a.time));
    const next = candidates.find((candidate) => localStorage.getItem(`meeting-alert:${candidate.key}`) !== "seen");
    if (next) setMeetingAlert(next);
  }, [managerMeetings, meetingAlert, user]);

  const closeMeetingAlert = () => {
    if (meetingAlert) localStorage.setItem(`meeting-alert:${meetingAlert.key}`, "seen");
    setMeetingAlert(null);
  };

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
        { href: "/roster-builder", label: "Roster Builder",    icon: LayoutGrid },
        { href: "/vehicle-arrangement", label: "Vehicle Arrangement", icon: Truck },
        // Admin gets read/delete-only access to the meeting scheduler.
        // .scratch/replit-resync-2026-09-21/issues/33.
        { href: "/meetings",       label: "Meetings",          icon: CalendarClock },
      ];
    }
    if (role === "manager") {
      // A manager's workspace root is the meeting scheduler, not the
      // roster — a separate nav set while inside /manager* routes, matching
      // the "Manager workspace switch" toggle rendered below the role
      // badge. .scratch/replit-resync-2026-09-21/issues/33.
      if (location.startsWith("/manager")) {
        return [
          { href: "/manager/meetings", label: "Meetings",    icon: Users },
          { href: "/manager/calendar", label: "My Calendar", icon: CalendarDays },
        ];
      }
      return [
        { href: "/crew-roster",    label: "Deployment Roster", icon: Calendar },
        { href: "/crew-schedule",  label: "Crew Schedule",     icon: CalendarDays },
        { href: "/roster-cycle",   label: "Roster Cycle",      icon: CalendarRange },
        { href: "/upload-brief",   label: "Excel", icon: Upload },
        { href: "/apply",          label: "Leave / Swap",      icon: ArrowLeftRight },
        { href: "/applications",   label: "Applications",      icon: ShieldCheck },
        { href: "/officers",       label: "Officers",          icon: Users },
        { href: "/public-holiday", label: "Public Holiday",    icon: Star },
        { href: "/roster-builder", label: "Roster Builder",    icon: LayoutGrid },
        { href: "/vehicle-arrangement", label: "Vehicle Arrangement", icon: Truck },
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
        { href: "/roster-builder", label: "Roster Builder",    icon: LayoutGrid },
        { href: "/vehicle-arrangement", label: "Vehicle Arrangement", icon: Truck },
      ];
    }
    if (role === "crew") {
      return [
        { href: "/",               label: "Deployment Roster", icon: Calendar },
        { href: "/schedule",       label: "My Schedule",       icon: CalendarDays },
        { href: "/roster-cycle",   label: "Roster Cycle",      icon: CalendarRange },
        { href: "/master-view",    label: "Excel",             icon: Eye },
        { href: "/my-applications",label: "My Leave Status",   icon: ClipboardList },
        { href: "/public-holiday", label: "Public Holiday",    icon: Star },
      ];
    }
    return [];
  }, [user, location]);

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
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can throw without a user gesture, on non-HTTPS, or
      // in embedded/older mobile browsers — surface it instead of failing
      // silently. .scratch/replit-resync-2026-09-21/issues/13.
      toast({ title: "Copy failed", description: "Could not copy the summary to the clipboard.", variant: "destructive" });
    }
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

  // ── Notification bell ─────────────────────────────────────────────────────
  const [notifications,  setNotifications]  = useState<ActivityEntry[]>([]);
  const [notifOpen,      setNotifOpen]      = useState(false);
  const [lastSeenTs,     setLastSeenTs]     = useState<string>(
    () => localStorage.getItem("notif_last_seen") ?? ""
  );

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/activity-log", { credentials: "include" });
      if (res.ok) setNotifications(await res.json());
    } catch {}
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  const unreadCount = notifications.filter(n => n.createdAt > lastSeenTs).length;

  const openNotifPanel = () => {
    const now = new Date().toISOString();
    localStorage.setItem("notif_last_seen", now);
    setLastSeenTs(now);
    setNotifOpen(v => !v);
  };

  const clearNotifications = () => {
    setNotifications([]);
    const now = new Date().toISOString();
    localStorage.setItem("notif_last_seen", now);
    setLastSeenTs(now);
  };

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
          {/* Notification bell */}
          <button
            onClick={openNotifPanel}
            className="relative p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Notifications"
          >
            <Bell className="h-3.5 w-3.5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center leading-none">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
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

      {/* Manager workspace switch — the meeting scheduler ("Manager") vs.
          the roster views ("Crew Roster"), manager role only.
          .scratch/replit-resync-2026-09-21/issues/33. */}
      {user?.role === "manager" && (
        <div className="grid grid-cols-2 gap-2 p-3 border-b shrink-0">
          <Link href="/manager">
            <div className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-bold cursor-pointer transition-colors",
              location.startsWith("/manager")
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted text-muted-foreground",
            )}>
              <Users className="h-4 w-4" />
              Manager
            </div>
          </Link>
          <Link href="/crew-roster">
            <div className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-bold cursor-pointer transition-colors",
              !location.startsWith("/manager")
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted text-muted-foreground",
            )}>
              <CalendarDays className="h-4 w-4" />
              Crew Roster
            </div>
          </Link>
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

      {/* Meeting shortcut for managers while working in Crew Roster —
          deep-links back into whichever meeting most needs their attention.
          .scratch/replit-resync-2026-09-21/issues/33. */}
      {user?.role === "manager" && !location.startsWith("/manager") && meetingShortcut && (
        <Link href={meetingShortcut.type === "pending" ? "/manager/meetings?tab=pending-mine" : "/manager/meetings?tab=confirmed"}>
          <div className="mx-3 mt-3 mb-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 cursor-pointer hover:bg-primary/10 transition-colors">
            <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold text-primary uppercase tracking-widest">
               {meetingShortcut.type === "pending" ? <Clock className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
               {meetingShortcut.label ?? (meetingShortcut.type === "pending" ? "Pending Vote" : "Upcoming Meeting")}
            </div>
            <p className="text-xs font-semibold truncate text-foreground">{meetingShortcut.title}</p>
            {meetingShortcut.date && <p className="text-[10px] text-muted-foreground mt-0.5">{meetingShortcut.date}</p>}
          </div>
        </Link>
      )}

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

      {/* ── Notification panel (fixed-position, outside sidebar to avoid overflow-hidden) ── */}
      {notifOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
          <div className="fixed left-0 top-14 z-50 w-72 border-r border-b rounded-br-xl bg-popover shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
            <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/50 shrink-0">
              <span className="text-xs font-bold text-foreground">Notifications</span>
              <div className="flex items-center gap-1">
                {notifications.length > 0 && (
                  <button
                    onClick={clearNotifications}
                    className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                    title="Clear all notifications"
                  >
                    Clear all
                  </button>
                )}
                <button onClick={() => setNotifOpen(false)} className="p-0.5 rounded hover:bg-muted">
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className="px-3 py-2.5 border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <p className="text-xs font-semibold text-foreground leading-snug">{n.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">{formatRelativeTime(n.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

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

      {/* In-app meeting notification — independent of browser push
          permission. .scratch/replit-resync-2026-09-21/issues/33. */}
      <Dialog open={Boolean(meetingAlert)} onOpenChange={(open) => { if (!open) closeMeetingAlert(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{meetingAlert?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{meetingAlert?.body}</p>
          <DialogFooter>
            <Button variant="outline" onClick={closeMeetingAlert}>Later</Button>
            <Button onClick={() => {
              closeMeetingAlert();
               setLocation(user?.role === "manager" ? "/manager" : "/meetings");
            }}>
              Open Meetings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
