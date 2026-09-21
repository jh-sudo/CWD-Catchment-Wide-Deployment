import { useEffect, useState, useMemo, type FormEvent } from "react";
import { format, parseISO, isSameDay } from "date-fns";
import {
  Plus, Check, Loader2, Calendar as CalendarIcon, Clock, X, ChevronsUpDown,
  AlertCircle, Tags, Trash2, Edit2, ShieldAlert, MapPin,
  Users, Plane, Briefcase
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  useMeetings,
  useMeetingAccounts,
  useMeetingGroups,
  useCreateMeeting,
  useUpdateMeeting,
  useSubmitAvailability,
  useConfirmMeeting,
  useDeleteMeeting,
  useSaveMeetingGroup,
  useDeleteMeetingGroup,
  useManagerCalendarEvents,
  type Meeting,
  type MeetingGroup
} from "@/hooks/useMeetings";

const FIXED_LOCATIONS = [
  "MSE Hall", "MSE Function Room 1", "MSE Function Room 2", "MSE Function Room 3",
  "MSE Function Room 4", "MSE Function Room 5", "PUBRC Workshop", "PUBRC Studio", "PUBRC Den",
];

function LocationSelect({ value, onChange, meetings = [] }: { value: string; onChange: (val: string) => void; meetings?: Meeting[]; }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"fixed" | "custom">(value && !FIXED_LOCATIONS.includes(value) ? "custom" : "fixed");

  const derivedLocations = useMemo(() => {
    const s = new Set<string>();
    meetings.forEach(m => {
       if (m.location && !FIXED_LOCATIONS.includes(m.location) && m.location !== "Others") s.add(m.location);
    });
    return Array.from(s).sort();
  }, [meetings]);

  useEffect(() => {
    if (value && mode === "fixed" && !FIXED_LOCATIONS.includes(value) && !derivedLocations.includes(value)) {
       setMode("custom");
    }
  }, [value, derivedLocations, mode]);

  return (
    <div className="space-y-2 w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal text-foreground border-border shadow-sm">
            <span className="truncate">{mode === "fixed" ? (value || "Select location...") : "Others (Custom)"}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search location..." />
            <CommandList className="max-h-60 overflow-auto">
              <CommandEmpty>No location found.</CommandEmpty>
              <CommandGroup heading="Fixed Locations">
                {FIXED_LOCATIONS.map(loc => (
                  <CommandItem key={loc} value={loc} onSelect={() => { onChange(loc); setMode("fixed"); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === loc && mode === "fixed" ? "opacity-100" : "opacity-0")} />
                    {loc}
                  </CommandItem>
                ))}
              </CommandGroup>
              {derivedLocations.length > 0 && (
                <CommandGroup heading="Previous Custom Locations">
                  {derivedLocations.map(loc => (
                    <CommandItem key={loc} value={loc} onSelect={() => { onChange(loc); setMode("fixed"); setOpen(false); }}>
                      <Check className={cn("mr-2 h-4 w-4", value === loc && mode === "fixed" ? "opacity-100" : "opacity-0")} />
                      {loc}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandGroup heading="Custom">
                <CommandItem value="Others" onSelect={() => { setMode("custom"); onChange(""); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", mode === "custom" ? "opacity-100" : "opacity-0")} />
                  Others (Enter custom)
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {mode === "custom" && <Input placeholder="Enter custom location..." value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function AttendeeSelect({ selectedIds, onChange, label, excludeIds = [] }: { selectedIds: string[]; onChange: (ids: string[]) => void; label: string; excludeIds?: string[]; }) {
  const [open, setOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const { user } = useAuth();
  const { data: accounts, isLoading } = useMeetingAccounts();
  const { data: groups } = useMeetingGroups();

  const options = useMemo(() => {
    if (!accounts) return [];
    return accounts.filter((acc) => acc.id !== user?.id && !excludeIds.includes(acc.id)).map((acc) => ({
      value: acc.id,
      label: acc.displayName || acc.username,
      role: acc.role,
    }));
  }, [accounts, user?.id, excludeIds]);

  const toggleOption = (val: string) => {
    if (selectedIds.includes(val)) onChange(selectedIds.filter((id) => id !== val));
    else onChange([...selectedIds, val]);
  };

  const visibleOptions = useMemo(() => {
    if (!groupFilter || !groups) return options;
    const g = groups.find(x => x.id === groupFilter);
    if (!g) return options;
    return options.filter(o => g.memberIds.includes(o.value));
  }, [groupFilter, groups, options]);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm font-bold">{label}</Label>
      {groups && groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant={groupFilter === null ? "default" : "outline"} onClick={() => setGroupFilter(null)} className="h-7 text-xs font-medium">All</Button>
          {groups.map((g) => (
            <Button key={g.id} type="button" size="sm" variant={groupFilter === g.id ? "default" : "outline"} onClick={() => setGroupFilter(g.id)} className="h-7 text-xs font-medium">{g.name}</Button>
          ))}
        </div>
      )}
      {groupFilter && visibleOptions.length > 0 && (
        <Button type="button" variant="secondary" size="sm" className="self-start h-7 text-xs font-medium" onClick={() => onChange([...new Set([...selectedIds, ...visibleOptions.map((o) => o.value)])])}>Select all in group</Button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal text-left h-auto min-h-10 bg-background border-border shadow-sm">
            {selectedIds.length > 0 ? <span className="truncate font-semibold text-foreground">{selectedIds.length} selected</span> : <span className="text-muted-foreground font-medium">Select attendees...</span>}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search attendees..." />
            <CommandList className="max-h-[250px] overflow-y-auto">
              <CommandEmpty>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mx-auto my-2 text-muted-foreground" /> : "No attendees found."}</CommandEmpty>
              <CommandGroup>
                {visibleOptions.map((opt) => (
                  <CommandItem key={opt.value} value={opt.label} onSelect={() => toggleOption(opt.value)}>
                    <Check className={cn("mr-2 h-4 w-4", selectedIds.includes(opt.value) ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col"><span className="font-semibold">{opt.label}</span><span className="text-[10px] text-muted-foreground capitalize font-bold">{opt.role}</span></div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {selectedIds.map((id) => {
            const acc = options.find((o) => o.value === id) || accounts?.find(a => a.id === id);
            if (!acc) return null;
            const name = "label" in acc ? acc.label : acc.displayName || acc.username;
            return (
              <Badge key={id} variant="secondary" className="flex items-center gap-1 text-xs px-2 py-0.5 font-bold shadow-sm">
                {name}
                <button type="button" className="rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 ml-1" onClick={() => toggleOption(id)}>
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MyGroupsTab() {
  const { data: groups, isLoading } = useMeetingGroups();
  const { data: accounts } = useMeetingAccounts();
  const { user } = useAuth();
  const saveGroup = useSaveMeetingGroup();
  const deleteGroup = useDeleteMeetingGroup();
  const { toast } = useToast();

  const [editingGroup, setEditingGroup] = useState<Partial<MeetingGroup> | null>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);

  const startCreate = () => { setEditingGroup({}); setName(""); setMembers([]); };
  const startEdit = (g: MeetingGroup) => { setEditingGroup(g); setName(g.name); setMembers(g.memberIds); };
  const cancelEdit = () => setEditingGroup(null);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (members.length === 0) { toast({ title: "Select at least one member", variant: "destructive" }); return; }
    try {
      await saveGroup.mutateAsync({ id: editingGroup?.id, name: name.trim(), memberIds: members });
      toast({ title: "Group saved" });
      setEditingGroup(null);
    } catch (err: any) { toast({ title: "Failed to save", description: err.message, variant: "destructive" }); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete group?")) return;
    try {
      await deleteGroup.mutateAsync(id);
      toast({ title: "Group deleted" });
    } catch (err: any) { toast({ title: "Failed to delete", description: err.message, variant: "destructive" }); }
  };

  const accountOptions = useMemo(() => (accounts || []).filter(a => a.id !== user?.id).map(a => ({ value: a.id, label: a.displayName || a.username })), [accounts, user?.id]);

  if (editingGroup) {
    return (
      <form onSubmit={handleSave} className="space-y-6 max-w-xl bg-card p-6 border rounded-xl shadow-sm animate-in fade-in zoom-in-95 duration-200">
        <div className="space-y-2">
          <Label className="font-bold text-base">Group Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. FOB Managers" className="h-11 shadow-sm font-medium" />
        </div>
        <div className="space-y-2">
          <Label className="font-bold text-base">Select Members</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border rounded-md p-4 bg-muted/10 shadow-inner">
            {accountOptions.map(acc => (
              <label key={acc.value} className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer transition-colors">
                <Checkbox checked={members.includes(acc.value)} onCheckedChange={(c) => setMembers(curr => c ? [...curr, acc.value] : curr.filter(id => id !== acc.value))} />
                <span className="text-sm font-semibold">{acc.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={cancelEdit} className="font-bold shadow-sm">Cancel</Button>
          <Button type="submit" disabled={saveGroup.isPending} className="font-bold shadow-sm">
            {saveGroup.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Group
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border shadow-sm">
        <div>
          <h2 className="text-lg font-bold">Manager Groups</h2>
          <p className="text-sm text-muted-foreground font-medium">Create reusable groups for meeting polls.</p>
        </div>
        <Button onClick={startCreate} className="shrink-0 font-bold shadow-sm"><Plus className="h-4 w-4 mr-2"/> Create Group</Button>
      </div>

      {isLoading ? (
        <div className="py-10 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !groups?.length ? (
        <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 border-2 rounded-xl border-dashed bg-card/50">
          <Tags className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm font-semibold text-muted-foreground">You haven't created any groups yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(g => (
            <Card key={g.id} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow border-primary/10">
              <CardHeader className="pb-3 bg-muted/20 border-b">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-base font-bold">{g.name}</CardTitle>
                  <div className="flex gap-1 -mt-1 -mr-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => startEdit(g)}><Edit2 className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(g.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <CardDescription className="font-semibold">{g.memberIds.length} members</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 text-sm font-medium text-foreground leading-relaxed">
                {g.memberIds.map(id => accountOptions.find(a => a.value === id)?.label || "Unknown").join(", ")}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NewMeetingTab({ onSuccess }: { onSuccess: () => void }) {
  const { data: meetings = [] } = useMeetings();
  const { data: calendarEvents } = useManagerCalendarEvents();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [requiredIds, setRequiredIds] = useState<string[]>([]);
  const [optionalIds, setOptionalIds] = useState<string[]>([]);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [periods, setPeriods] = useState<Record<string, { AM: boolean; PM: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  const createMeeting = useCreateMeeting();
  const { toast } = useToast();

  const slots = useMemo(() => selectedDates.flatMap((date) => {
      const dateKey = format(date, "yyyy-MM-dd");
      const selectedPeriods = periods[dateKey] ?? { AM: true, PM: true };
      return (["AM", "PM"] as const).filter((period) => selectedPeriods[period]).map((period) => ({ date: dateKey, period }));
    }), [selectedDates, periods]);

  const handleDateSelect = (dates: Date[] | undefined) => {
    const nextDates = dates ?? [];
    setSelectedDates(nextDates);
    setPeriods((current) => Object.fromEntries(nextDates.map((date) => {
      const key = format(date, "yyyy-MM-dd");
      return [key, current[key] ?? { AM: true, PM: true }];
    })));
  };

  const togglePeriod = (dateKey: string, period: "AM" | "PM") => {
    setPeriods((current) => ({
      ...current,
      [dateKey]: { ...(current[dateKey] ?? { AM: true, PM: true }), [period]: !(current[dateKey] ?? { AM: true, PM: true })[period] }
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError("Title is required"); return; }
    if (!location.trim()) { setError("Location is required"); return; }
    if (selectedDates.length < 2) { setError("Select at least two proposed dates"); return; }
    if (slots.length < 1) { setError("Enable AM or PM for the selected dates"); return; }
    if (requiredIds.length === 0) { setError("Select at least one required attendee"); return; }
    try {
      await createMeeting.mutateAsync({ title: title.trim(), location: location.trim(), proposedSlots: slots, requiredAttendeeIds: requiredIds, optionalAttendeeIds: optionalIds });
      toast({ title: "Meeting created" });
      setTitle(""); setLocation(""); setSelectedDates([]); setPeriods({}); setRequiredIds([]); setOptionalIds([]);
      onSuccess();
    } catch (err: any) { setError(err.message || "Failed to create meeting"); }
  };

  return (
    <div className="max-w-2xl animate-in fade-in duration-300">
      <form onSubmit={handleSubmit} className="space-y-8 bg-card border border-border/50 rounded-xl p-4 sm:p-8 shadow-sm">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-primary">New Meeting Poll</h2>
          <p className="text-sm text-muted-foreground mt-1 font-medium">Set proposed dates and invite managers to vote.</p>
        </div>
        {error && (
          <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm font-semibold flex items-center border border-destructive/20 shadow-sm">
            <AlertCircle className="h-4 w-4 mr-2 shrink-0" />{error}
          </div>
        )}
        <div className="space-y-3">
          <Label htmlFor="title" className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Meeting Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. FOB Weekly Sync" className="text-base h-11 shadow-sm font-semibold" />
        </div>
        <div className="space-y-3">
          <Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Location</Label>
          <LocationSelect value={location} onChange={setLocation} meetings={meetings} />
        </div>
        <div className="grid gap-8 pt-4 border-t">
          <div className="space-y-6">
            <AttendeeSelect label="REQUIRED ATTENDEES" selectedIds={requiredIds} onChange={setRequiredIds} excludeIds={optionalIds} />
            <AttendeeSelect label="OPTIONAL ATTENDEES" selectedIds={optionalIds} onChange={setOptionalIds} excludeIds={requiredIds} />
          </div>
          <div className="space-y-4 pt-4 border-t">
            <div>
              <Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Proposed Dates</Label>
              <p className="text-sm text-muted-foreground mt-1 font-medium">Select multiple dates, then choose AM/PM. Dates with attendee absences are highlighted.</p>
            </div>
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="rounded-xl border bg-card flex justify-center p-3 shadow-sm w-full md:w-auto max-w-full overflow-hidden">
                <Calendar mode="multiple" selected={selectedDates} onSelect={handleDateSelect} disabled={{ before: new Date() }} className="w-full max-w-full overflow-x-auto overflow-y-hidden [--cell-size:2rem] sm:[--cell-size:2.5rem]" />
              </div>
              <div className="flex-1 w-full space-y-3 min-w-[200px]">
                {selectedDates.length === 0 ? (
                  <div className="h-full min-h-[200px] flex items-center justify-center border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground text-sm font-bold bg-muted/10">Select dates from the calendar</div>
                ) : (
                  <div className="space-y-2 pr-2">
                    {selectedDates.slice().sort((a, b) => a.getTime() - b.getTime()).map((date) => {
                      const dateKey = format(date, "yyyy-MM-dd");
                      const selectedPeriods = periods[dateKey] ?? { AM: true, PM: true };
                      const allAttendees = [...requiredIds, ...optionalIds];
                      const conflicts = (calendarEvents || []).filter(ev => ev.startDate <= dateKey && ev.endDate >= dateKey && allAttendees.includes(ev.ownerId));

                      return (
                        <div key={dateKey} className={cn("flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm transition-colors", conflicts.length > 0 && "border-amber-400 bg-amber-50/10 dark:border-amber-900/50 dark:bg-amber-900/10")}>
                          <div className="flex sm:flex-row flex-col sm:items-center justify-between gap-3">
                            <span className="text-sm font-bold text-foreground">{format(date, "EEE, d MMM yyyy")}</span>
                            <div className="flex gap-2">
                              {(["AM", "PM"] as const).map((period) => (
                                <Button key={period} type="button" size="sm" variant={selectedPeriods[period] ? "default" : "outline"} onClick={() => togglePeriod(dateKey, period)} className={cn("h-8 flex-1 sm:flex-none font-bold shadow-sm", selectedPeriods[period] && "bg-primary text-primary-foreground")}>{period}</Button>
                              ))}
                            </div>
                          </div>
                          {conflicts.length > 0 && (
                            <div className="flex flex-col gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-500 bg-amber-100/50 dark:bg-amber-950/50 p-2 rounded border border-amber-200 dark:border-amber-900">
                              <span className="flex items-center gap-1 font-bold uppercase tracking-wider"><AlertCircle className="h-3 w-3" /> Attendee Conflicts</span>
                              {conflicts.map(c => (
                                <span key={c.id} className="flex items-center gap-1">
                                  {c.type === "leave" ? <Plane className="h-3 w-3" /> : <Briefcase className="h-3 w-3" />}
                                  {c.ownerName} ({c.type})
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="pt-6 border-t">
          <Button type="submit" size="lg" className="w-full sm:w-auto font-bold shadow-sm text-base" disabled={createMeeting.isPending}>
            {createMeeting.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create Meeting Poll
          </Button>
        </div>
      </form>
    </div>
  );
}

function EditMeetingDialog({ meeting, open, onOpenChange }: { meeting: Meeting; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: meetings = [] } = useMeetings();
  const { data: calendarEvents } = useManagerCalendarEvents();
  const updateMeeting = useUpdateMeeting();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [periods, setPeriods] = useState<Record<string, { AM: boolean; PM: boolean }>>({});
  const [confirmedDate, setConfirmedDate] = useState<Date | undefined>();
  const [confirmedPeriod, setConfirmedPeriod] = useState<"AM" | "PM">("AM");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(meeting.title); setLocation(meeting.location || "");
      if (meeting.status !== "confirmed") {
        const dates: Date[] = [];
        const per: Record<string, { AM: boolean; PM: boolean }> = {};
        meeting.proposedSlots.forEach(s => {
           const d = parseISO(s.date);
           if (!dates.some(existing => isSameDay(existing, d))) dates.push(d);
           const key = format(d, "yyyy-MM-dd");
           if (!per[key]) per[key] = { AM: false, PM: false };
           per[key][s.period] = true;
        });
        setSelectedDates(dates); setPeriods(per);
      } else {
        const slot = meeting.proposedSlots.find(s => s.id === meeting.confirmedSlotId);
        if (slot) { setConfirmedDate(parseISO(slot.date)); setConfirmedPeriod(slot.period); }
        else { setConfirmedDate(new Date()); setConfirmedPeriod("AM"); }
      }
    }
  }, [open, meeting]);

  const slots = useMemo(() => selectedDates.flatMap((date) => {
      const dateKey = format(date, "yyyy-MM-dd");
      const selectedPeriods = periods[dateKey] ?? { AM: true, PM: true };
      return (["AM", "PM"] as const).filter((period) => selectedPeriods[period]).map((period) => ({ date: dateKey, period }));
    }), [selectedDates, periods]);

  const handleDateSelect = (dates: Date[] | undefined) => {
    const nextDates = dates ?? [];
    setSelectedDates(nextDates);
    setPeriods((current) => Object.fromEntries(nextDates.map((date) => {
      const key = format(date, "yyyy-MM-dd");
      return [key, current[key] ?? { AM: true, PM: true }];
    })));
  };

  const togglePeriod = (dateKey: string, period: "AM" | "PM") => {
    setPeriods((current) => ({ ...current, [dateKey]: { ...(current[dateKey] ?? { AM: true, PM: true }), [period]: !(current[dateKey] ?? { AM: true, PM: true })[period] } }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (!title.trim()) { setError("Title is required"); return; }
    if (!location.trim()) { setError("Location is required"); return; }
    try {
      if (meeting.status !== "confirmed") {
        if (selectedDates.length < 2) { setError("Select at least two dates"); return; }
        if (slots.length < 1) { setError("Enable AM or PM"); return; }
        await updateMeeting.mutateAsync({ id: meeting.id, title: title.trim(), location: location.trim(), proposedSlots: slots });
      } else {
        if (!confirmedDate) { setError("Confirmed date is required"); return; }
        await updateMeeting.mutateAsync({ id: meeting.id, title: title.trim(), location: location.trim(), confirmedDate: format(confirmedDate, "yyyy-MM-dd"), confirmedPeriod });
      }
      toast({ title: "Meeting updated" }); onOpenChange(false);
    } catch (err: any) { setError(err.message || "Update failed"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto border-border shadow-lg">
        <DialogHeader><DialogTitle>Edit Meeting</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 mt-2">
          {error && <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm font-semibold flex items-center border border-destructive/20 shadow-sm"><AlertCircle className="h-4 w-4 mr-2 shrink-0" />{error}</div>}
          <div className="space-y-2"><Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Meeting Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} className="h-11 shadow-sm font-semibold" /></div>
          <div className="space-y-2"><Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Location</Label><LocationSelect value={location} onChange={setLocation} meetings={meetings} /></div>
          {meeting.status !== "confirmed" ? (
             <div className="space-y-4 pt-4 border-t">
                <div className="bg-muted p-3 text-sm rounded-md text-muted-foreground font-medium mb-2 border shadow-inner">Note: Changing proposed slots requires all attendees to vote again.</div>
                <div><Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Proposed Dates</Label></div>
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="rounded-xl border bg-card flex justify-center p-3 shadow-sm w-full md:w-auto"><Calendar mode="multiple" selected={selectedDates} onSelect={handleDateSelect} disabled={{ before: new Date() }} className="w-full max-w-full overflow-x-auto overflow-y-hidden [--cell-size:2rem] sm:[--cell-size:2.5rem]" /></div>
                  <div className="flex-1 w-full space-y-3 min-w-[200px]">
                    {selectedDates.length === 0 ? (
                      <div className="h-full min-h-[150px] flex items-center justify-center border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground text-sm font-bold bg-muted/10">Select dates</div>
                    ) : (
                      <div className="space-y-2 pr-2">
                        {selectedDates.slice().sort((a, b) => a.getTime() - b.getTime()).map((date) => {
                          const dateKey = format(date, "yyyy-MM-dd");
                          const selectedPeriods = periods[dateKey] ?? { AM: true, PM: true };
                          const allAttendees = [...meeting.requiredAttendeeIds, ...meeting.optionalAttendeeIds];
                          const conflicts = (calendarEvents || []).filter(ev => ev.startDate <= dateKey && ev.endDate >= dateKey && allAttendees.includes(ev.ownerId));

                          return (
                            <div key={dateKey} className={cn("flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm transition-colors", conflicts.length > 0 && "border-amber-400 bg-amber-50/10 dark:border-amber-900/50 dark:bg-amber-900/10")}>
                              <div className="flex sm:flex-row flex-col sm:items-center justify-between gap-3">
                                <span className="text-sm font-bold text-foreground">{format(date, "EEE, d MMM yyyy")}</span>
                                <div className="flex gap-2">
                                  {(["AM", "PM"] as const).map((period) => (
                                    <Button key={period} type="button" size="sm" variant={selectedPeriods[period] ? "default" : "outline"} onClick={() => togglePeriod(dateKey, period)} className={cn("h-8 flex-1 sm:flex-none font-bold shadow-sm", selectedPeriods[period] && "bg-primary text-primary-foreground")}>{period}</Button>
                                  ))}
                                </div>
                              </div>
                              {conflicts.length > 0 && (
                                <div className="flex flex-col gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-500 bg-amber-100/50 dark:bg-amber-950/50 p-2 rounded border border-amber-200 dark:border-amber-900">
                                  <span className="flex items-center gap-1 font-bold uppercase tracking-wider"><AlertCircle className="h-3 w-3" /> Attendee Conflicts</span>
                                  {conflicts.map(c => (
                                    <span key={c.id} className="flex items-center gap-1">
                                      {c.type === "leave" ? <Plane className="h-3 w-3" /> : <Briefcase className="h-3 w-3" />}
                                      {c.ownerName} ({c.type})
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
             </div>
          ) : (
             <div className="space-y-4 pt-4 border-t">
                <div className="bg-muted p-3 text-sm rounded-md text-muted-foreground font-medium mb-2 border shadow-inner">Note: Updating confirmed time and location will notify attendees.</div>
                <div><Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Confirmed Date</Label></div>
                <div className="flex flex-col md:flex-row gap-6 items-start">
                   <div className="rounded-xl border bg-card flex justify-center p-3 shadow-sm w-full md:w-auto"><Calendar mode="single" selected={confirmedDate} onSelect={setConfirmedDate} disabled={{ before: new Date() }} className="w-full overflow-x-auto overflow-y-hidden [--cell-size:2rem] sm:[--cell-size:2.5rem]" /></div>
                   <div className="flex-1 space-y-4 w-full">
                     <Label className="text-sm font-bold uppercase tracking-wider block mb-2 text-muted-foreground">Confirmed Time</Label>
                     <div className="flex gap-2">
                        <Button type="button" variant={confirmedPeriod === "AM" ? "default" : "outline"} onClick={() => setConfirmedPeriod("AM")} className={cn("flex-1 font-bold shadow-sm", confirmedPeriod === "AM" && "bg-primary text-primary-foreground")}>AM</Button>
                        <Button type="button" variant={confirmedPeriod === "PM" ? "default" : "outline"} onClick={() => setConfirmedPeriod("PM")} className={cn("flex-1 font-bold shadow-sm", confirmedPeriod === "PM" && "bg-primary text-primary-foreground")}>PM</Button>
                     </div>
                   </div>
                </div>
             </div>
          )}
          <DialogFooter className="pt-4">
             <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="font-bold shadow-sm">Cancel</Button>
             <Button type="submit" disabled={updateMeeting.isPending} className="font-bold shadow-sm">{updateMeeting.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MeetingCard({ meeting }: { meeting: Meeting }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const submitAvailability = useSubmitAvailability();
  const confirmMeeting = useConfirmMeeting();
  const deleteMeeting = useDeleteMeeting();
  const { data: calendarEvents = [] } = useManagerCalendarEvents();
  const [editOpen, setEditOpen] = useState(false);

  const isOrganizer = meeting.currentUserRole === "organizer" || meeting.currentUserRole === "both";
  const isAttendee = meeting.currentUserRole === "attendee" || meeting.currentUserRole === "both";
  const isAdmin = user?.role === "admin";
  const canDelete = isOrganizer || isAdmin;
  const needsMyResponse = Boolean(user && meeting.status === "collecting" && meeting.attendeeIds.includes(user.id) && !meeting.responses[user.id]);
  const organizerNeedsToConfirm = Boolean(isOrganizer && meeting.status === "ready");

  const myResponse = user ? meeting.responses[user.id] : null;
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set(myResponse?.slotIds || []));

  useEffect(() => { if (myResponse && !submitAvailability.isPending) setSelectedSlots(new Set(myResponse.slotIds)); }, [myResponse, submitAvailability.isPending]);

  const handleToggleSlot = (slotId: string) => {
    if (meeting.status === "confirmed") return;
    const newSet = new Set(selectedSlots);
    if (newSet.has(slotId)) newSet.delete(slotId); else newSet.add(slotId);
    setSelectedSlots(newSet);
  };

  const handleSaveAvailability = async () => {
    try { await submitAvailability.mutateAsync({ id: meeting.id, slotIds: Array.from(selectedSlots) }); toast({ title: "Availability saved" }); }
    catch (err: any) { toast({ title: "Failed to save", description: err.message, variant: "destructive" }); }
  };

  const handleConfirm = async (slotId: string) => {
    try { await confirmMeeting.mutateAsync({ id: meeting.id, slotId }); toast({ title: "Meeting confirmed" }); }
    catch (err: any) { toast({ title: "Failed to confirm", description: err.message, variant: "destructive" }); }
  };

  const handleDelete = async () => {
    if (!confirm("Delete meeting?")) return;
    try { await deleteMeeting.mutateAsync(meeting.id); toast({ title: "Meeting deleted" }); }
    catch (err: any) { toast({ title: "Delete failed", description: err.message, variant: "destructive" }); }
  };

  const formatSlotDate = (dateStr: string) => { try { return format(parseISO(dateStr), "EEE, d MMM yyyy"); } catch { return dateStr; } };

  const requiredCount = meeting.requiredAttendeeIds.length;
  const requiredResponded = meeting.requiredAttendeeIds.filter(id => meeting.responses[id]).length;
  const allRequiredResponded = requiredCount === 0 || requiredResponded >= requiredCount;
  const totalAttendees = meeting.attendeeIds.length;
  const [showDetails, setShowDetails] = useState(meeting.status !== "confirmed");

  return (
    <>
      <Card className={cn("overflow-hidden transition-all shadow-sm border",
        meeting.status === "confirmed" && "border-green-500/30 bg-green-50/30 dark:bg-green-950/10",
        organizerNeedsToConfirm && "border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/10",
        needsMyResponse && "border-red-500/50 bg-red-50/30 dark:bg-red-950/10"
      )}>
        <CardHeader className="pb-4 border-b bg-muted/10 relative">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-black text-primary">{meeting.title}</CardTitle>
              {meeting.location && (
                <div className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground mt-1.5"><MapPin className="h-4 w-4 shrink-0 text-primary/70" /><span>{meeting.location}</span></div>
              )}
              <CardDescription className="mt-2 font-medium">Organised by <span className="font-bold text-foreground">{meeting.organizerName}</span> · {format(new Date(meeting.createdAt), "d MMM yyyy")}</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={cn(
                  meeting.status === "confirmed" && "bg-green-600 border-green-600 text-white",
                  organizerNeedsToConfirm && "bg-amber-500 border-amber-500 text-white",
                  needsMyResponse && "bg-destructive border-destructive text-white",
                  !needsMyResponse && !organizerNeedsToConfirm && meeting.status !== "confirmed" && "bg-secondary text-secondary-foreground border-border",
                  "uppercase tracking-wider text-[10px] px-2 py-0.5 font-bold shadow-sm"
                )}>
                {meeting.status === "confirmed" ? "Confirmed" : organizerNeedsToConfirm ? "Ready to Confirm" : needsMyResponse ? "Your Response Needed" : "Collecting Votes"}
              </Badge>
              {isOrganizer && <Button aria-label="Edit Meeting" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground -mr-2 bg-background/50 border shadow-sm" onClick={() => setEditOpen(true)}><Edit2 className="h-4 w-4" /></Button>}
              {canDelete && <Button aria-label="Delete Meeting" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mr-2 bg-background/50 border shadow-sm" onClick={handleDelete}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-6">
          {meeting.status === "confirmed" && meeting.confirmedSlotId && (
            <div className="bg-primary text-primary-foreground p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between shadow-md gap-4">
              <div className="flex items-start sm:items-center gap-4">
                <div className="bg-background/20 p-3 rounded-lg"><CalendarIcon className="h-6 w-6" /></div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Confirmed</p>
                  <p className="text-lg font-black leading-none mb-1.5">{formatSlotDate(meeting.proposedSlots.find(s => s.id === meeting.confirmedSlotId)?.date || "")} · {meeting.proposedSlots.find(s => s.id === meeting.confirmedSlotId)?.period}</p>
                </div>
              </div>
            </div>
          )}
          <div className="space-y-3">
            <div className="flex justify-between items-end mb-1">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{meeting.status === "confirmed" ? "All Options" : "Proposed Times"}</h4>
              {meeting.status !== "confirmed" && isAttendee && <span className="text-[10px] text-primary font-black bg-primary/10 px-2.5 py-0.5 rounded-full uppercase tracking-wider">Select all you can attend</span>}
            </div>
            <div className="grid gap-2">
              {meeting.proposedSlots
                .filter((slot) => showDetails || meeting.status !== "confirmed" || meeting.confirmedSlotId === slot.id)
                .map((slot) => {
                const availableCount = Object.values(meeting.responses).filter(r => r.slotIds.includes(slot.id)).length;
                const requiredAvailableCount = meeting.requiredAttendeeIds.filter(id => meeting.responses[id]?.slotIds.includes(slot.id)).length;
                const isSelected = selectedSlots.has(slot.id);
                const isConfirmedSlot = meeting.confirmedSlotId === slot.id;
                const allRequiredAvailableForSlot = requiredCount === 0 || requiredAvailableCount === requiredCount;
                const calendarConflicts = isOrganizer
                  ? calendarEvents.filter(event =>
                      meeting.attendeeIds.includes(event.ownerId) &&
                      event.startDate <= slot.date &&
                      event.endDate >= slot.date
                    )
                  : [];

                return (
                  <div key={slot.id} className={cn("flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border transition-all", isSelected && meeting.status !== "confirmed" ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card", isConfirmedSlot && meeting.status === "confirmed" ? "border-green-600 ring-2 ring-green-600/20 bg-green-50/50 dark:bg-green-900/10 shadow-sm" : "", !isConfirmedSlot && meeting.status === "confirmed" ? "opacity-50 grayscale" : "")}>
                    <div className="flex items-center gap-3">
                      {meeting.status !== "confirmed" && isAttendee && <Checkbox checked={isSelected} onCheckedChange={() => handleToggleSlot(slot.id)} disabled={submitAvailability.isPending} className={cn(isSelected && "border-primary")} />}
                      <div className="flex flex-col">
                        <span className={cn("text-sm font-bold", isConfirmedSlot ? "text-green-700 dark:text-green-400" : "text-foreground")}>{formatSlotDate(slot.date)}</span>
                        <span className="text-xs text-muted-foreground font-black">{slot.period}</span>
                        {calendarConflicts.length > 0 && meeting.status !== "confirmed" && (
                          <span className="mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                            Out: {calendarConflicts.map(event => event.ownerName).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-3 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0">
                      {(meeting.status !== "confirmed" || showDetails) && (
                        <div className="flex flex-col items-end">
                          <span className="text-sm font-bold">{availableCount} / {totalAttendees} available</span>
                          {requiredCount > 0 && <span className={cn("text-[10px] font-black uppercase tracking-wider", allRequiredAvailableForSlot ? "text-green-600 dark:text-green-500" : "text-amber-600 dark:text-amber-500")}>{requiredAvailableCount} / {requiredCount} required</span>}
                        </div>
                      )}
                      {isOrganizer && meeting.status !== "confirmed" && (
                        <Button size="sm" variant={allRequiredAvailableForSlot ? "default" : "outline"} className={cn("h-8 ml-2 font-bold shadow-sm", allRequiredAvailableForSlot && "bg-green-600 hover:bg-green-700 text-white")} onClick={() => handleConfirm(slot.id)} disabled={confirmMeeting.isPending || !allRequiredResponded}>Confirm</Button>
                      )}
                      {meeting.status === "confirmed" && isConfirmedSlot && (
                        <Badge variant="outline" className="bg-green-600 text-white font-bold border-transparent">Final Date</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
              {meeting.status === "confirmed" && !meeting.confirmedSlotId && (
                <div className="p-4 rounded-lg border border-border bg-card text-center text-sm font-bold text-muted-foreground">
                  Confirmed date unknown
                </div>
              )}
            </div>
          </div>
          {showDetails && (
            <div className="space-y-3 pt-4 border-t">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Manager Responses</h4>
              <div className="flex flex-wrap gap-2">
                {meeting.attendeeIds.map(id => {
                  const response = meeting.responses[id];
                  const isRequired = meeting.requiredAttendeeIds.includes(id);
                  const acc = meeting.attendees?.find(a => a.id === id);
                  const name = acc ? (acc.displayName || acc.username) : "Unknown";
                  return (
                    <Badge key={id} variant={response ? "default" : "outline"} className={cn("text-[11px] px-2.5 py-0.5 font-bold shadow-sm", response && "bg-muted text-foreground hover:bg-muted", !response && isRequired && "border-amber-200 text-amber-700 dark:text-amber-400 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20", !response && !isRequired && "text-muted-foreground bg-background")}>
                      {name}{isRequired && !response && <ShieldAlert className="ml-1 h-3 w-3" />}
                    </Badge>
                  );
                })}
              </div>
              {!allRequiredResponded && meeting.status !== "confirmed" && (
                <p className="text-[11px] font-black text-amber-600 dark:text-amber-500 flex items-center mt-2 bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-200 dark:border-amber-900">
                  <AlertCircle className="h-3 w-3 mr-1" />Waiting for {requiredCount - requiredResponded} required managers to respond.
                </p>
              )}
            </div>
          )}
          {meeting.status === "confirmed" && (
             <div className="pt-4 flex justify-center">
                <Button variant="ghost" size="sm" className="text-xs font-bold text-muted-foreground" onClick={() => setShowDetails(!showDetails)}>
                   {showDetails ? "Hide Details" : "Show Details"}
                </Button>
             </div>
          )}
        </CardContent>
        {meeting.status !== "confirmed" && isAttendee && (
          <CardFooter className="bg-muted/10 border-t p-4 flex sm:flex-row flex-col gap-4 justify-between items-center">
            <div className="text-sm text-foreground font-bold">{selectedSlots.size === 0 ? "No times selected" : `${selectedSlots.size} times selected`}</div>
            <Button onClick={handleSaveAvailability} disabled={submitAvailability.isPending} className="font-bold shadow-sm w-full sm:w-auto">
              {submitAvailability.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{myResponse ? "Update Availability" : "Submit Availability"}
            </Button>
          </CardFooter>
        )}
      </Card>
      {editOpen && <EditMeetingDialog meeting={meeting} open={editOpen} onOpenChange={setEditOpen} />}
    </>
  );
}

export default function Meetings() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"pending-mine" | "pending-others" | "confirmed" | "new" | "groups">(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return requested === "pending-others" || requested === "confirmed" || requested === "new" || requested === "groups"
      ? requested
      : "pending-mine";
  });

  const { data: meetings, isLoading, error } = useMeetings();

  if (!user || (user.role !== "manager" && user.role !== "admin")) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in">
        <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-bold">Access Denied</h2>
        <p className="text-muted-foreground font-medium">Only managers can access meetings.</p>
      </div>
    );
  }

  if (isLoading) return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (error) return <div className="flex h-[50vh] flex-col items-center justify-center text-destructive"><AlertCircle className="h-12 w-12 mb-4" /><p className="font-bold">Failed to load meetings</p></div>;

  // Pending your confirmation = attendee needs to vote, OR organizer needs to confirm final date
  const pendingMine = meetings?.filter(m => m.status !== "confirmed" && ((m.attendeeIds.includes(user.id) && !m.responses[user.id]) || (m.organizerId === user.id && m.status === "ready"))) || [];

  // Pending other's confirmation = active meeting that doesn't need my immediate action
  const pendingOthers = meetings?.filter(m => m.status !== "confirmed" && !pendingMine.includes(m)) || [];

  const confirmed = meetings?.filter(m => m.status === "confirmed") || [];

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain bg-background">
      <div className="max-w-5xl mx-auto space-y-8 px-4 py-6 md:px-6 md:py-8 pb-24 animate-in fade-in duration-300">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Meetings</h1>
          <p className="text-muted-foreground font-medium mt-1 text-sm md:text-base">Coordinate availability and confirm meeting slots.</p>
        </div>

        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
          <div className="md:hidden mb-6">
            <Select value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
              <SelectTrigger className="w-full font-bold h-12 shadow-sm bg-muted/30">
                <SelectValue placeholder="Select section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending-mine">Pending your confirmation ({pendingMine.length})</SelectItem>
                <SelectItem value="pending-others">Pending other's confirmation ({pendingOthers.length})</SelectItem>
                <SelectItem value="confirmed">Confirmed meeting ({confirmed.length})</SelectItem>
                <SelectItem value="new">Create New</SelectItem>
                <SelectItem value="groups">My Groups</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="hidden md:block mb-6">
            <TabsList className="flex flex-wrap h-auto w-full gap-2 p-1 bg-transparent justify-start">
              <TabsTrigger value="pending-mine" className="font-bold text-sm rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md border bg-muted/30 px-4 py-2 h-auto">
                Pending your confirmation <Badge variant="secondary" className="ml-2 bg-background/50 h-5 px-1.5 text-[10px] text-foreground">{pendingMine.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending-others" className="font-bold text-sm rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md border bg-muted/30 px-4 py-2 h-auto">
                Pending other's confirmation <Badge variant="secondary" className="ml-2 bg-background/50 h-5 px-1.5 text-[10px] text-foreground">{pendingOthers.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="confirmed" className="font-bold text-sm rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md border bg-muted/30 px-4 py-2 h-auto">
                Confirmed meeting <Badge variant="secondary" className="ml-2 bg-background/50 h-5 px-1.5 text-[10px] text-foreground">{confirmed.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="new" className="font-bold text-sm rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md border bg-muted/30 px-4 py-2 h-auto">
                Create New
              </TabsTrigger>
              <TabsTrigger value="groups" className="font-bold text-sm rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md border bg-muted/30 px-4 py-2 h-auto">
                My Groups
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="pending-mine" className="space-y-4 animate-in fade-in">
            {pendingMine.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 border-2 rounded-xl border-dashed bg-card/50">
                <Check className="h-12 w-12 text-muted-foreground/30" />
                <div><h3 className="text-lg font-bold">You're all caught up</h3><p className="text-sm text-muted-foreground font-medium mt-1">No action required on any polls.</p></div>
              </div>
            ) : <div className="grid gap-6">{pendingMine.map(m => <MeetingCard key={m.id} meeting={m} />)}</div>}
          </TabsContent>

          <TabsContent value="pending-others" className="space-y-4 animate-in fade-in">
            {pendingOthers.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 border-2 rounded-xl border-dashed bg-card/50">
                <Clock className="h-12 w-12 text-muted-foreground/30" />
                <div><h3 className="text-lg font-bold">No active polls</h3><p className="text-sm text-muted-foreground font-medium mt-1">You have no polls waiting on others.</p></div>
              </div>
            ) : <div className="grid gap-6">{pendingOthers.map(m => <MeetingCard key={m.id} meeting={m} />)}</div>}
          </TabsContent>

          <TabsContent value="confirmed" className="space-y-4 animate-in fade-in">
            {confirmed.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 border-2 rounded-xl border-dashed bg-card/50">
                <CalendarIcon className="h-12 w-12 text-muted-foreground/30" />
                <div><h3 className="text-lg font-bold">No confirmed meetings</h3><p className="text-sm text-muted-foreground font-medium mt-1">Confirmed meetings will appear here.</p></div>
              </div>
            ) : <div className="grid gap-6">{confirmed.map(m => <MeetingCard key={m.id} meeting={m} />)}</div>}
          </TabsContent>

          <TabsContent value="new" className="mt-0"><NewMeetingTab onSuccess={() => setActiveTab("pending-others")} /></TabsContent>
          <TabsContent value="groups" className="mt-0"><MyGroupsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
