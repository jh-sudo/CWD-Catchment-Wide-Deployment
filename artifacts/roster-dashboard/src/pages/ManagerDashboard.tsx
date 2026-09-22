import React, { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { Calendar as CalendarIcon, Clock, CheckCircle2, ChevronRight, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useMeetings, attendeeNeedsToRespond, organizerNeedsToConfirm, type Meeting } from "@/hooks/useMeetings";

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { data: meetings, isLoading } = useMeetings(true);

  const { todaysMeetings, upcomingMeetings, pendingConfirmation } = useMemo(() => {
    if (!meetings || !user) return { todaysMeetings: [], upcomingMeetings: [], pendingConfirmation: [] };

    const todayStr = format(new Date(), "yyyy-MM-dd");

    const todays: Meeting[] = [];
    const upcoming: Meeting[] = [];
    const pending: Meeting[] = [];

    for (const m of meetings) {
      if (m.status === "confirmed" && m.confirmedSlotId) {
        const slot = m.proposedSlots.find(s => s.id === m.confirmedSlotId);
        if (slot) {
          if (slot.date === todayStr) {
            todays.push(m);
          } else if (slot.date >= todayStr) {
            upcoming.push(m);
          }
        }
      } else if (organizerNeedsToConfirm(m, user.id) || attendeeNeedsToRespond(m, user.id)) {
        pending.push(m);
      }
    }

    upcoming.sort((a, b) => {
      const slotA = a.proposedSlots.find(s => s.id === a.confirmedSlotId);
      const slotB = b.proposedSlots.find(s => s.id === b.confirmedSlotId);
      return (slotA?.date || "").localeCompare(slotB?.date || "");
    });

    return { todaysMeetings: todays, upcomingMeetings: upcoming, pendingConfirmation: pending };
  }, [meetings, user]);

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300 pb-16">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Manager Command Center</h1>
        <p className="text-muted-foreground mt-1 text-sm md:text-base font-medium">
          Welcome back, {user?.username}. Here is your operational overview.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="col-span-1 md:col-span-2 shadow-sm border-primary/10">
          <CardHeader className="bg-muted/30 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Today's Meetings
                </CardTitle>
                <CardDescription className="mt-1 font-medium">
                  {todaysMeetings.length} meeting{todaysMeetings.length !== 1 && "s"} scheduled for today.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {todaysMeetings.length === 0 ? (
              <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                No meetings scheduled for today.
              </div>
            ) : (
              <div className="divide-y">
                {todaysMeetings.map(m => {
                  const slot = m.proposedSlots.find(s => s.id === m.confirmedSlotId);
                  return (
                    <div key={m.id} className="p-4 flex items-center justify-between hover:bg-muted/20 transition-colors">
                      <div>
                        <h4 className="font-bold text-foreground">{m.title}</h4>
                        <div className="flex items-center gap-3 mt-1 text-xs font-semibold text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {slot?.period}
                          </span>
                          <span className="flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {m.location}
                          </span>
                        </div>
                      </div>
                      <Link href="/manager/meetings" className="h-8 w-8 rounded-full flex items-center justify-center bg-secondary hover:bg-primary hover:text-primary-foreground transition-colors shrink-0">
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-destructive/20 bg-destructive/5">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <CheckCircle2 className="h-5 w-5" />
              Action Required
            </CardTitle>
            <CardDescription className="mt-1 font-medium text-destructive/80">
              {pendingConfirmation.length} poll{pendingConfirmation.length !== 1 && "s"} awaiting confirmation.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {pendingConfirmation.length === 0 ? (
              <div className="p-6 text-center text-sm font-medium text-destructive/60">
                You're all caught up.
              </div>
            ) : (
              <div className="divide-y divide-destructive/10">
                {pendingConfirmation.map(m => (
                  <div key={m.id} className="p-4 hover:bg-destructive/10 transition-colors">
                    <h4 className="font-bold text-foreground text-sm">{m.title}</h4>
                    <p className="text-xs font-medium text-muted-foreground mt-1 mb-3 truncate">
                      Ready to select a final date.
                    </p>
                    <Link href={`/manager/meetings`} className="block text-center w-full py-1.5 px-3 bg-destructive text-destructive-foreground rounded text-xs font-bold shadow-sm hover:bg-destructive/90 transition-colors">
                      Confirm Date
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="bg-muted/30 pb-4">
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-muted-foreground" />
            Upcoming Meetings
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {upcomingMeetings.length === 0 ? (
            <div className="p-8 text-center text-sm font-medium text-muted-foreground">
              No upcoming confirmed meetings.
            </div>
          ) : (
            <div className="divide-y">
              {upcomingMeetings.slice(0, 5).map(m => {
                const slot = m.proposedSlots.find(s => s.id === m.confirmedSlotId);
                const dateObj = slot ? parseISO(slot.date) : new Date();
                return (
                  <div key={m.id} className="p-4 flex items-center gap-4 hover:bg-muted/20 transition-colors">
                    <div className="w-16 h-16 shrink-0 rounded-lg bg-secondary flex flex-col items-center justify-center border border-border/50">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">{format(dateObj, "MMM")}</span>
                      <span className="text-lg font-black text-foreground leading-none mt-0.5">{format(dateObj, "dd")}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-foreground truncate">{m.title}</h4>
                      <p className="text-xs font-semibold text-muted-foreground mt-1 truncate">
                        {format(dateObj, "EEEE")} &middot; {slot?.period} &middot; {m.location}
                      </p>
                    </div>
                    <Link href="/manager/meetings" className="h-8 w-8 rounded-full flex items-center justify-center bg-secondary hover:bg-primary hover:text-primary-foreground transition-colors shrink-0">
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
