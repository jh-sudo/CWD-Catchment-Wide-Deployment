import React, { useState } from "react";
import { eachDayOfInterval, format, parseISO } from "date-fns";
import { CalendarDays, Plus, Trash2, Loader2, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useManagerCalendarEvents,
  useCreateManagerCalendarEvent,
  useDeleteManagerCalendarEvent,
  useMeetings
} from "@/hooks/useMeetings";

export default function ManagerCalendar() {
  const { user } = useAuth();
  const { data: meetings = [] } = useMeetings();
  const { data: events, isLoading: isLoadingEvents } = useManagerCalendarEvents();
  const createEvent = useCreateManagerCalendarEvent();
  const deleteEvent = useDeleteManagerCalendarEvent();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [eventType, setEventType] = useState<"out-of-office" | "meeting" | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  const { data: leaveRequests = [], isLoading: isLoadingLeaves } = useQuery<any[]>({
    queryKey: ["leave-requests", user?.officerId],
    queryFn: async () => {
      if (!user?.officerId) return [];
      const res = await fetch("/api/leave-requests", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leave requests");
      const data: any[] = await res.json();
      return data.filter((request) =>
        request.officerId === user.officerId &&
        ["PENDING_COVER", "PENDING_IC", "APPROVED"].includes(request.status)
      );
    },
    enabled: !!user?.officerId,
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      toast({ title: "Dates required", variant: "destructive" });
      return;
    }
    if (startDate > endDate) {
      toast({ title: "Start date must be before end date", variant: "destructive" });
      return;
    }
    try {
      await createEvent.mutateAsync({ type: "out-of-office", startDate, endDate, note });
      toast({ title: "Event added" });
      setIsAddOpen(false);
      setEventType(null);
      setStartDate("");
      setEndDate("");
      setNote("");
    } catch (err: any) {
      toast({ title: "Failed to add event", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this event?")) return;
    try {
      await deleteEvent.mutateAsync(id);
      toast({ title: "Event deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete event", description: err.message, variant: "destructive" });
    }
  };

  const myEvents = (events || []).filter(e => e.isOwn).sort((a, b) => a.startDate.localeCompare(b.startDate));

  const outOfOfficeDays: Date[] = [];
  leaveRequests.forEach((request) => {
    outOfOfficeDays.push(parseISO(request.date));
  });
  myEvents.filter(e => e.type === "leave").forEach(e => {
    outOfOfficeDays.push(...eachDayOfInterval({ start: parseISO(e.startDate), end: parseISO(e.endDate) }));
  });
  myEvents.filter(e => e.type === "out-of-office").forEach(e => {
    outOfOfficeDays.push(...eachDayOfInterval({ start: parseISO(e.startDate), end: parseISO(e.endDate) }));
  });

  const meetingDaysMap = new Map<string, any[]>();
  const confirmedUserMeetings = meetings.filter(m =>
    m.status === "confirmed" &&
    m.confirmedSlotId &&
    (m.organizerId === user?.id || m.attendeeIds.includes(user?.id!))
  );

  confirmedUserMeetings.forEach(m => {
    const slot = m.proposedSlots.find(s => s.id === m.confirmedSlotId);
    if (slot) {
      const dStr = slot.date;
      if (!meetingDaysMap.has(dStr)) meetingDaysMap.set(dStr, []);
      meetingDaysMap.get(dStr)!.push({ meeting: m, slot });
    }
  });

  const meetingDays = Array.from(meetingDaysMap.keys()).map(d => parseISO(d));

  const selectedDateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;

  const selectedLeaves: any[] = [];
  leaveRequests.forEach((request) => {
    if (selectedDateStr && request.date === selectedDateStr) {
      selectedLeaves.push({ source: "api", data: request });
    }
  });
  myEvents.filter(e => e.type === "leave").forEach(e => {
    if (selectedDateStr && e.startDate <= selectedDateStr && e.endDate >= selectedDateStr) {
      selectedLeaves.push({ source: "manual", data: e });
    }
  });

  const selectedOOS = myEvents.filter(e => e.type === "out-of-office").filter(e => {
    return selectedDateStr && e.startDate <= selectedDateStr && e.endDate >= selectedDateStr;
  });

  const selectedMeetings = selectedDateStr ? meetingDaysMap.get(selectedDateStr) || [] : [];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">My Calendar</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base font-medium">
               Manage your out-of-office dates to avoid meeting conflicts. Approved and pending leave is included automatically.
            </p>
          </div>
          <Button onClick={() => { setEventType(null); setIsAddOpen(true); }} className="shrink-0 shadow-sm font-bold">
            <Plus className="h-4 w-4 mr-2" />
            Add Event
          </Button>
        </div>

        <div className="grid lg:grid-cols-7 gap-6 items-start">
          <div className="lg:col-span-4 space-y-6">
            <Card className="shadow-sm">
              <CardHeader className="bg-muted/30 pb-4 border-b">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CalendarDays className="h-5 w-5" />
                  Calendar View
                </CardTitle>
                <CardDescription className="font-medium mt-2 space-y-2 text-foreground">
                  <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 flex items-center justify-center">
                        <span className="text-xs text-purple-700 dark:text-purple-400">1</span>
                      </div>
                      <span className="text-muted-foreground">Out of Office</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 ring-2 ring-inset ring-green-500 rounded-full flex items-center justify-center">
                        <span className="text-[10px] text-muted-foreground">2</span>
                      </div>
                      <span className="text-muted-foreground">Meeting</span>
                    </div>
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 sm:p-6 flex flex-col">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  modifiers={{ oos: outOfOfficeDays, meeting: meetingDays }}
                  modifiersClassNames={{
                    oos: "[&>button]:!text-purple-700 dark:[&>button]:!text-purple-400 [&>button]:font-bold",
                    meeting: "[&>button]:rounded-full [&>button]:ring-2 [&>button]:ring-inset [&>button]:ring-green-500",
                  }}
                  className="w-full"
                  classNames={{
                    root: "w-full",
                    months: "w-full flex flex-col gap-4",
                    month: "w-full flex flex-col gap-4",
                    table: "w-full border-collapse",
                    weekdays: "flex w-full",
                    weekday: "text-muted-foreground flex-1 select-none text-[0.8rem] font-normal text-center",
                    week: "mt-2 flex w-full",
                    day: "group/day relative flex-1 aspect-square select-none p-0 text-center",
                  }}
                />

                {selectedDateStr ? (
                  <div className="mt-8 pt-6 border-t animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <h4 className="font-bold text-sm text-muted-foreground mb-4 uppercase tracking-wider">
                      {format(selectedDate!, "EEEE, d MMM yyyy")}
                    </h4>
                    <div className="space-y-3">
                      {selectedLeaves.length === 0 && selectedOOS.length === 0 && selectedMeetings.length === 0 ? (
                        <p className="text-sm font-medium text-muted-foreground py-2 text-center bg-muted/20 rounded-md">No events scheduled.</p>
                      ) : (
                        <>
                          {selectedLeaves.map((l, i) => (
                            <div key={`leave-${i}`} className="flex items-start gap-3 bg-purple-50/50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30 p-3 rounded-lg">
                              <div className="mt-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 p-1.5 rounded-md shrink-0">
                                <Briefcase className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-purple-950 dark:text-purple-100">Out of Office</p>
                                {l.source === "api" ? (
                                  <p className="text-xs text-purple-800/80 dark:text-purple-200/80 font-semibold mt-0.5">
                                    Leave: {l.data.leaveType || "General"} • Status: <span>{String(l.data.status).replaceAll("_", " ")}</span>
                                  </p>
                                ) : (
                                  <p className="text-xs text-purple-800/80 dark:text-purple-200/80 font-semibold mt-0.5">{l.data.note ? `Note: ${l.data.note}` : "Manual Entry"}</p>
                                )}
                              </div>
                            </div>
                          ))}
                          {selectedOOS.map((o, i) => (
                            <div key={`oos-${i}`} className="flex items-start gap-3 bg-purple-50/50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30 p-3 rounded-lg">
                              <div className="mt-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 p-1.5 rounded-md shrink-0">
                                <Briefcase className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-purple-950 dark:text-purple-100">Out of Office</p>
                                <p className="text-xs text-purple-800/80 dark:text-purple-200/80 font-semibold mt-0.5">{o.note ? `Note: ${o.note}` : "Manual Entry"}</p>
                              </div>
                            </div>
                          ))}
                          {selectedMeetings.map((m, i) => (
                            <div key={`meeting-${i}`} className="flex items-start gap-3 bg-green-50/50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 p-3 rounded-lg">
                              <div className="mt-0.5 ring-2 ring-inset ring-green-500 text-green-600 dark:text-green-500 p-1.5 rounded-full shrink-0 bg-background">
                                <CalendarDays className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-green-950 dark:text-green-100">{m.meeting.title || "Meeting"}</p>
                                <p className="text-xs text-green-800/80 dark:text-green-200/80 font-semibold mt-0.5">
                                  {m.slot.period} • {m.meeting.location}
                                </p>
                                <p className="text-xs text-green-800/80 dark:text-green-200/80 font-medium">Organizer: {m.meeting.organizerName || "Unknown"}</p>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-8 pt-6 border-t text-center">
                    <p className="text-sm font-medium text-muted-foreground py-4 bg-muted/20 rounded-md">Select a date to view details</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-3">
            <Card className="shadow-sm">
              <CardHeader className="bg-muted/30 pb-4 border-b">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CalendarDays className="h-5 w-5" />
                  Manually Added
                </CardTitle>
                <CardDescription className="font-medium">Self-entered out-of-office periods.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
          {isLoadingEvents || isLoadingLeaves ? (
                  <div className="p-12 flex justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : myEvents.length === 0 ? (
                  <div className="p-12 text-center flex flex-col items-center justify-center">
                    <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                      <CalendarDays className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-semibold text-muted-foreground">You have no manually added events.</p>
                  </div>
                ) : (
                  <div className="divide-y max-h-[600px] overflow-y-auto">
                    {myEvents.map(ev => {
                      const sDate = parseISO(ev.startDate);
                      const eDate = parseISO(ev.endDate);
                      const sameDay = ev.startDate === ev.endDate;
                      return (
                        <div key={ev.id} className="p-4 sm:p-5 flex items-start justify-between gap-4 hover:bg-muted/10 transition-colors">
                          <div className="flex gap-4 items-start">
                            <div className="mt-0.5 shrink-0">
                              <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 flex items-center justify-center">
                                <Briefcase className="h-5 w-5" />
                              </div>
                            </div>
                            <div>
                              <h4 className="font-bold text-foreground flex items-center gap-2">
                                Out of Office
                              </h4>
                              <p className="text-sm font-semibold text-muted-foreground mt-0.5">
                                {sameDay
                                  ? format(sDate, "EEEE, d MMM yyyy")
                                  : `${format(sDate, "d MMM")} — ${format(eDate, "d MMM yyyy")}`}
                              </p>
                              {ev.note && (
                                <p className="text-xs text-muted-foreground mt-2 italic bg-muted/30 p-2 rounded-md border border-border/50">
                                  "{ev.note}"
                                </p>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                            onClick={() => handleDelete(ev.id)}
                            disabled={deleteEvent.isPending}
                          >
                            {deleteEvent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent className="sm:max-w-md">
            {eventType === null ? (
              <>
                <DialogHeader>
                  <DialogTitle>Add Event</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-5">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto justify-start gap-3 p-4 text-left"
                    onClick={() => setEventType("out-of-office")}
                  >
                    <Briefcase className="h-5 w-5 text-purple-600 shrink-0" />
                    <span>
                      <span className="block font-bold">Out of Office</span>
                      <span className="block text-xs font-medium text-muted-foreground">Add dates when you are unavailable.</span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto justify-start gap-3 p-4 text-left"
                    onClick={() => {
                      setIsAddOpen(false);
                      setLocation("/manager/meetings?tab=new");
                    }}
                  >
                    <CalendarDays className="h-5 w-5 text-green-600 shrink-0" />
                    <span>
                      <span className="block font-bold">Meeting</span>
                      <span className="block text-xs font-medium text-muted-foreground">Create a meeting and invite attendees.</span>
                    </span>
                  </Button>
                </div>
              </>
            ) : (
            <form onSubmit={handleAdd}>
              <DialogHeader>
                <DialogTitle>Add Out of Office</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label className="font-bold text-sm">Start Date</Label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                  </div>
                  <div className="grid gap-2">
                    <Label className="font-bold text-sm">End Date</Label>
                    <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="font-bold text-sm">Note (Optional)</Label>
                  <Input placeholder="e.g. Medical appointment" value={note} onChange={e => setNote(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEventType(null)} className="font-bold">
                  Back
                </Button>
                <Button type="submit" disabled={createEvent.isPending} className="font-bold">
                  {createEvent.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Event
                </Button>
              </DialogFooter>
            </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
