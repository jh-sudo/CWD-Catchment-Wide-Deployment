import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, RefreshCcw, CheckCircle, XCircle, Search, Trash2, LayoutGrid, Shield } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useGetRosterSwaps, useReviewRosterSwap, type RosterSwap } from "@workspace/api-client-react";
import { useRosterVersion } from "@/context/RosterVersionContext";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  APPROVED:  { label: "Approved",  variant: "default" },
  REJECTED:  { label: "Rejected",  variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
  PENDING:   { label: "Pending",   variant: "secondary" },
  ACCEPTED:  { label: "Accepted",  variant: "default" },
  DECLINED:  { label: "Declined",  variant: "destructive" },
};

function dateLabel(dateStr: string) {
  try { return format(parseISO(dateStr + "T00:00:00Z"), "EEE, d MMM yyyy"); }
  catch { return dateStr; }
}

function fmtEditedAt(ts: string) {
  try { return format(parseISO(ts), "d MMM yyyy, HH:mm"); }
  catch { return ts; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Card components defined OUTSIDE parent to prevent remount on every render
// ─────────────────────────────────────────────────────────────────────────────

const LeaveCard = memo(function LeaveCard({
  leaf,
  onDelete,
  canReviewIc,
  onCoverAccept,
  onCoverDecline,
  onIcReview,
}: {
  leaf: any;
  onDelete: (l: any) => void;
  canReviewIc: boolean;
  onCoverAccept: (l: any) => void;
  onCoverDecline: (l: any) => void;
  onIcReview: (l: any) => void;
}) {
  const st = STATUS_BADGE[leaf.status] ?? { label: leaf.status, variant: "outline" as const };
  const canDelete = leaf.status === "APPROVED" || leaf.status === "CANCELLED";
  const needsCoverResponse = leaf.status === "PENDING_COVER" && leaf.coverStatus === "PENDING";
  const needsIcReview = leaf.status === "PENDING_IC" && canReviewIc;
  const editedAt = leaf.lastEditedOn ?? leaf.updatedAt ?? leaf.createdAt ?? "";
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded uppercase shrink-0">Leave</span>
              <span className="text-sm font-semibold truncate">{leaf.officerName}</span>
              <span className="text-xs text-muted-foreground shrink-0">{leaf.leaveType}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
            {canDelete && (
              <button type="button" onClick={() => onDelete(leaf)}
                className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded" title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">Date:</span>
          <span>{dateLabel(leaf.date)}</span>
        </div>
        {leaf.icName && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Applied by:</span>
            <span>{leaf.icName}</span>
            <span className="text-[10px] font-semibold uppercase px-1.5 py-0 rounded bg-purple-100 text-purple-700">IC/Mgr</span>
          </div>
        )}
        {leaf.coverOfficerName && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Cover:</span>
            <span>{leaf.coverOfficerName}</span>
            <span className="text-[10px]">
              {leaf.coverStatus === "ACCEPTED" ? "✓ Arranged" : leaf.coverStatus === "DECLINED" ? "✗ Declined" : ""}
            </span>
          </div>
        )}
        {leaf.officerCatchment && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Catchment:</span>
            <span>{leaf.officerCatchment}</span>
          </div>
        )}
        {(leaf.lastEditedBy || editedAt) && (
          <div className="pt-0.5 border-t border-dashed border-muted mt-1">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">Last edited:</span>
              <span>{[leaf.lastEditedBy, editedAt ? fmtEditedAt(editedAt) : ""].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
        )}
        {needsCoverResponse && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8"
              onClick={() => onCoverAccept(leaf)}>
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />Accept Cover
            </Button>
            <Button size="sm" variant="outline"
              className="flex-1 border-destructive text-destructive hover:bg-destructive/10 h-8"
              onClick={() => onCoverDecline(leaf)}>
              <XCircle className="h-3.5 w-3.5 mr-1.5" />Decline
            </Button>
          </div>
        )}
        {needsIcReview && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8"
              onClick={() => onIcReview(leaf)}>
              <Shield className="h-3.5 w-3.5 mr-1.5" />Review
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

const SwapCard = memo(function SwapCard({
  swap,
  onReview,
  onDelete,
  reviewPending,
}: { swap: RosterSwap; onReview: (s: RosterSwap, approve: boolean) => void; onDelete: (s: RosterSwap) => void; reviewPending: boolean }) {
  const st = STATUS_BADGE[swap.status] ?? { label: swap.status, variant: "outline" as const };
  const isPending = swap.status === "PENDING";
  const isPHSwap = !!(swap.phName || swap.type === "PH");
  const editedAt = (swap.reviewedAt && swap.createdAt)
    ? (swap.reviewedAt > swap.createdAt ? swap.reviewedAt : swap.createdAt)
    : swap.reviewedAt ?? swap.createdAt ?? "";

  const leaveTypeLabel = isPHSwap ? "PH Swap" : "Swap";
  const badgeClass = isPHSwap
    ? "text-[10px] font-bold bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded uppercase shrink-0"
    : "text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded uppercase shrink-0";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={badgeClass}>{leaveTypeLabel}</span>
              <span className="text-sm font-semibold">{swap.requesterName ?? "—"}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
            <button type="button" onClick={() => onDelete(swap)}
              className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded" title="Delete swap">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">Leave Type:</span>
          <span>{leaveTypeLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">Date:</span>
          <span>{swap.date ? dateLabel(swap.date) : "—"}</span>
          {swap.requesterDuty && (
            <span className="text-muted-foreground">· {swap.requesterDuty} ⇄ {swap.targetDuty ?? "—"}</span>
          )}
        </div>
        {swap.targetName && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Swapping with:</span>
            <span>{swap.targetName}</span>
          </div>
        )}
        {swap.phName && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">PH:</span>
            <span className="text-teal-700 font-medium">{swap.phName}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">Applied by:</span>
          <span>{swap.requesterName ?? "—"}</span>
        </div>
        {swap.reason && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Reason:</span>
            <span>{swap.reason}</span>
          </div>
        )}
        {(swap.reviewerName || editedAt) && (
          <div className="pt-0.5 border-t border-dashed border-muted mt-1">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">Last edited:</span>
              <span>{[swap.reviewerName, editedAt ? fmtEditedAt(editedAt) : ""].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
        )}
        {isPending && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8"
              onClick={() => onReview(swap, true)} disabled={reviewPending}>
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />Approve
            </Button>
            <Button size="sm" variant="outline"
              className="flex-1 border-destructive text-destructive hover:bg-destructive/10 h-8"
              onClick={() => onReview(swap, false)} disabled={reviewPending}>
              <XCircle className="h-3.5 w-3.5 mr-1.5" />Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

const VisualOverrideCard = memo(function VisualOverrideCard({
  ov,
  onDelete,
}: { ov: any; onDelete: (o: any) => void }) {
  const hasLeave = ov.duty && !["ND","DAY","PD","OFF","REST"].includes(ov.duty);
  const dutyChanged = ov.targetDuty && ov.targetDuty !== ov.duty;
  const editedAt = ov.madeAt ?? ov.date ?? "";

  const leaveTypeLabel = ov.coveredByOfficerName
    ? "Cover"
    : ov.swappedWithOfficerName
    ? "Swap (Master)"
    : ov.duty && !["ND","DAY","PD","OFF","REST"].includes(ov.duty)
    ? ov.duty
    : "Master Edit";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded uppercase shrink-0">
                Master
              </span>
              <span className="text-sm font-semibold">{ov.officerName}</span>
            </div>
          </div>
          <button type="button" onClick={() => onDelete(ov)}
            className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded shrink-0" title="Undo override">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">Leave Type:</span>
          <span>{leaveTypeLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">Date:</span>
          <span>{dateLabel(ov.date)}</span>
        </div>
        {ov.madeBy && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Applied by:</span>
            <span>{ov.madeBy}</span>
          </div>
        )}
        {ov.unitCode && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Catchment:</span>
            <span>{ov.unitCode}</span>
          </div>
        )}
        {dutyChanged && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Duty:</span>
            <span className="line-through">{ov.targetDuty}</span>
            <span>→</span>
            <span className={cn("font-semibold", hasLeave ? "text-red-600" : "text-foreground")}>{ov.duty}</span>
          </div>
        )}
        {!dutyChanged && ov.duty && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Duty:</span>
            <span className={cn("font-semibold", hasLeave ? "text-red-600" : "text-foreground")}>{ov.duty}</span>
          </div>
        )}
        {ov.coveredByOfficerName && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Covered by:</span>
            <span className="text-green-700 font-medium">{ov.coveredByOfficerName}</span>
          </div>
        )}
        {ov.swappedWithOfficerName && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Swapped with:</span>
            <span className="text-violet-700 font-medium">{ov.swappedWithOfficerName}</span>
          </div>
        )}
        {ov.vehicle && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Vehicle:</span>
            <span className="font-mono text-orange-600">{ov.vehicle}</span>
          </div>
        )}
        {(ov.madeBy || editedAt) && (
          <div className="pt-0.5 border-t border-dashed border-muted mt-1">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">Last edited:</span>
              <span>{[ov.madeBy, editedAt ? fmtEditedAt(editedAt) : ""].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

const OverrideCard = memo(function OverrideCard({
  ev,
  onDelete,
}: { ev: any; onDelete: (o: any) => void }) {
  const [expanded, setExpanded] = useState(false);
  const applied: any[] = ev.applied ?? [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase shrink-0 flex items-center gap-1">
                <LayoutGrid className="h-2.5 w-2.5" /> Override
              </span>
              <span className="text-sm font-semibold">{dateLabel(ev.date)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              By {ev.submittedBy} · {applied.length} officer{applied.length !== 1 ? "s" : ""} updated
              {ev.submittedAt && <span> · {format(new Date(ev.submittedAt), "d MMM HH:mm")}</span>}
            </div>
          </div>
          <button type="button" onClick={() => onDelete(ev)}
            className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded shrink-0" title="Delete override">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardHeader>
      {applied.length > 0 && (
        <CardContent className="pt-0 space-y-2">
          <div className="flex flex-wrap gap-1">
            {applied.map((a: any, i: number) => (
              <span key={i} className="text-[11px] bg-muted rounded px-1.5 py-0.5">
                {a.officerName} <span className="font-bold">{a.duty}</span>
              </span>
            ))}
          </div>
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="text-[11px] text-primary hover:underline">
            {expanded ? "Hide text" : "Show pasted text"}
          </button>
          {expanded && (
            <pre className="text-[11px] font-mono bg-muted rounded p-2 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto border">
              {ev.text}
            </pre>
          )}
        </CardContent>
      )}
    </Card>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ApplicationsManage() {
  const { user } = useAuth();
  const { bumpVersion } = useRosterVersion();
  const { data: swaps, isLoading: swapsLoading, refetch: refetchSwaps } = useGetRosterSwaps();
  const reviewSwap = useReviewRosterSwap();

  const [leaves, setLeaves] = useState<any[]>([]);
  const [leavesLoading, setLeavesLoading] = useState(true);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(true);
  const [visualOverrides, setVisualOverrides] = useState<any[]>([]);
  const [visualOverridesLoading, setVisualOverridesLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());

  // Swap review dialog
  const [swapReviewTarget, setSwapReviewTarget] = useState<any | null>(null);
  const [swapApprove, setSwapApprove] = useState(true);

  // Cover-respond decline dialog (accept goes straight through, no dialog needed)
  const [coverDeclineTarget, setCoverDeclineTarget] = useState<any | null>(null);
  const [coverDeclineReason, setCoverDeclineReason] = useState("");

  // IC review dialog
  const [icReviewTarget, setIcReviewTarget] = useState<any | null>(null);
  const [icNote, setIcNote] = useState("");

  // Delete dialogs
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteOverrideTarget, setDeleteOverrideTarget] = useState<any | null>(null);
  const [deleteVisualOverrideTarget, setDeleteVisualOverrideTarget] = useState<any | null>(null);
  const [deleteSwapTarget, setDeleteSwapTarget] = useState<any | null>(null);

  // Clear history
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Matches the backend's own check (admin/manager only) — previously also
  // showed this button to "ic", who the server always 403'd.
  // .scratch/replit-resync-2026-09-21/issues/19.
  const canClearHistory = user?.role === "admin" || user?.role === "manager";

  const fetchLeaves = useCallback(async () => {
    setLeavesLoading(true);
    try {
      const res = await fetch("/api/leave-requests", { credentials: "include" });
      if (res.ok) setLeaves(await res.json());
    } finally { setLeavesLoading(false); }
  }, []);

  const fetchOverrides = useCallback(async () => {
    setOverridesLoading(true);
    try {
      const res = await fetch("/api/roster-plan/day-overrides", { credentials: "include" });
      if (res.ok) setOverrides(await res.json());
    } finally { setOverridesLoading(false); }
  }, []);

  const fetchVisualOverrides = useCallback(async () => {
    setVisualOverridesLoading(true);
    try {
      const res = await fetch("/api/roster-plan/overrides", { credentials: "include" });
      if (res.ok) setVisualOverrides(await res.json());
    } finally { setVisualOverridesLoading(false); }
  }, []);

  useEffect(() => { fetchLeaves(); fetchOverrides(); fetchVisualOverrides(); }, [fetchLeaves, fetchOverrides, fetchVisualOverrides]);

  const handleRefresh = useCallback(() => {
    fetchLeaves(); fetchOverrides(); fetchVisualOverrides(); refetchSwaps();
  }, [fetchLeaves, fetchOverrides, fetchVisualOverrides, refetchSwaps]);

  const isLoading = leavesLoading || swapsLoading || overridesLoading || visualOverridesLoading;

  // ── Sort-key helpers ─────────────────────────────────────────────────────────
  const leaveEditedAt = (l: any) => l.lastEditedOn ?? l.updatedAt ?? l.createdAt ?? l.date ?? "";
  const swapEditedAt  = (s: any) => {
    const a = s.reviewedAt ?? "";
    const b = s.createdAt ?? "";
    return (a > b ? a : b) || s.date || "";
  };
  const visualOverrideEditedAt = (o: any) => o.madeAt ?? o.date ?? "";

  // ── Covering-officer+date pairs ───────────────────────────────────────────────
  const coveringOfficerDates = useMemo(() => {
    const s = new Set<string>();
    for (const o of visualOverrides) {
      if (o.coveredByOfficerName)
        s.add(`${(o.coveredByOfficerName as string).trim().toLowerCase()}::${o.date ?? ""}`);
    }
    return s;
  }, [visualOverrides]);

  // ── Filtered lists ───────────────────────────────────────────────────────────
  const filteredLeaves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leaves
      .filter(l => !q || [l.officerName, l.icName, l.leaveType, l.coverOfficerName].some(v => (v ?? "").toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => leaveEditedAt(b).localeCompare(leaveEditedAt(a)));
  }, [leaves, search]);

  const swapList = (swaps ?? []) as any[];
  const filteredSwaps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return swapList
      .filter(s => {
        const reqKey = `${(s.requesterName ?? "").trim().toLowerCase()}::${s.date ?? ""}`;
        const tgtKey = `${(s.targetName ?? "").trim().toLowerCase()}::${s.date ?? ""}`;
        if (coveringOfficerDates.has(reqKey) || coveringOfficerDates.has(tgtKey)) return false;
        return !q || [s.requesterName, s.targetName, s.reviewerName, s.phName, s.type, s.kind, s.phName ? "ph swap" : null]
          .some(v => (v ?? "").toLowerCase().includes(q));
      })
      .slice()
      .sort((a, b) => swapEditedAt(b).localeCompare(swapEditedAt(a)));
  }, [swapList, search, coveringOfficerDates]);

  const filteredOverrides = useMemo(() => {
    const q = search.trim().toLowerCase();
    return overrides
      .filter(o => !q || [o.date, o.submittedBy, o.text, ...(o.applied ?? []).map((a: any) => a.officerName)].some(v => (v ?? "").toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }, [overrides, search]);

  const filteredVisualOverrides = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visualOverrides
      .filter(o => {
        const key = `${(o.officerName ?? "").trim().toLowerCase()}::${o.date ?? ""}`;
        if (coveringOfficerDates.has(key) && o.swappedWithOfficerName) return false;
        return !q || [o.officerName, o.unitCode, o.date, o.duty, o.targetDuty, o.vehicle, o.coveredByOfficerName].some(v => (v ?? "").toLowerCase().includes(q));
      })
      .slice()
      .sort((a, b) => visualOverrideEditedAt(b).localeCompare(visualOverrideEditedAt(a)));
  }, [visualOverrides, search, coveringOfficerDates]);

  const pendingSwaps = useMemo(() => filteredSwaps.filter(s => s.status === "PENDING"), [filteredSwaps]);

  // ── Combined list — sorted by Last Edited Date desc ────────────────────────
  const allItems = useMemo(() => {
    const items: Array<{ _type: string; _sortKey: string; _id: string; data: any }> = [
      ...filteredLeaves.map(l => ({ _type: l.source === "override" ? "visual-override" : "leave", _sortKey: leaveEditedAt(l), _id: `leave-${l.id}`, data: l })),
      ...filteredSwaps.map(s => ({ _type: "swap", _sortKey: swapEditedAt(s), _id: `swap-${s.id}`, data: s })),
      ...filteredVisualOverrides.map(o => ({ _type: "visual-override", _sortKey: visualOverrideEditedAt(o), _id: `vo-${o.officerId}-${o.date}`, data: o })),
      ...filteredOverrides.map(o => ({ _type: "override", _sortKey: o.submittedAt ?? o.date ?? "", _id: `override-${o.id}`, data: o })),
    ];
    const sorted = items.sort((a, b) => b._sortKey.localeCompare(a._sortKey));
    if (typeFilter.size === 0) return sorted;
    return sorted.filter(item => {
      if (typeFilter.has("Leave")  && item._type === "leave") return true;
      if (typeFilter.has("Swap")   && item._type === "swap")  return true;
      if (typeFilter.has("Master") && (item._type === "visual-override" || item._type === "override")) return true;
      return false;
    });
  }, [filteredLeaves, filteredSwaps, filteredVisualOverrides, filteredOverrides, typeFilter]);

  // ── Centralised sync — call after every mutating action ───────────────────
  const syncAll = useCallback(() => {
    bumpVersion();
    fetchLeaves();
    fetchOverrides();
    fetchVisualOverrides();
    refetchSwaps();
  }, [bumpVersion, fetchLeaves, fetchOverrides, fetchVisualOverrides, refetchSwaps]);

  const handleClearHistory = useCallback(async () => {
    setClearing(true);
    try {
      await fetch(`/api/roster-plan/history/clear`, {
        method: "DELETE",
        credentials: "include",
      });
      setClearConfirmOpen(false);
      syncAll();
    } finally {
      setClearing(false);
    }
  }, [syncAll]);

  // ── Action handlers ────────────────────────────────────────────────────────
  const handleDeleteLeave = useCallback(async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/leave-requests/${deleteTarget.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Delete failed"); }
      syncAll();
    } catch (err: any) { alert(err.message); }
    finally { setDeleteTarget(null); setActionLoading(false); }
  }, [deleteTarget, syncAll]);

  const handleDeleteOverride = useCallback(async () => {
    if (!deleteOverrideTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/roster-plan/day-overrides/${deleteOverrideTarget.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Delete failed"); }
      syncAll();
    } catch (err: any) { alert(err.message); }
    finally { setDeleteOverrideTarget(null); setActionLoading(false); }
  }, [deleteOverrideTarget, syncAll]);

  const handleDeleteVisualOverride = useCallback(async () => {
    if (!deleteVisualOverrideTarget) return;
    setActionLoading(true);
    try {
      const { officerId, date } = deleteVisualOverrideTarget;
      const res = await fetch(`/api/roster-plan/overrides/${encodeURIComponent(officerId)}/${encodeURIComponent(date)}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Delete failed"); }
      syncAll();
    } catch (err: any) { alert(err.message); }
    finally { setDeleteVisualOverrideTarget(null); setActionLoading(false); }
  }, [deleteVisualOverrideTarget, syncAll]);

  const handleSwapReview = useCallback(async (approved: boolean) => {
    if (!swapReviewTarget) return;
    reviewSwap.mutate(
      { id: swapReviewTarget.id, data: { approved, reviewerName: user?.officerName ?? user?.username ?? "" } },
      { onSuccess: () => { syncAll(); setSwapReviewTarget(null); } }
    );
  }, [swapReviewTarget, reviewSwap, user, syncAll]);

  const handleDeleteSwap = useCallback(async () => {
    if (!deleteSwapTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/roster-plan/swaps/${encodeURIComponent(deleteSwapTarget.id)}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Delete failed"); }
      syncAll();
    } catch (err: any) { alert(err.message); }
    finally { setDeleteSwapTarget(null); setActionLoading(false); }
  }, [deleteSwapTarget, syncAll]);

  // Accept records the cover officer's decision on their behalf, same as
  // every other action on this management-only page (no "only the cover
  // officer's own account may click this" restriction — there's no
  // crew-facing screen for this today, ported from the never-routed
  // Approvals.tsx). Decline opens a dialog to optionally record a reason.
  const handleCoverAccept = useCallback(async (leaf: any) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/leave-requests/${leaf.id}/cover-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accepted: true }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Could not record cover response"); }
      syncAll();
    } catch (err: any) { alert(err.message); }
    finally { setActionLoading(false); }
  }, [syncAll]);

  const handleCoverDeclineSubmit = useCallback(async () => {
    if (!coverDeclineTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/leave-requests/${coverDeclineTarget.id}/cover-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accepted: false, declineReason: coverDeclineReason }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Could not record cover response"); }
      syncAll();
    } catch (err: any) { alert(err.message); }
    finally { setCoverDeclineTarget(null); setCoverDeclineReason(""); setActionLoading(false); }
  }, [coverDeclineTarget, coverDeclineReason, syncAll]);

  const handleIcReviewSubmit = useCallback(async (approved: boolean) => {
    if (!icReviewTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/leave-requests/${icReviewTarget.id}/ic-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ approved, note: icNote }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Could not record IC review"); }
      syncAll();
    } catch (err: any) { alert(err.message); }
    finally { setIcReviewTarget(null); setIcNote(""); setActionLoading(false); }
  }, [icReviewTarget, icNote, syncAll]);

  // Stable card callback refs
  const onDeleteLeave         = useCallback((l: any) => setDeleteTarget(l), []);
  const onDeleteVisualOverride = useCallback((o: any) => setDeleteVisualOverrideTarget(o), []);
  const onDeleteOverride      = useCallback((o: any) => setDeleteOverrideTarget(o), []);
  const onDeleteSwap          = useCallback((s: any) => setDeleteSwapTarget(s), []);
  const onSwapReview          = useCallback((s: any, approve: boolean) => { setSwapReviewTarget(s); setSwapApprove(approve); }, []);
  const onCoverDecline        = useCallback((l: any) => setCoverDeclineTarget(l), []);
  const onIcReview            = useCallback((l: any) => { setIcReviewTarget(l); setIcNote(""); }, []);

  // admin/manager see every catchment's IC-pending requests; an ic account
  // only sees (and may review) requests within their own assigned
  // catchments — same restriction the never-routed Approvals.tsx enforced.
  const canReviewIc = useCallback((leaf: any) => {
    if (user?.role === "admin" || user?.role === "manager") return true;
    return user?.role === "ic" && (user.catchments ?? []).includes(leaf.officerCatchment);
  }, [user]);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Applications</h2>
            <p className="text-xs text-muted-foreground mt-0.5">All leave, swap, and override records · sorted by last edited</p>
          </div>
          <div className="flex items-center gap-2">
            {canClearHistory && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1 border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Log
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCcw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search officer, leave type, PH swap, date…"
            className="w-full border rounded-md pl-9 pr-3 py-2 text-sm bg-background outline-none focus:ring-2 focus:ring-ring" />
        </div>

        {/* Type filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {(["Leave", "Swap", "Master"] as const).map(f => {
            const isActive = typeFilter.has(f);
            const activeStyle =
              f === "Leave"  ? "bg-blue-100 border-blue-300 text-blue-700" :
              f === "Swap"   ? "bg-violet-100 border-violet-300 text-violet-700" :
                               "bg-orange-100 border-orange-300 text-orange-700";
            return (
              <button key={f} type="button"
                onClick={() => setTypeFilter(prev => { const next = new Set(prev); if (next.has(f)) next.delete(f); else next.add(f); return next; })}
                className={cn(
                  "text-xs font-semibold px-3 py-1 rounded-full border transition-all select-none",
                  isActive ? activeStyle : "bg-muted text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
                )}>
                {f}
              </button>
            );
          })}
          {typeFilter.size > 0 && (
            <button type="button" onClick={() => setTypeFilter(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors">Clear</button>
          )}
        </div>

        {pendingSwaps.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2">
            <span className="text-xs font-semibold text-primary">
              {pendingSwaps.length} swap{pendingSwaps.length !== 1 ? "s" : ""} pending review
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            {allItems.length === 0
              ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{search ? "No records match your search." : "No records yet."}</CardContent></Card>
              : allItems.map(item => {
                  if (item._type === "leave")           return <LeaveCard          key={item._id} leaf={item.data} onDelete={onDeleteLeave} canReviewIc={canReviewIc(item.data)} onCoverAccept={handleCoverAccept} onCoverDecline={onCoverDecline} onIcReview={onIcReview} />;
                  if (item._type === "swap")            return <SwapCard           key={item._id} swap={item.data} onReview={onSwapReview} onDelete={onDeleteSwap} reviewPending={reviewSwap.isPending} />;
                  if (item._type === "visual-override") return <VisualOverrideCard key={item._id} ov={item.data}   onDelete={onDeleteVisualOverride} />;
                  if (item._type === "override")        return <OverrideCard       key={item._id} ev={item.data}   onDelete={onDeleteOverride} />;
                  return null;
                })
            }
          </div>
        )}
      </div>

      {/* ── Delete leave dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Leave Record</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove the <span className="font-semibold text-foreground">{deleteTarget?.leaveType}</span> leave for{" "}
            <span className="font-semibold text-foreground">{deleteTarget?.officerName}</span>
            {deleteTarget?.date ? ` on ${dateLabel(deleteTarget.date)}` : ""}?
            The roster will revert to the original duty.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteLeave} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete override dialog ── */}
      <Dialog open={!!deleteOverrideTarget} onOpenChange={() => setDeleteOverrideTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Override Record</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove the override for{" "}
            <span className="font-semibold text-foreground">
              {deleteOverrideTarget?.date ? dateLabel(deleteOverrideTarget.date) : "—"}
            </span>?
            Duty overrides applied by this event will be removed.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOverrideTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteOverride} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete visual override dialog ── */}
      <Dialog open={!!deleteVisualOverrideTarget} onOpenChange={() => setDeleteVisualOverrideTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Undo Master Override</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove the override for{" "}
            <span className="font-semibold text-foreground">{deleteVisualOverrideTarget?.officerName}</span>
            {deleteVisualOverrideTarget?.date ? ` on ${dateLabel(deleteVisualOverrideTarget.date)}` : ""}?
            The officer will revert to their original cycle duty.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteVisualOverrideTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteVisualOverride} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Undo Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete swap dialog ── */}
      <Dialog open={!!deleteSwapTarget} onOpenChange={() => setDeleteSwapTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Swap Record</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove the swap between{" "}
            <span className="font-semibold text-foreground">{deleteSwapTarget?.requesterName}</span>
            {" "}and{" "}
            <span className="font-semibold text-foreground">{deleteSwapTarget?.targetName ?? "—"}</span>
            {deleteSwapTarget?.date ? ` on ${dateLabel(deleteSwapTarget.date)}` : ""}?
            {deleteSwapTarget?.status === "APPROVED" && " Duty overrides for both officers will be reverted."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSwapTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSwap} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Swap review confirm dialog ── */}
      <Dialog open={!!swapReviewTarget} onOpenChange={() => setSwapReviewTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{swapApprove ? "Approve" : "Reject"} Swap</DialogTitle></DialogHeader>
          {swapReviewTarget && (
            <div className="bg-muted rounded-md p-3 text-sm space-y-1">
              <div><span className="font-medium">Swap:</span> {swapReviewTarget.requesterName} ⇄ {swapReviewTarget.targetName}</div>
              <div><span className="font-medium">Date:</span>{" "}{swapReviewTarget.date ? dateLabel(swapReviewTarget.date) : "—"}</div>
              {swapReviewTarget.requesterDuty && (
                <div><span className="font-medium">Duties:</span> {swapReviewTarget.requesterDuty} ⇄ {swapReviewTarget.targetDuty ?? "—"}</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwapReviewTarget(null)}>Cancel</Button>
            <Button
              variant={swapApprove ? "default" : "destructive"}
              className={swapApprove ? "bg-green-600 hover:bg-green-700" : ""}
              onClick={() => handleSwapReview(swapApprove)}
              disabled={reviewSwap.isPending}>
              {reviewSwap.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {swapApprove ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cover decline dialog ── */}
      <Dialog open={!!coverDeclineTarget} onOpenChange={() => { setCoverDeclineTarget(null); setCoverDeclineReason(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Decline Cover Request</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Recording that <span className="font-semibold text-foreground">{coverDeclineTarget?.coverOfficerName ?? "the cover officer"}</span> declined
            to cover {coverDeclineTarget?.officerName}
            {coverDeclineTarget?.date ? ` on ${dateLabel(coverDeclineTarget.date)}` : ""}.
            Please provide a reason if given.
          </p>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              value={coverDeclineReason}
              onChange={e => setCoverDeclineReason(e.target.value)}
              placeholder="e.g. On medical leave that day"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCoverDeclineTarget(null); setCoverDeclineReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleCoverDeclineSubmit} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── IC review dialog ── */}
      <Dialog open={!!icReviewTarget} onOpenChange={() => { setIcReviewTarget(null); setIcNote(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Review Leave Request</DialogTitle></DialogHeader>
          {icReviewTarget && (
            <div className="bg-muted rounded-md p-3 text-sm space-y-1">
              <div><span className="font-medium">Officer:</span> {icReviewTarget.officerName}</div>
              <div><span className="font-medium">Date:</span> {icReviewTarget.date ? dateLabel(icReviewTarget.date) : "—"}</div>
              <div><span className="font-medium">Leave type:</span> {icReviewTarget.leaveType}</div>
              {icReviewTarget.coverOfficerName && (
                <div><span className="font-medium">Cover:</span> {icReviewTarget.coverOfficerName} ({icReviewTarget.coverStatus})</div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              value={icNote}
              onChange={e => setIcNote(e.target.value)}
              placeholder="Add a note…"
              rows={2}
            />
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => { setIcReviewTarget(null); setIcNote(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => handleIcReviewSubmit(false)}
              disabled={actionLoading}
              className="flex-1"
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={() => handleIcReviewSubmit(true)}
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
            <DialogTitle>Clear Application Log</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Permanently deletes the leave-application log entries shown on this page.</p>
            <p>This does not affect committed leave records, overrides, or swaps — only the
              request/audit history.</p>
            <p className="font-medium text-destructive">This cannot be undone.</p>
          </div>
          <div className="space-y-2 pt-1">
            <Button
              variant="destructive"
              className="w-full justify-start gap-2"
              onClick={handleClearHistory}
              disabled={clearing}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Trash2 className="h-4 w-4 shrink-0" />}
              <span className="text-left leading-tight">Delete application log</span>
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
