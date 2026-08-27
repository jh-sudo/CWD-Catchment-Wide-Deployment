import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserCheck, UserX, Trash2, RefreshCw, ShieldAlert,
  Clock, CheckCircle2, XCircle, KeyRound, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type AccountRole = "admin" | "manager" | "ic" | "crew";

interface ManagerAccount {
  id: string;
  username: string;
  role: AccountRole;
  approved: boolean;
  createdAt: string;
  officerId?: string;
  officerName?: string;
  catchments?: string[];
  hasPendingReset?: boolean;
  resetRequestedAt?: string;
  // SSP ac-3/ac-4 — undefined means never successfully logged in.
  lastLoginAt?: string;
}

const ROLE_LABELS: Record<AccountRole, string> = {
  admin: "Admin",
  manager: "Manager",
  ic: "Roster IC",
  crew: "Crew",
};

const ROLE_COLORS: Record<AccountRole, string> = {
  admin: "bg-red-100 text-red-700 border-red-200",
  manager: "bg-purple-100 text-purple-700 border-purple-200",
  ic: "bg-blue-100 text-blue-700 border-blue-200",
  crew: "bg-green-100 text-green-700 border-green-200",
};

// SSP ac-3/ac-4 — surfaces enough to support a manual dormant-account review
// (no automated disablement here, just visibility). 90 days matches ac-3's
// own default "not used for [90] days" parameter.
const DORMANT_DAYS = 90;
function lastLoginLabel(lastLoginAt?: string): { text: string; dormant: boolean } {
  if (!lastLoginAt) return { text: "Never logged in", dormant: true };
  const days = (Date.now() - new Date(lastLoginAt).getTime()) / 86_400_000;
  const text = new Date(lastLoginAt).toLocaleString("en-SG", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
  return { text: `Last login ${text}`, dormant: days > DORMANT_DAYS };
}

async function apiCall(url: string, method = "GET", body?: object) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

export default function Users() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<ManagerAccount | null>(null);

  const { data: users, isLoading } = useQuery<ManagerAccount[]>({
    queryKey: ["managers"],
    queryFn: () => apiCall("/manager/auth/managers"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["managers"] });

  const approve = useMutation({
    mutationFn: (id: string) => apiCall(`/manager/auth/managers/${id}/approve`, "POST"),
    onSuccess: (_, id) => {
      invalidate();
      const u = users?.find(x => x.id === id);
      toast({ title: "Account approved", description: u?.username });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiCall(`/manager/auth/managers/${id}/revoke`, "POST"),
    onSuccess: (_, id) => {
      invalidate();
      const u = users?.find(x => x.id === id);
      toast({ title: "Access revoked", description: u?.username });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiCall(`/manager/auth/managers/${id}`, "DELETE"),
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast({ title: "Account deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AccountRole }) =>
      apiCall(`/manager/auth/managers/${id}`, "PUT", { role }),
    onSuccess: () => { invalidate(); toast({ title: "Role updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approveReset = useMutation({
    mutationFn: (id: string) => apiCall(`/manager/auth/managers/${id}/approve-reset`, "POST"),
    onSuccess: (_, id) => {
      invalidate();
      const u = users?.find(x => x.id === id);
      toast({ title: "Password reset approved", description: u?.username });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pending = users?.filter(u => !u.approved && u.role !== "admin") ?? [];
  const active  = users?.filter(u => u.approved) ?? [];
  const revoked = users?.filter(u => !u.approved && u.role !== "admin" &&
    !pending.find(p => p.id === u.id)) ?? [];

  // Sort: pending first, then by role, then username
  const sortedActive = [...active].sort((a, b) => {
    const ro: Record<string, number> = { admin: 0, manager: 1, ic: 2, crew: 3 };
    return (ro[a.role] ?? 9) - (ro[b.role] ?? 9) || a.username.localeCompare(b.username);
  });

  const pendingResets = users?.filter(u => u.hasPendingReset) ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b bg-card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">User Accounts</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Approve registrations, manage roles and access
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={invalidate}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── Pending Approvals ── */}
        {(isLoading || pending.length > 0) && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-amber-600">
                Pending Approval
                {pending.length > 0 && (
                  <span className="ml-2 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full font-bold">
                    {pending.length}
                  </span>
                )}
              </h3>
            </div>
            <div className="space-y-2">
              {isLoading ? (
                Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
              ) : (
                pending.map(u => (
                  <Card key={u.id} className="p-4 border-amber-200 bg-amber-50/50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{u.username}</span>
                          {u.officerName && (
                            <span className="text-xs text-muted-foreground">({u.officerName})</span>
                          )}
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border",
                            ROLE_COLORS[u.role],
                          )}>
                            {ROLE_LABELS[u.role]}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-amber-600">
                            <Clock className="h-3 w-3" />
                            {u.createdAt
                              ? new Date(u.createdAt).toLocaleString("en-SG", {
                                  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                                })
                              : "—"}
                          </span>
                        </div>
                        {u.catchments && u.catchments.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Catchments: {u.catchments.join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          onClick={() => approve.mutate(u.id)}
                          disabled={approve.isPending}
                          className="bg-green-600 hover:bg-green-700 text-white h-8"
                        >
                          <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteTarget(u)}
                          className="border-red-200 text-red-600 hover:bg-red-50 h-8"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </section>
        )}

        {/* ── Pending Password Resets ── */}
        {pendingResets.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="h-4 w-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-blue-600">
                Pending Password Resets
                <span className="ml-2 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full font-bold">
                  {pendingResets.length}
                </span>
              </h3>
            </div>
            <div className="space-y-2">
              {pendingResets.map(u => (
                <Card key={u.id} className="p-4 border-blue-200 bg-blue-50/50">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-semibold text-sm">{u.username}</span>
                      {u.resetRequestedAt && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Requested {new Date(u.resetRequestedAt).toLocaleString("en-SG", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => approveReset.mutate(u.id)}
                      disabled={approveReset.isPending}
                      className="bg-blue-600 hover:bg-blue-700 text-white h-8"
                    >
                      <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                      Approve Reset
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* ── Active Accounts ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <h3 className="text-sm font-semibold text-foreground">
              Active Accounts
              {sortedActive.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({sortedActive.length})
                </span>
              )}
            </h3>
          </div>
          <div className="space-y-2">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
            ) : sortedActive.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No active accounts</p>
            ) : (
              sortedActive.map(u => (
                <Card key={u.id} className="p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{u.username}</span>
                      {u.officerName && u.officerName !== u.username && (
                        <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                          {u.officerName}
                        </span>
                      )}
                      {/* Role pill — clickable dropdown for non-admin */}
                      {u.role === "admin" ? (
                        <span className={cn(
                          "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border",
                          ROLE_COLORS[u.role],
                        )}>
                          {ROLE_LABELS[u.role]}
                        </span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className={cn(
                              "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border flex items-center gap-0.5 cursor-pointer hover:opacity-80 transition-opacity",
                              ROLE_COLORS[u.role],
                            )}>
                              {ROLE_LABELS[u.role]}
                              <ChevronDown className="h-2.5 w-2.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {(["manager", "ic", "crew"] as AccountRole[]).map(r => (
                              <DropdownMenuItem
                                key={r}
                                disabled={u.role === r}
                                onClick={() => changeRole.mutate({ id: u.id, role: r })}
                              >
                                {ROLE_LABELS[r]}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {u.hasPendingReset && (
                        <span className="text-[10px] text-blue-600 flex items-center gap-0.5">
                          <KeyRound className="h-3 w-3" /> Reset pending
                        </span>
                      )}
                      {(() => {
                        const { text, dormant } = lastLoginLabel(u.lastLoginAt);
                        return (
                          <span className={cn(
                            "text-[10px] flex items-center gap-0.5",
                            dormant ? "text-amber-600 font-medium" : "text-muted-foreground",
                          )}>
                            <Clock className="h-3 w-3" /> {text}
                          </span>
                        );
                      })()}
                    </div>
                    {u.role !== "admin" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => revoke.mutate(u.id)}
                          disabled={revoke.isPending}
                          className="border-orange-200 text-orange-600 hover:bg-orange-50 h-7 text-xs"
                        >
                          <UserX className="h-3 w-3 mr-1" />
                          Revoke
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteTarget(u)}
                          className="border-red-200 text-red-600 hover:bg-red-50 h-7"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </section>

        {/* ── Revoked Accounts ── */}
        {!isLoading && revoked.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <XCircle className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-muted-foreground">
                Revoked ({revoked.length})
              </h3>
            </div>
            <div className="space-y-2">
              {revoked.map(u => (
                <Card key={u.id} className="p-3.5 opacity-60">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm line-through text-muted-foreground">
                        {u.username}
                      </span>
                      <span className={cn(
                        "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border",
                        ROLE_COLORS[u.role],
                      )}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => approve.mutate(u.id)}
                        disabled={approve.isPending}
                        className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                      >
                        <UserCheck className="h-3 w-3 mr-1" />
                        Re-approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteTarget(u)}
                        className="border-red-200 text-red-600 hover:bg-red-50 h-7"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.username}</strong>'s account.
              They will need to register again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && del.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
