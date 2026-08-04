import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, PlusCircle, X, RefreshCcw } from "lucide-react";
import { format, addDays } from "date-fns";

const LEAVE_TYPES = ["VL","VL(AM)","VL(PM)","MC","OVL","OIL","OIL(AM)","OIL(PM)","TO","TO(AM)","TO(PM)","CCL","PL","SPL","FCL","BL","SL","SL(WO/MC)","CSL","MA","NS","NS(ICT)","C","EL","CPL","UNPAID L"];
const COVERABLE_DUTIES = new Set(["ND", "OFF", "REST"]);

interface LeaveRequest {
  id: string;
  officerId: string;
  officerName: string;
  officerCatchment: string;
  date: string;
  leaveType: string;
  reason?: string;
  coverOfficerId?: string;
  coverOfficerName?: string;
  coverStatus?: "PENDING" | "ACCEPTED" | "DECLINED";
  coverDeclineReason?: string;
  icStatus?: "PENDING" | "APPROVED" | "REJECTED";
  icNote?: string;
  icName?: string;
  status: string;
  createdAt: string;
}

interface Officer {
  id: string;
  name: string;
  unitCode: string;
  catchment: string;
}

interface ScheduleDuty {
  officerId: string;
  date: string;
  duty: string;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING_COVER:  { label: "Awaiting Cover",   variant: "secondary" },
  PENDING_IC:     { label: "Awaiting IC",       variant: "default" },
  APPROVED:       { label: "Approved",          variant: "default" },
  REJECTED:       { label: "Rejected",          variant: "destructive" },
  CANCELLED:      { label: "Cancelled",         variant: "outline" },
};

export default function MyLeave() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [changeCoverRequest, setChangeCoverRequest] = useState<LeaveRequest | null>(null);
  const [newCoverOfficerId, setNewCoverOfficerId] = useState("");

  // New request form state
  const [newDate, setNewDate] = useState(format(addDays(new Date(), 1), "yyyy-MM-dd"));
  const [newLeaveType, setNewLeaveType] = useState("");
  const [newCoverId, setNewCoverId] = useState("");
  const [availableCovers, setAvailableCovers] = useState<Officer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leave-requests", { credentials: "include" });
      if (res.ok) setRequests(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOfficers = useCallback(async () => {
    const res = await fetch("/api/roster-plan/officers");
    if (res.ok) setOfficers(await res.json());
  }, []);

  useEffect(() => {
    fetchRequests();
    fetchOfficers();
  }, [fetchRequests, fetchOfficers]);

  // Fetch available covers when date changes
  useEffect(() => {
    if (!newDate) return;
    fetch(`/api/roster-plan/schedule?date=${newDate}`)
      .then(r => r.json())
      .then((sched: { duties: ScheduleDuty[]; officers: Officer[] }) => {
        const coverable = (sched.officers ?? []).filter(o => {
          if (o.id === user?.officerId) return false;
          const duty = sched.duties.find(d => d.officerId === o.id && d.date.startsWith(newDate));
          return duty ? COVERABLE_DUTIES.has(duty.duty) : false;
        });
        setAvailableCovers(coverable);
        setNewCoverId("");
      })
      .catch(() => setAvailableCovers([]));
  }, [newDate, user?.officerId]);

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!newLeaveType) { setFormError("Select a leave type"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          date: newDate,
          leaveType: newLeaveType,
          coverOfficerId: newCoverId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      setShowNew(false);
      setNewLeaveType("");
      setNewCoverId("");
      fetchRequests();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this leave request?")) return;
    await fetch(`/api/leave-requests/${id}`, { method: "DELETE", credentials: "include" });
    fetchRequests();
  };

  const handleChangeCover = async () => {
    if (!changeCoverRequest || !newCoverOfficerId) return;
    await fetch(`/api/leave-requests/${changeCoverRequest.id}/cover-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ coverOfficerId: newCoverOfficerId }),
    });
    setChangeCoverRequest(null);
    setNewCoverOfficerId("");
    fetchRequests();
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">My Leave Requests</h2>
            {user?.officerName && (
              <p className="text-sm text-muted-foreground">{user.officerName}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchRequests}>
              <RefreshCcw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => setShowNew(true)}>
              <PlusCircle className="h-4 w-4 mr-2" />
              New Request
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No leave requests yet. Click "New Request" to submit one.
            </CardContent>
          </Card>
        ) : (
          requests.map(req => {
            const st = STATUS_BADGE[req.status] ?? { label: req.status, variant: "outline" as const };
            return (
              <Card key={req.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">
                        {format(new Date(req.date + "T00:00:00Z"), "EEE, d MMM yyyy")} — {req.leaveType}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Submitted {format(new Date(req.createdAt), "d MMM yyyy")}
                      </div>
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {req.coverOfficerName && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-28 shrink-0">Cover officer:</span>
                      <span className="font-medium">{req.coverOfficerName}</span>
                      <Badge variant="outline" className="text-xs">
                        {req.coverStatus === "ACCEPTED" ? "✓ Accepted" :
                         req.coverStatus === "DECLINED" ? "✗ Declined" : "Pending"}
                      </Badge>
                    </div>
                  )}
                  {req.coverStatus === "DECLINED" && (
                    <div className="bg-orange-50 border border-orange-200 rounded-md p-2 text-xs text-orange-800">
                      {req.coverDeclineReason
                        ? `Declined: ${req.coverDeclineReason}`
                        : "Cover officer declined. Please choose another."}
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs w-full"
                        onClick={() => setChangeCoverRequest(req)}
                      >
                        Change Cover Officer
                      </Button>
                    </div>
                  )}
                  {req.icName && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-28 shrink-0">IC decision:</span>
                      <span>
                        {req.icStatus === "APPROVED" ? "✓ Approved" : "✗ Rejected"} by {req.icName}
                        {req.icNote && <span className="text-muted-foreground"> — {req.icNote}</span>}
                      </span>
                    </div>
                  )}
                  {(req.status === "PENDING_COVER" || req.status === "PENDING_IC") && (
                    <div className="pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive h-7 px-2"
                        onClick={() => handleCancel(req.id)}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Cancel request
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* New Request Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Leave Request</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitNew} className="space-y-4">
            {formError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {formError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Date</Label>
              <input
                type="date"
                value={newDate}
                min={format(new Date(), "yyyy-MM-dd")}
                onChange={e => setNewDate(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Leave Type</Label>
              <Select value={newLeaveType} onValueChange={setNewLeaveType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cover Officer <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select value={newCoverId} onValueChange={setNewCoverId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select cover officer…" />
                </SelectTrigger>
                <SelectContent>
                  {availableCovers.length === 0
                    ? <div className="px-3 py-2 text-xs text-muted-foreground">No officers available to cover on this date</div>
                    : availableCovers.map(o => (
                        <SelectItem key={o.id} value={o.id}>{o.name} — {o.unitCode}</SelectItem>
                      ))
                  }
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Only officers on ND/OFF/REST are shown</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Submit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change Cover Dialog */}
      <Dialog open={!!changeCoverRequest} onOpenChange={() => setChangeCoverRequest(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Cover Officer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={newCoverOfficerId} onValueChange={setNewCoverOfficerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select new cover officer…" />
              </SelectTrigger>
              <SelectContent>
                {officers
                  .filter(o => o.id !== user?.officerId && o.id !== changeCoverRequest?.coverOfficerId)
                  .sort((a,b) => a.name.localeCompare(b.name))
                  .map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.name} — {o.unitCode}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeCoverRequest(null)}>Cancel</Button>
            <Button onClick={handleChangeCover} disabled={!newCoverOfficerId}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
