import React, { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCcw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useGetRosterSwaps } from "@workspace/api-client-react";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING_COVER: { label: "Awaiting Cover",  variant: "secondary" },
  PENDING_IC:    { label: "Awaiting IC",     variant: "default" },
  APPROVED:      { label: "Approved",        variant: "default" },
  REJECTED:      { label: "Rejected",        variant: "destructive" },
  CANCELLED:     { label: "Cancelled",       variant: "outline" },
  PENDING:       { label: "Pending",         variant: "secondary" },
  ACCEPTED:      { label: "Accepted",        variant: "default" },
  DECLINED:      { label: "Declined",        variant: "destructive" },
};

export default function MyApplications() {
  const { user } = useAuth();
  const { data: allSwaps, isLoading: swapsLoading, refetch: refetchSwaps } = useGetRosterSwaps();
  const [leaves, setLeaves] = useState<any[]>([]);
  const [leavesLoading, setLeavesLoading] = useState(true);

  const fetchLeaves = useCallback(async () => {
    setLeavesLoading(true);
    try {
      const res = await fetch("/api/leave-requests", { credentials: "include" });
      if (res.ok) setLeaves(await res.json());
    } finally {
      setLeavesLoading(false);
    }
  }, []);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);

  const mySwaps = ((allSwaps ?? []) as any[])
    .filter(s => s.requesterId === user?.officerId || s.targetId === user?.officerId);

  const myLeaves = leaves.filter((l: any) => !user?.officerId || l.officerId === user.officerId);

  const leaveEditKey = (l: any) => l.lastEditedOn ?? l.updatedAt ?? l.createdAt ?? l.date ?? "";
  const swapEditKey  = (s: any) => { const a = s.reviewedAt ?? ""; const b = s.createdAt ?? ""; return (a > b ? a : b) || s.date || ""; };

  // Show all items sorted by most recently edited on top
  const allItems = [
    ...myLeaves.map((l: any) => ({ ...l, _kind: "leave" as const, _sortKey: leaveEditKey(l) })),
    ...mySwaps.map((s: any)  => ({ ...s, _kind: "swap"  as const, _sortKey: swapEditKey(s)  })),
  ].sort((a, b) => b._sortKey.localeCompare(a._sortKey));

  const handleRefresh = () => { fetchLeaves(); refetchSwaps(); };
  const isLoading = leavesLoading || swapsLoading;

  function renderItem(item: any) {
    const st = STATUS_BADGE[item.status] ?? { label: item.status, variant: "outline" as const };
    const dateLabel = item.date
      ? format(new Date(item.date + "T00:00:00Z"), "EEE, d MMM yyyy")
      : "—";
    const isLeave = item._kind === "leave";
    const iAmRequester = !isLeave && item.requesterId === user?.officerId;

    return (
      <Card key={`${item._kind}-${item.id}`}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0",
                  isLeave ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"
                )}>
                  {isLeave ? "LEAVE" : "SWAP"}
                </span>
                <span className="text-sm font-semibold">{dateLabel}</span>
              </div>
              {isLeave && (
                <div className="text-xs text-muted-foreground mt-0.5">{item.leaveType}</div>
              )}
              {!isLeave && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {iAmRequester
                    ? `Requested swap with ${item.targetName ?? "—"}`
                    : `Swap requested by ${item.requesterName ?? "—"}`}
                  {item.reason && <span className="ml-1">· {item.reason}</span>}
                </div>
              )}
            </div>
            <Badge variant={st.variant} className="text-xs shrink-0">{st.label}</Badge>
          </div>
        </CardHeader>

        {isLeave && (item.coverOfficerName || item.icName || item.lastEditedBy || item.lastEditedOn) && (
          <CardContent className="pt-0 space-y-1">
            {item.coverOfficerName && (
              <div className="text-xs text-muted-foreground">
                Cover:{" "}
                <span className="text-foreground font-medium">{item.coverOfficerName}</span>
                {" "}
                <span className="text-[10px]">
                  {item.coverStatus === "ACCEPTED" ? "✓ Arranged"
                   : item.coverStatus === "DECLINED" ? "✗ Declined" : ""}
                </span>
              </div>
            )}
            {item.icName && (
              <div className="text-xs text-muted-foreground">
                Applied by:{" "}
                <span className="text-foreground font-medium">{item.icName}</span>
                {item.icNote && <span className="text-muted-foreground"> — {item.icNote}</span>}
              </div>
            )}
            {(item.lastEditedBy || item.lastEditedOn) && (
              <div className="text-xs text-muted-foreground pt-0.5 border-t border-dashed border-muted mt-1 space-y-0.5">
                {item.lastEditedBy && (
                  <div>
                    Last edited by:{" "}
                    <span className="text-foreground font-medium">{item.lastEditedBy}</span>
                  </div>
                )}
                {item.lastEditedOn && (
                  <div>
                    Last edited on:{" "}
                    <span className="text-foreground font-medium">
                      {format(parseISO(item.lastEditedOn), "d MMM yyyy, HH:mm")}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">My Leave Status</h2>
            {user?.officerName && (
              <p className="text-sm text-muted-foreground">{user.officerName}</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : allItems.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No leave or swap records yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {allItems.map(renderItem)}
          </div>
        )}
      </div>
    </div>
  );
}
