import React, { useState } from "react";
import { format } from "date-fns";
import { Check, X, Plus } from "lucide-react";
import { useGetRosterSwaps, useCreateRosterSwap, useReviewRosterSwap, useGetRosterOfficers, getGetRosterSwapsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Swaps() {
  const { data: swaps, isLoading } = useGetRosterSwaps();
  const { data: officers } = useGetRosterOfficers();
  const reviewSwap = useReviewRosterSwap();
  const createSwap = useCreateRosterSwap();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    requesterId: "",
    targetId: "",
    date: format(new Date(), "yyyy-MM-dd"),
    reason: ""
  });

  const handleReview = (id: string, approved: boolean) => {
    reviewSwap.mutate(
      { id, data: { approved, reviewerName: "Supervisor" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetRosterSwapsQueryKey() });
          toast({ title: `Swap ${approved ? 'approved' : 'rejected'}` });
        }
      }
    );
  };

  const handleCreateSwap = () => {
    if (!formData.requesterId || !formData.targetId || !formData.date) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    
    createSwap.mutate(
      { data: formData },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetRosterSwapsQueryKey() });
          toast({ title: "Swap request submitted" });
          setIsFormOpen(false);
          setFormData({ requesterId: "", targetId: "", date: format(new Date(), "yyyy-MM-dd"), reason: "" });
        }
      }
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "APPROVED": return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">Approved</Badge>;
      case "REJECTED": return <Badge variant="destructive">Rejected</Badge>;
      default: return <Badge variant="secondary" className="text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200">Pending</Badge>;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <header className="h-16 px-6 border-b flex items-center justify-between shrink-0 bg-card">
        <h2 className="text-lg font-semibold">Duty Swap Requests</h2>
        
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Swap Request
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Swap Request</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={formData.date} onChange={e => setFormData(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Requester (Officer taking off)</Label>
                <Select value={formData.requesterId} onValueChange={v => setFormData(f => ({ ...f, requesterId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select officer" /></SelectTrigger>
                  <SelectContent>
                    {officers?.filter(o => o.active).map(o => <SelectItem key={o.id} value={o.id}>{o.name} ({o.unitCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Covering Officer</Label>
                <Select value={formData.targetId} onValueChange={v => setFormData(f => ({ ...f, targetId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select officer" /></SelectTrigger>
                  <SelectContent>
                    {officers?.filter(o => o.active && o.id !== formData.requesterId).map(o => <SelectItem key={o.id} value={o.id}>{o.name} ({o.unitCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Input value={formData.reason} onChange={e => setFormData(f => ({ ...f, reason: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsFormOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateSwap} disabled={createSwap.isPending}>Submit Request</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="p-6 flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          <Card className="overflow-hidden border-0 shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                <tr>
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4 font-semibold">Requester</th>
                  <th className="px-6 py-4 font-semibold">Covering</th>
                  <th className="px-6 py-4 font-semibold">Reason</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-6">
                      <div className="space-y-3">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    </td>
                  </tr>
                ) : swaps?.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-muted-foreground">
                      No swap requests found.
                    </td>
                  </tr>
                ) : (
                  swaps?.map((swap) => (
                    <tr key={swap.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 font-medium text-foreground whitespace-nowrap">
                        {format(new Date(swap.date), "MMM d, yyyy")}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium">{swap.requesterName}</div>
                        <div className="text-xs text-muted-foreground">Duty: {swap.requesterDuty || 'N/A'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium">{swap.targetName}</div>
                        <div className="text-xs text-muted-foreground">Duty: {swap.targetDuty || 'N/A'}</div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground max-w-[200px] truncate" title={swap.reason}>
                        {swap.reason || "-"}
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(swap.status)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {swap.status === "PENDING" ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => handleReview(swap.id, true)} disabled={reviewSwap.isPending}>
                              <Check className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleReview(swap.id, false)} disabled={reviewSwap.isPending}>
                              <X className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Reviewed by {swap.reviewerName || "System"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
}
