import React, { useState, useMemo } from "react";
import { Plus, Edit2, Trash2, RotateCcw, Search, LayoutGrid, List, Wrench, GripVertical } from "lucide-react";
import {
  useGetRosterOfficers,
  useCreateRosterOfficer,
  useUpdateRosterOfficer,
  useDeleteRosterOfficer,
  useGetRosterConfig,
  useUpdateRosterConfig,
  getGetRosterOfficersQueryKey,
  getGetRosterConfigQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useRosterVersion } from "@/context/RosterVersionContext";

// ── Draggable vehicle plate card ──────────────────────────────────────────────
function VehiclePlateCard({
  plate,
  source,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  plate: string;
  source: string;
  isDragging: boolean;
  onDragStart: (plate: string, source: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(plate, source); }}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-1.5 bg-primary/10 border border-primary/25 rounded-md px-2.5 py-2
        cursor-grab active:cursor-grabbing select-none transition-all hover:shadow-md hover:border-primary/50
        ${isDragging ? "opacity-30 scale-95" : ""}`}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      <span className="text-sm font-bold tracking-wide text-foreground">{plate}</span>
    </div>
  );
}

// ── Team drop column ──────────────────────────────────────────────────────────
function TeamColumn({
  slot,
  vehicle,
  officers,
  isActive,
  dragging,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDrop,
}: {
  slot: number;
  vehicle: string;
  officers: any[];
  isActive: boolean;
  dragging: { plate: string; source: string } | null;
  onDragStart: (plate: string, source: string) => void;
  onDragEnd: () => void;
  onDragEnter: (col: string) => void;
  onDragLeave: (col: string) => void;
  onDrop: (col: string) => void;
}) {
  const colId = String(slot);
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => onDragEnter(colId)}
      onDragLeave={() => onDragLeave(colId)}
      onDrop={() => onDrop(colId)}
      className={`rounded-lg border-2 p-2.5 flex flex-col gap-1.5 min-h-24 transition-colors
        ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        Team {slot}
      </div>

      {/* Vehicle plate — the draggable item */}
      {vehicle ? (
        <VehiclePlateCard
          plate={vehicle}
          source={colId}
          isDragging={dragging?.plate === vehicle && dragging?.source === colId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      ) : (
        <div className={`border border-dashed rounded-md px-2.5 py-2 text-[10px] text-muted-foreground/40 italic transition-colors
          ${isActive && dragging ? "border-primary/40 bg-primary/5" : "border-border/50"}`}>
          no vehicle
        </div>
      )}

      {/* Officer names — static reference, not draggable */}
      {officers.map((o) => (
        <div key={o.id} className="text-[10px] text-muted-foreground truncate leading-tight pl-0.5">
          C{o.crewPosition} {o.name}
        </div>
      ))}
    </div>
  );
}

// ── Maintenance drop zone ─────────────────────────────────────────────────────
function MaintenanceZone({
  vehicles,
  isActive,
  dragging,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDrop,
}: {
  vehicles: string[];
  isActive: boolean;
  dragging: { plate: string; source: string } | null;
  onDragStart: (plate: string, source: string) => void;
  onDragEnd: () => void;
  onDragEnter: (col: string) => void;
  onDragLeave: (col: string) => void;
  onDrop: (col: string) => void;
}) {
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => onDragEnter("maintenance")}
      onDragLeave={() => onDragLeave("maintenance")}
      onDrop={() => onDrop("maintenance")}
      className={`rounded-lg border-2 p-3 transition-colors
        ${isActive
          ? "border-orange-400 bg-orange-50 dark:bg-orange-950/20"
          : "border-orange-200 bg-orange-50/40 dark:border-orange-800 dark:bg-orange-950/10"}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-bold text-orange-600 dark:text-orange-400 mb-2">
        <Wrench className="h-3.5 w-3.5" />
        Under Maintenance
        <span className="ml-auto text-[10px] font-normal text-orange-500">{vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="flex flex-wrap gap-2 min-h-10">
        {vehicles.map((plate) => (
          <VehiclePlateCard
            key={plate}
            plate={plate}
            source="maintenance"
            isDragging={dragging?.plate === plate && dragging?.source === "maintenance"}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
        {vehicles.length === 0 && (
          <div className={`text-[10px] italic transition-colors ${isActive && dragging ? "text-orange-400" : "text-orange-300 dark:text-orange-700"}`}>
            Drop vehicles here to mark as under maintenance
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Officers() {
  const { data: officers, isLoading: officersLoading } = useGetRosterOfficers();
  const { data: config, isLoading: configLoading } = useGetRosterConfig();
  const createOfficer = useCreateRosterOfficer();
  const updateOfficer = useUpdateRosterOfficer();
  const deleteOfficer = useDeleteRosterOfficer();
  const updateConfig = useUpdateRosterConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { bumpVersion } = useRosterVersion();

  const [view, setView] = useState<"board" | "list">("board");
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", unitCode: "", vehicle: "", catchment: "", teamSlot: 1, crewPosition: 1 });

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState<{ plate: string; source: string } | null>(null);
  const [dragCounters, setDragCounters] = useState<Record<string, number>>({});
  const activeCol = Object.keys(dragCounters).find((k) => (dragCounters[k] ?? 0) > 0) ?? null;

  const handleDragStart = (plate: string, source: string) => setDragging({ plate, source });
  const handleDragEnd = () => { setDragging(null); setDragCounters({}); };
  const handleDragEnter = (col: string) => setDragCounters((c) => ({ ...c, [col]: (c[col] ?? 0) + 1 }));
  const handleDragLeave = (col: string) => setDragCounters((c) => ({ ...c, [col]: Math.max(0, (c[col] ?? 0) - 1) }));

  // ── Drop: vehicle-centric swap logic ────────────────────────────────────────
  const handleDrop = async (targetCol: string) => {
    setDragCounters({});
    if (!dragging || !officers || !config) return;
    const { plate, source } = dragging;
    setDragging(null);
    if (source === targetCol) return;

    const maintenanceVehicles: string[] = (config as any).maintenanceVehicles ?? [];

    // Officers in source/target teams (by slot number)
    const officersInSource = source === "maintenance" ? [] : officers.filter((o) => o.active && o.teamSlot === parseInt(source));
    const officersInTarget = targetCol === "maintenance" ? [] : officers.filter((o) => o.active && o.teamSlot === parseInt(targetCol));

    // Vehicle currently sitting in the target (will be displaced)
    const displacedPlate = targetCol === "maintenance" ? "" : officersInTarget.find((o) => o.vehicle)?.vehicle ?? "";

    try {
      // 1. Update source team: give them the displaced plate (swap) or clear
      if (source !== "maintenance" && officersInSource.length > 0) {
        await Promise.all(
          officersInSource.map((o) =>
            updateOfficer.mutateAsync({ id: o.id, data: { ...o, vehicle: displacedPlate } as any })
          )
        );
      }

      // 2. Update target team: give them the dragged plate
      if (targetCol !== "maintenance" && officersInTarget.length > 0) {
        await Promise.all(
          officersInTarget.map((o) =>
            updateOfficer.mutateAsync({ id: o.id, data: { ...o, vehicle: plate } as any })
          )
        );
      }

      // 3. Update maintenance vehicle list
      let newMaintenance = [...maintenanceVehicles];
      if (source === "maintenance") {
        // Remove dragged plate from maintenance
        newMaintenance = newMaintenance.filter((v) => v !== plate);
      }
      if (targetCol === "maintenance") {
        // Add dragged plate to maintenance (if not already there)
        if (!newMaintenance.includes(plate)) newMaintenance.push(plate);
      }
      // If a vehicle was displaced from the target, it goes into maintenance if target ≠ maintenance
      // (since source team already received it as a swap — unless source was maintenance)
      if (source === "maintenance" && displacedPlate && !newMaintenance.includes(displacedPlate)) {
        // Displaced plate goes back into maintenance (the old maintenance slot is now taken by plate)
        newMaintenance.push(displacedPlate);
      }

      if (JSON.stringify(newMaintenance) !== JSON.stringify(maintenanceVehicles)) {
        await updateConfig.mutateAsync({ data: { ...(config as any), maintenanceVehicles: newMaintenance } });
      }

      await queryClient.invalidateQueries({ queryKey: getGetRosterOfficersQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetRosterConfigQueryKey() });
      bumpVersion();

      toast({
        title: targetCol === "maintenance"
          ? `${plate} moved to Maintenance`
          : source === "maintenance"
            ? `${plate} assigned to Team ${targetCol}`
            : `${plate} ↔ Team ${targetCol}${displacedPlate ? ` (swapped with ${displacedPlate})` : ""}`,
      });
    } catch {
      toast({ title: "Move failed", variant: "destructive" });
    }
  };

  // ── Board data ──────────────────────────────────────────────────────────────
  const boardData = useMemo(() => {
    if (!officers || !config) return null;
    const maintenanceVehicles: string[] = (config as any).maintenanceVehicles ?? [];

    const byTeam: Record<number, any[]> = {};
    for (const o of officers) {
      if (!o.active) continue;
      if (!byTeam[o.teamSlot]) byTeam[o.teamSlot] = [];
      byTeam[o.teamSlot].push(o);
    }

    const teams = Array.from({ length: config.teamCount }, (_, i) => {
      const slot = i + 1;
      const slotOfficers = (byTeam[slot] ?? []).sort((a: any, b: any) => a.crewPosition - b.crewPosition);
      const vehicle = slotOfficers.find((o: any) => o.vehicle)?.vehicle ?? "";
      return { slot, vehicle, officers: slotOfficers };
    });

    return { teams, maintenanceVehicles };
  }, [officers, config]);

  // ── Form helpers ────────────────────────────────────────────────────────────
  const resetForm = () => { setFormData({ name: "", unitCode: "", vehicle: "", catchment: "", teamSlot: 1, crewPosition: 1 }); setEditingId(null); };

  const handleOpenEdit = (officer: any) => {
    setFormData({ name: officer.name, unitCode: officer.unitCode, vehicle: officer.vehicle, catchment: officer.catchment, teamSlot: officer.teamSlot, crewPosition: officer.crewPosition });
    setEditingId(officer.id);
    setIsFormOpen(true);
  };

  const handleSave = () => {
    const data = { ...formData, teamSlot: Number(formData.teamSlot), crewPosition: Number(formData.crewPosition) };
    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRosterOfficersQueryKey() });
        bumpVersion();
        toast({ title: editingId ? "Officer updated" : "Officer created" });
        setIsFormOpen(false);
        resetForm();
      },
    };
    if (editingId) updateOfficer.mutate({ id: editingId, data }, opts);
    else createOfficer.mutate({ data }, opts);
  };

  const handleDelete = (id: string) => {
    if (confirm("Deactivate this officer? They'll be removed from future rosters and PH duty, but their leave/duty/swap history is kept. You can reactivate them later.")) {
      deleteOfficer.mutate({ id }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetRosterOfficersQueryKey() }); bumpVersion(); toast({ title: "Officer deactivated" }); },
      });
    }
  };

  const handleReactivate = (id: string) => {
    updateOfficer.mutate({ id, data: { active: true } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetRosterOfficersQueryKey() }); bumpVersion(); toast({ title: "Officer reactivated" }); },
    });
  };

  const filteredOfficers = officers?.filter((o) =>
    o.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.unitCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.catchment.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isLoading = officersLoading || configLoading;

  const addDialog = (
    <Dialog open={isFormOpen} onOpenChange={(open) => { if (!open) resetForm(); setIsFormOpen(open); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" />Add Officer</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{editingId ? "Edit Officer" : "Add Officer"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          {[
            { label: "Name", key: "name", placeholder: "" },
            { label: "Unit Code", key: "unitCode", placeholder: "e.g. BU1" },
            { label: "Vehicle Plate", key: "vehicle", placeholder: "e.g. TST0004A" },
            { label: "Catchment", key: "catchment", placeholder: "e.g. BU, PJ" },
          ].map(({ label, key, placeholder }) => (
            <div key={key} className="space-y-2">
              <Label>{label}</Label>
              <Input placeholder={placeholder} value={(formData as any)[key]} onChange={(e) => setFormData((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="space-y-2">
            <Label>Team Slot</Label>
            <Input type="number" min={1} value={formData.teamSlot} onChange={(e) => setFormData((f) => ({ ...f, teamSlot: parseInt(e.target.value) || 1 }))} />
          </div>
          <div className="space-y-2">
            <Label>Crew Position</Label>
            <Input type="number" min={1} max={2} value={formData.crewPosition} onChange={(e) => setFormData((f) => ({ ...f, crewPosition: parseInt(e.target.value) || 1 }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsFormOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createOfficer.isPending || updateOfficer.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="h-14 px-4 md:px-6 border-b flex items-center gap-3 shrink-0 bg-card">
        <h2 className="text-base md:text-lg font-semibold shrink-0">Officers</h2>

        <div className="flex items-center rounded-md border border-border overflow-hidden shrink-0">
          {(["board", "list"] as const).map((v, i) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 h-7 flex items-center gap-1 text-[11px] font-semibold transition-colors
                ${i === 0 ? "border-r border-border" : ""}
                ${view === v ? "bg-muted text-foreground" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
            >
              {v === "board" ? <><LayoutGrid className="h-3 w-3" /> Board</> : <><List className="h-3 w-3" /> List</>}
            </button>
          ))}
        </div>

        {view === "list" && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search officers…" className="pl-8 h-8 text-xs bg-background" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        )}

        <div className="ml-auto">{addDialog}</div>
      </header>

      {/* ── Board view ─────────────────────────────────────────────────────── */}
      {view === "board" && (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {isLoading || !boardData ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Drag a vehicle plate to reassign it. Dropping onto an occupied team swaps the two vehicles.
              </p>

              {/* Maintenance zone */}
              <MaintenanceZone
                vehicles={boardData.maintenanceVehicles}
                isActive={activeCol === "maintenance"}
                dragging={dragging}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />

              {/* Team grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {boardData.teams.map(({ slot, vehicle, officers: slotOfficers }) => (
                  <TeamColumn
                    key={slot}
                    slot={slot}
                    vehicle={vehicle}
                    officers={slotOfficers}
                    isActive={activeCol === String(slot)}
                    dragging={dragging}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── List view ──────────────────────────────────────────────────────── */}
      {view === "list" && (
        <div className="p-6 flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto">
            <Card className="overflow-hidden border-0 shadow-sm">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Officer Name</th>
                    <th className="px-6 py-4 font-semibold">Catchment</th>
                    <th className="px-6 py-4 font-semibold">Unit & Vehicle</th>
                    <th className="px-6 py-4 font-semibold">Team · Crew</th>
                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={5} className="p-6"><div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div></td></tr>
                  ) : filteredOfficers?.length === 0 ? (
                    <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">No officers found.</td></tr>
                  ) : filteredOfficers?.map((officer) => (
                    <tr key={officer.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${!officer.active ? "opacity-50" : ""}`}>
                      <td className="px-6 py-4 font-medium">
                        {officer.name}
                        {!officer.active && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide align-middle">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">{officer.catchment}</td>
                      <td className="px-6 py-4">
                        <div className="font-medium">{officer.unitCode}</div>
                        <div className="text-xs text-muted-foreground">{officer.vehicle || "—"}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-semibold">
                          T{officer.teamSlot} · C{officer.crewPosition}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleOpenEdit(officer)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          {officer.active ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(officer.id)} title="Deactivate">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleReactivate(officer.id)} title="Reactivate">
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
