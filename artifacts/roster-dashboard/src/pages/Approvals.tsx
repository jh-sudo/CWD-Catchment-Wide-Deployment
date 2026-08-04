import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCcw, CheckCircle, XCircle, Shield, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";

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
  coverRespondedAt?: string;
  coverDeclineReason?: string;
  icStatus?: "PENDING" | "APPROVED" | "REJECTED";
  icNote?: string;
  icName?: string;
  icReviewedAt?: string;
  status: string;
  createdAt: string;
  lastEditedBy?: string;
  lastEditedOn?: string;
}

interface DutyOverrideRecord {
  officerId: string;
  officerName: string;
  unitCode: string;
  catchment: string;
  date: string;
  duty: string;
  targetDuty?: string;
  coveredByOfficerName?: string;
  swappedWithOfficerName?: string;
  crossPostedToUnit?: string;
  vehicle?: string;
  madeBy?: string;
  madeByName?: string;
  madeAt?: string;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING_COVER: { label: "Awaiting Cover",  variant: "secondary" },
  PENDING_IC:    { label: "Awaiting IC",     variant: "default" },
  APPROVED:      { label: "Approved",        variant: "default" },
  REJECTED:      { label: "Rejected",        variant: "destructive" },
  CANCELLED:     { label: "Cancelled",       variant: "outline" },
};

// ── Pending-action card (Cover / IC tabs) ─────────────────────────────────────
function RequestCard({
  req,
  showCoverActions,
  showIcActions,
  onCoverRespond,
  onIcReview,
}: {
  req: LeaveRequest;
  showCoverActions: boolean;
  showIcActions: boolean;
  onCoverRespond?: (req: LeaveRequest, accepted: boolean) => void;
  onIcReview?: (req: LeaveRequest) => void;
}) {
  const st = STATUS_BADGE[req.status] ?? { label: req.status, variant: "outline" as const };
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-sm">
              {req.officerName} — {format(new Date(req.date + "T00:00:00Z"), "EEE d MMM yyyy")}
            </div>
            <div className="text-xs text-muted-foreground">{req.officerCatchment}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
            <span className="text-xs text-muted-foreground font-medium">{req.leaveType}</span>
          </div>
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
        {req.icName && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-28 shrink-0">IC:</span>
            <span>{req.icStatus === "APPROVED" ? "✓ Approved" : "✗ Rejected"} by {req.icName}
              {req.icNote && <span className="text-muted-foreground"> — {req.icNote}</span>}
            </span>
          </div>
        )}
        {req.reason && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-28 shrink-0">Reason:</span>
            <span>{req.reason}</span>
          </div>
        )}

        {showCoverActions && req.status === "PENDING_COVER" && req.coverStatus === "PENDING" && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8"
              onClick={() => onCoverRespond?.(req, true)}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              Accept Cover
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-destructive text-destructive hover:bg-destructive/10 h-8"
              onClick={() => onCoverRespond?.(req, false)}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Decline
            </Button>
          </div>
        )}

        {showIcActions && req.status === "PENDING_IC" && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8"
              onClick={() => onIcReview?.(req)}
            >
              <Shield className="h-3.5 w-3.5 mr-1.5" />
              Review
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── History entry card (Leave / Swap format) ───────────────────────────────────
function HistoryEntryCard({ req }: { req: LeaveRequest }) {
  const isSwap = !!req.coverOfficerName;
  const dateLabel = (() => {
    try { return format(new Date(req.date + "T00:00:00Z"), "EEE, d MMM yyyy"); }
    catch { return req.date; }
  })();
  const editedLabel = (() => {
    if (!req.lastEditedBy && !req.lastEditedOn) return null;
    const who = req.lastEditedBy ?? "—";
    const when = req.lastEditedOn
      ? (() => { try { return format(parseISO(req.lastEditedOn), "d MMM yy, HH:mm"); } catch { return req.lastEditedOn; } })()
      : null;
    return `${who}${when ? ` at ${when}` : ""}`;
  })();

  return (
    <Card>
      <CardContent className="pt-3 pb-3 px-4 space-y-0.5">
        {/* Type badge + officer + leave */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
            isSwap
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
          }`}>
            {isSwap ? "Swap" : "Leave"}
          </span>
          <span className="text-sm font-semibold">{req.officerName}</span>
          <span className="text-sm text-muted-foreground font-medium">{req.leaveType}</span>
        </div>
        {/* Date */}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Date:</span> {dateLabel}
        </div>
        {/* Swapping with */}
        {isSwap && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Swapping with:</span> {req.coverOfficerName}
          </div>
        )}
        {/* Last edited */}
        {editedLabel && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Last edited:</span> {editedLabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Master override card (Master Leave / Master Swap format) ───────────────────
function MasterOverrideList({ overrides }: { overrides: DutyOverrideRecord[] }) {
  const sorted = [...overrides].sort((a, b) => {
    // Sort by date desc, then by madeAt desc
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return (b.madeAt ?? "").localeCompare(a.madeAt ?? "");
  });

  return (
    <div className="space-y-2">
      {sorted.map((ov, i) => {
        const isSwap = !!ov.swappedWithOfficerName;
        const dateLabel = (() => {
          try { return format(new Date(ov.date + "T00:00:00Z"), "EEE, d MMM yyyy"); }
          catch { return ov.date; }
        })();
        const shiftLabel = isSwap && ov.targetDuty
          ? `${ov.targetDuty} ⇄ ${ov.duty}`
          : ov.duty;
        const editedLabel = (() => {
          const who = ov.madeByName ?? ov.madeBy ?? null;
          const when = ov.madeAt
            ? (() => { try { return format(parseISO(ov.madeAt), "d MMM yy, HH:mm"); } catch { return ov.madeAt; } })()
            : null;
          if (!who && !when) return null;
          return `${who ?? "—"}${when ? ` at ${when}` : ""}`;
        })();

        return (
          <Card key={i}>
            <CardContent className="pt-3 pb-3 px-4 space-y-0.5">
              {/* Type badge + officer + shift */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                  isSwap
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                }`}>
                  Master
                </span>
                <span className="text-sm font-semibold">{ov.officerName}</span>
                <span className="text-sm text-muted-foreground font-medium">{shiftLabel}</span>
              </div>
              {/* Date */}
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Date:</span> {dateLabel}
              </div>
              {/* Swapping with */}
              {isSwap && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Swapping with:</span> {ov.swappedWithOfficerName}
                </div>
              )}
              {/* Last edited */}
              {editedLabel && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Last edited:</span> {editedLabel}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Approvals() {
  const { user } = useAuth();
  const [allRequests, setAllRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [declineTarget, setDeclineTarget] = useState<{ req: LeaveRequest } | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [icReviewTarget, setIcReviewTarget] = useState<LeaveRequest | null>(null);
  const [icNote, setIcNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [overrides, setOverrides] = useState<DutyOverrideRecord[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const isManager = user?.role === "admin" || user?.role === "manager" || user?.role === "ic";

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leave-requests", { credentials: "include" });
      if (res.ok) setAllRequests(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOverrides = useCallback(async () => {
    if (!isManager) return;
    setOverridesLoading(true);
    try {
      const res = await fetch("/api/roster-plan/overrides", { credentials: "include" });
      if (res.ok) setOverrides(await res.json());
    } finally {
      setOverridesLoading(false);
    }
  }, [isManager]);

  useEffect(() => { fetchAll(); fetchOverrides(); }, [fetchAll, fetchOverrides]);

  const isCoverOfficer = (req: LeaveRequest) =>
    user?.officerId && user.officerId === req.coverOfficerId;

  const isInMyICCatchment = (req: LeaveRequest) =>
    (user?.role === "admin" || user?.role === "manager") ||
    (user?.role === "ic" && (user.catchments ?? []).includes(req.officerCatchment));

  const pendingCover = allRequests.filter(r => r.status === "PENDING_COVER" && isCoverOfficer(r));
  const pendingIC = allRequests.filter(r => r.status === "PENDING_IC" && isInMyICCatchment(r));
  const historical = allRequests.filter(r => r.status === "APPROVED" || r.status === "REJECTED" || r.status === "CANCELLED");

  const handleCoverRespond = async (req: LeaveRequest, accepted: boolean) => {
    if (!accepted) { setDeclineTarget({ req }); return; }
    setActionLoading(true);
    await fetch(`/api/leave-requests/${req.id}/cover-respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ accepted: true }),
    });
    setActionLoading(false);
    fetchAll();
  };

  const handleDeclineSubmit = async () => {
    if (!declineTarget) return;
    setActionLoading(true);
    await fetch(`/api/leave-requests/${declineTarget.req.id}/cover-respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ accepted: false, declineReason }),
    });
    setDeclineTarget(null);
    setDeclineReason("");
    setActionLoading(false);
    fetchAll();
  };

  const handleICReview = async (approved: boolean) => {
    if (!icReviewTarget) return;
    setActionLoading(true);
    await fetch(`/api/leave-requests/${icReviewTarget.id}/ic-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ approved, note: icNote }),
    });
    setIcReviewTarget(null);
    setIcNote("");
    setActionLoading(false);
    fetchAll();
  };

  const handleClearHistory = async (mode: "log" | "all") => {
    setClearing(true);
    try {
      await fetch(`/api/roster-plan/history/clear?mode=${mode}`, {
        method: "DELETE",
        credentials: "include",
      });
      setClearConfirmOpen(false);
      fetchAll();
      fetchOverrides();
    } finally {
      setClearing(false);
    }
  };

  const totalPending = pendingCover.length + pendingIC.length;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">
              Approvals
              {totalPending > 0 && (
                <span className="ml-2 text-sm font-normal bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {totalPending} pending
                </span>
              )}
            </h2>
            <p className="text-sm text-muted-foreground">
              {user?.role === "ic" ? `IC for: ${(user.catchments ?? []).join(", ")}` :
               user?.role === "admin" || user?.role === "manager" ? "All requests" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isManager && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1 border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear History
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={fetchAll}>
              <RefreshCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="cover">
            <TabsList className="w-full">
              <TabsTrigger value="cover" className="flex-1">
                Cover
                {pendingCover.length > 0 && (
                  <span className="ml-1.5 bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0">
                    {pendingCover.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="ic" className="flex-1">
                IC
                {pendingIC.length > 0 && (
                  <span className="ml-1.5 bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0">
                    {pendingIC.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
              {isManager && (
                <TabsTrigger value="overrides" className="flex-1">
                  Master
                  {overrides.length > 0 && (
                    <span className="ml-1.5 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0">
                      {overrides.length}
                    </span>
                  )}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="cover" className="space-y-3 mt-3">
              {pendingCover.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No cover requests pending for you
                  </CardContent>
                </Card>
              ) : pendingCover.map(req => (
                <RequestCard
                  key={req.id}
                  req={req}
                  showCoverActions={true}
                  showIcActions={false}
                  onCoverRespond={handleCoverRespond}
                />
              ))}
            </TabsContent>

            <TabsContent value="ic" className="space-y-3 mt-3">
              {pendingIC.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No requests pending IC approval
                  </CardContent>
                </Card>
              ) : pendingIC.map(req => (
                <RequestCard
                  key={req.id}
                  req={req}
                  showCoverActions={false}
                  showIcActions={true}
                  onIcReview={r => { setIcReviewTarget(r); setIcNote(""); }}
                />
              ))}
            </TabsContent>

            <TabsContent value="history" className="space-y-2 mt-3">
              {historical.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No completed requests
                  </CardContent>
                </Card>
              ) : historical.map(req => (
                <HistoryEntryCard key={req.id} req={req} />
              ))}
            </TabsContent>

            {isManager && (
              <TabsContent value="overrides" className="space-y-3 mt-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {overrides.length} master override{overrides.length !== 1 ? "s" : ""}
                  </p>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={fetchOverrides}>
                    <RefreshCcw className="h-3 w-3" /> Refresh
                  </Button>
                </div>
                {overridesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : overrides.length === 0 ? (
                  <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                      No master overrides recorded
                    </CardContent>
                  </Card>
                ) : (
                  <MasterOverrideList overrides={overrides} />
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>

      {/* Decline Dialog */}
      <Dialog open={!!declineTarget} onOpenChange={() => setDeclineTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Decline Cover Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You're declining to cover {declineTarget?.req.officerName} on{" "}
              {declineTarget && format(new Date(declineTarget.req.date + "T00:00:00Z"), "d MMM yyyy")}.
              Please provide a reason.
            </p>
            <div className="space-y-1.5">
              <Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                value={declineReason}
                onChange={e => setDeclineReason(e.target.value)}
                placeholder="e.g. On medical leave that day"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeclineSubmit} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IC Review Dialog */}
      <Dialog open={!!icReviewTarget} onOpenChange={() => setIcReviewTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Review Leave Request</DialogTitle>
          </DialogHeader>
          {icReviewTarget && (
            <div className="space-y-3">
              <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                <div><span className="font-medium">Officer:</span> {icReviewTarget.officerName}</div>
                <div><span className="font-medium">Date:</span> {format(new Date(icReviewTarget.date + "T00:00:00Z"), "EEE d MMM yyyy")}</div>
                <div><span className="font-medium">Leave type:</span> {icReviewTarget.leaveType}</div>
                {icReviewTarget.coverOfficerName && (
                  <div><span className="font-medium">Cover:</span> {icReviewTarget.coverOfficerName} ({icReviewTarget.coverStatus})</div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea
                  value={icNote}
                  onChange={e => setIcNote(e.target.value)}
                  placeholder="Add a note…"
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setIcReviewTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => handleICReview(false)}
              disabled={actionLoading}
              className="flex-1"
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={() => handleICReview(true)}
              disabled={actionLoading}
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear History Confirm Dialog */}
      <Dialog open={clearConfirmOpen} onOpenChange={v => { if (!clearing) setClearConfirmOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear History</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>All current data will be saved to the server before any changes are made.</p>
            <p className="font-medium text-destructive">These actions cannot be undone.</p>
          </div>
          <div className="space-y-2 pt-1">
            <Button
              className="w-full justify-start gap-2 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => handleClearHistory("log")}
              disabled={clearing}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Trash2 className="h-4 w-4 shrink-0" />}
              <span className="text-left leading-tight">Save all history and delete log</span>
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-start gap-2"
              onClick={() => handleClearHistory("all")}
              disabled={clearing}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Trash2 className="h-4 w-4 shrink-0" />}
              <span className="text-left leading-tight">Delete all history and revert to original</span>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" className="w-full" onClick={() => setClearConfirmOpen(false)} disabled={clearing}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
