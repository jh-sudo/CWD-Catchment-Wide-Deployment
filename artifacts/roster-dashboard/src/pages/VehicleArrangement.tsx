import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { format, addDays, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, subMonths, addMonths, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Truck, RotateCcw, GripVertical, Plus, MapPin, Zap } from "lucide-react";
import { useGetRosterOfficers } from "@workspace/api-client-react";
import { useRosterVersion } from "@/context/RosterVersionContext";
import { SG_PH_SET } from "@/lib/usePHActuals";

// ── Constants ─────────────────────────────────────────────────────────────────
// Kept in sync with vehicleArrangement.ts's HARDCODED_VEHICLE_DEFAULTS — used
// here only as the initial paint before /vehicle-arrangement/defaults loads.

const DEFAULT_PLACEMENTS: Record<string, string> = {
  TST0004A: "BU1",
  TST0009A: "BU2",
  TST0003A: "BU3",
  TST0008A: "BU5",
  TST0014A: "PJ1",
  TST0017A: "PJ2",
  TST0016A: "PJ3",
  TST0015A: "WK1",
  TST0012A: "WK2",
  TST0013A: "WK3",
  TST0002A: "CP1",
  TST0005A: "CP2",
  TST0007A: "CP3",
  TST0001A: "CP4",
  TST0011A: "KG1",
  TST0010A: "KG2",
  TST0006A: "KG3",
};

const ALL_PLATES = Object.keys(DEFAULT_PLACEMENTS);

const CATCHMENT_BG: Record<string, string> = {
  BU: "#FFFFCC",
  PJ: "#EDEDED",
  WK: "#FCE4D6",
  CP: "#E2EFDA",
  KG: "#DDEBF7",
};

const CATCHMENT_BORDER: Record<string, string> = {
  BU: "#d4d400",
  PJ: "#c0c0c0",
  WK: "#e0a080",
  CP: "#90c080",
  KG: "#80b0e0",
};

const DUTY_COLORS: Record<string, string> = {
  PD: "bg-[#FDD9BB] text-orange-900",
  DAY: "bg-[#D3E6F5] text-blue-900",
  ND: "bg-[#FDFCCC] text-yellow-900",
};

const WORKING_DUTIES = new Set(["ND", "DAY", "PD"]);

// ── Watershed / vehicle cascade — single-pass mirror of the backend's
// applyVehicleCascade (vehicleArrangement.ts). Used here only for the live
// "No vehicle!" badge preview and the Auto-assign button; the server is the
// actual source of truth for officer-map. Replit's own frontend had drifted
// onto an older two-pass version of this function that no longer matched its
// own backend — ported the current (single-pass) version instead so preview
// and save always agree. ────────────────────────────────────────────────────
const WATERSHED_WESTERN = new Set(["BU", "PJ", "WK"]);
const WATERSHED_EASTERN = new Set(["CP", "KG"]);
const getUnitPrefix = (u: string) => u.replace(/\d+$/, "");
const pairedVehicleUnit = (unit: string) => (unit === "CP3" ? "KG1" : unit === "KG1" ? "CP3" : null);

function applyVehicleCascade(
  unitDuty: Record<string, string>,
  unitPlate: Record<string, string>,
): Record<string, string> {
  const effective = { ...unitPlate };
  const claimed = new Set<string>();
  const isWorking = (duty: string | undefined) => duty === "PD" || duty === "DAY" || duty === "ND";
  const allUnits = Array.from(new Set([...Object.keys(unitDuty), ...Object.keys(effective)]));
  const find = (candidates: string[], pred: (u: string) => boolean) => candidates.find(pred) ?? null;
  const donate = (donor: string, recipient: string) => {
    effective[recipient] = effective[donor];
    delete effective[donor];
    claimed.add(donor);
  };
  const isNonWorkingDonor = (u: string) => !claimed.has(u) && !!effective[u] && !isWorking(unitDuty[u]);
  const isNDDonor = (u: string) => !claimed.has(u) && !!effective[u] && unitDuty[u] === "ND";

  const needVehicle = allUnits
    .filter((u) => (unitDuty[u] === "PD" || unitDuty[u] === "DAY") && !effective[u])
    .sort((a, b) => (unitDuty[a] === "PD" ? 0 : 1) - (unitDuty[b] === "PD" ? 0 : 1));

  for (const unit of needVehicle) {
    const px = getUnitPrefix(unit);
    const myW = WATERSHED_WESTERN.has(px) ? WATERSHED_WESTERN : WATERSHED_EASTERN;
    const xW = WATERSHED_WESTERN.has(px) ? WATERSHED_EASTERN : WATERSHED_WESTERN;
    const pairedUnit = pairedVehicleUnit(unit);
    const donor =
      (pairedUnit ? find([pairedUnit], isNonWorkingDonor) : null) ??
      (pairedUnit ? find([pairedUnit], isNDDonor) : null) ??
      find(allUnits.filter((u) => getUnitPrefix(u) === px && u !== unit), isNonWorkingDonor) ??
      find(allUnits.filter((u) => myW.has(getUnitPrefix(u)) && getUnitPrefix(u) !== px), isNonWorkingDonor) ??
      find(allUnits.filter((u) => getUnitPrefix(u) === px && u !== unit), isNDDonor) ??
      find(allUnits.filter((u) => myW.has(getUnitPrefix(u)) && getUnitPrefix(u) !== px), isNDDonor) ??
      find(allUnits.filter((u) => xW.has(getUnitPrefix(u))), isNonWorkingDonor) ??
      find(allUnits.filter((u) => xW.has(getUnitPrefix(u))), isNDDonor);
    if (donor) donate(donor, unit);
  }

  for (const ndUnit of allUnits.filter((u) => unitDuty[u] === "ND" && !effective[u])) {
    const px = getUnitPrefix(ndUnit);
    const myW = WATERSHED_WESTERN.has(px) ? WATERSHED_WESTERN : WATERSHED_EASTERN;
    const xW = WATERSHED_WESTERN.has(px) ? WATERSHED_EASTERN : WATERSHED_WESTERN;
    const pairedUnit = pairedVehicleUnit(ndUnit);
    const donor =
      (pairedUnit ? find([pairedUnit], isNonWorkingDonor) : null) ??
      find(allUnits.filter((u) => getUnitPrefix(u) === px && u !== ndUnit), isNonWorkingDonor) ??
      find(allUnits.filter((u) => myW.has(getUnitPrefix(u)) && getUnitPrefix(u) !== px), isNonWorkingDonor) ??
      find(allUnits.filter((u) => xW.has(getUnitPrefix(u))), isNonWorkingDonor);
    if (donor) donate(donor, ndUnit);
  }

  return effective;
}

type Location = string;

// ── Draggable vehicle pill ─────────────────────────────────────────────────────

function VehiclePill({
  plate,
  isDragging,
  onDragStart,
  onDragEnd,
  onTouchStart,
}: {
  plate: string;
  isDragging: boolean;
  onDragStart: (plate: string) => void;
  onDragEnd: () => void;
  onTouchStart: (e: React.TouchEvent, plate: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(plate); }}
      onDragEnd={onDragEnd}
      onTouchStart={(e) => onTouchStart(e, plate)}
      className={cn(
        "flex items-center gap-1 bg-slate-800 text-white rounded px-2 py-1 text-[11px] font-bold",
        "cursor-grab active:cursor-grabbing select-none transition-all",
        "border border-slate-600 shadow-sm hover:bg-slate-700 hover:shadow-md",
        isDragging && "opacity-30 scale-95",
      )}
    >
      <GripVertical className="h-3 w-3 opacity-50 shrink-0" />
      {plate}
    </div>
  );
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({
  location,
  label,
  bg,
  border,
  vehicles,
  officers,
  draggingPlate,
  dragOverLocation,
  onDragOver,
  onDrop,
  onDragLeave,
  onDragStart,
  onDragEnd,
  onTouchStart,
  compact,
  needsVehicle,
  defaultPlate,
}: {
  location: string;
  label: string;
  bg?: string;
  border?: string;
  vehicles: string[];
  officers: { name: string; duty: string; isCovering: boolean; isAbsent?: boolean }[];
  draggingPlate: string | null;
  dragOverLocation: string | null;
  onDragOver: (location: string) => void;
  onDrop: (location: string) => void;
  onDragLeave: () => void;
  onDragStart: (plate: string) => void;
  onDragEnd: () => void;
  onTouchStart: (e: React.TouchEvent, plate: string) => void;
  compact?: boolean;
  needsVehicle?: boolean;
  defaultPlate?: string;
}) {
  const isOver = dragOverLocation === location && draggingPlate !== null;
  const hasAbsent = officers.some((o) => o.isAbsent);
  return (
    <div
      style={{
        backgroundColor: bg ?? "transparent",
        borderColor: needsVehicle && !isOver ? "#ef4444" : isOver ? "#3b82f6" : (border ?? "#e5e7eb"),
      }}
      className={cn(
        "relative rounded-lg border-2 p-2 flex flex-col gap-1 transition-all min-h-[80px]",
        isOver && "ring-2 ring-blue-400 ring-offset-1 scale-[1.01]",
        needsVehicle && !isOver && "ring-2 ring-red-300 ring-offset-1",
        compact && "min-h-[60px]",
      )}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(location); }}
      onDrop={(e) => { e.preventDefault(); onDrop(location); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragLeave(); }}
    >
      {hasAbsent && <div className="absolute inset-0 rounded-lg bg-black/30 pointer-events-none" />}

      <div className="relative z-10 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-bold text-slate-800 uppercase tracking-wide leading-tight flex items-center gap-1">
            {label}
            {defaultPlate && (
              <span className="text-[8px] font-mono font-normal text-slate-400 normal-case tracking-normal" title={`Default vehicle: ${defaultPlate}`}>
                {defaultPlate}
              </span>
            )}
            {needsVehicle && (
              <span className="text-red-500 font-bold text-[9px] bg-red-100 border border-red-300 rounded px-1 py-0 leading-4">No vehicle!</span>
            )}
          </span>
          {(() => {
            const seen = new Set<string>();
            const workDuties: string[] = [];
            let offCnt = 0, restCnt = 0;
            for (const o of officers) {
              if (o.duty === "OFF") { offCnt++; continue; }
              if (o.duty === "REST") { restCnt++; continue; }
              if (DUTY_COLORS[o.duty] && !seen.has(o.duty)) { seen.add(o.duty); workDuties.push(o.duty); }
            }
            if (!workDuties.length && !offCnt && !restCnt) return null;
            return (
              <div className="flex items-center gap-0.5 shrink-0">
                {workDuties.map((d) => (
                  <span key={d} className={cn(
                    "text-[9px] font-bold px-1 py-0 rounded border leading-4",
                    d === "ND" && "bg-[#FDFCCC] text-yellow-900 border-yellow-300",
                    d === "DAY" && "bg-[#D3E6F5] text-blue-900 border-blue-300",
                    d === "PD" && "bg-[#FDD9BB] text-orange-900 border-orange-300",
                  )}>{d}</span>
                ))}
                {offCnt > 0 && <span className="text-[9px] font-bold px-1 py-0 rounded border leading-4 bg-[#A7FBC1] text-green-900 border-green-300">OFF</span>}
                {restCnt > 0 && <span className="text-[9px] font-bold px-1 py-0 rounded border leading-4 bg-[#F5C7F5] text-pink-900 border-pink-300">REST</span>}
              </div>
            );
          })()}
        </div>

        {officers.length > 0 && (
          <div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
            {officers.map((o, i) => (
              <span key={i} className={cn(
                "inline-flex items-center gap-0.5 text-[10px] font-semibold",
                o.isAbsent ? "text-slate-400" : o.isCovering ? "italic text-green-700" : "text-black",
              )}>
                {o.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-1 min-h-[24px]">
          {vehicles.map((plate) => (
            <VehiclePill key={plate} plate={plate} isDragging={draggingPlate === plate}
              onDragStart={onDragStart} onDragEnd={onDragEnd} onTouchStart={onTouchStart} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VehicleArrangement() {
  const { data: officers } = useGetRosterOfficers();
  const { version, bumpVersion } = useRosterVersion();

  const catchmentGroups = useMemo(() => {
    const prefixMap = new Map<string, { units: string[]; label: string }>();
    for (const o of (officers ?? []) as any[]) {
      const unit: string = o.unitCode;
      if (!unit) continue;
      const prefix = unit.replace(/\d+$/, "");
      if (!prefixMap.has(prefix)) prefixMap.set(prefix, { units: [], label: o.catchment ?? prefix });
      const entry = prefixMap.get(prefix)!;
      if (!entry.units.includes(unit)) entry.units.push(unit);
    }
    for (const entry of prefixMap.values()) {
      entry.units.sort((a, b) => (parseInt(a.match(/\d+$/)?.[0] ?? "0") - parseInt(b.match(/\d+$/)?.[0] ?? "0")));
    }
    const ORDER: Record<string, number> = { BU: 0, PJ: 1, WK: 2, CP: 3, KG: 4 };
    return Array.from(prefixMap.entries())
      .sort(([a], [b]) => (ORDER[a] ?? 99) - (ORDER[b] ?? 99) || a.localeCompare(b))
      .map(([prefix, { units, label }]) => ({ prefix, units, label }));
  }, [officers]);

  const allSubcatchments = useMemo(() => catchmentGroups.flatMap((g) => g.units), [catchmentGroups]);

  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [placements, setPlacements] = useState<Record<string, Location>>(() => ({ ...DEFAULT_PLACEMENTS } as Record<string, Location>));
  const [scheduleData, setScheduleData] = useState<any[]>([]);
  const [leaveMap, setLeaveMap] = useState<Record<string, string>>({});
  const [savePending, setSavePending] = useState(false);
  const [dutyFilter, setDutyFilter] = useState<Set<string>>(new Set());
  const [draggingPlate, setDraggingPlate] = useState<string | null>(null);
  const [dragOverLocation, setDragOverLocation] = useState<string | null>(null);

  const touchPlateRef = useRef<string | null>(null);
  const touchGhostRef = useRef<HTMLDivElement | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRaf = useRef<number | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerViewMonth, setPickerViewMonth] = useState(() => startOfMonth(new Date()));
  const pickerRef = useRef<HTMLDivElement>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newPlate, setNewPlate] = useState("");
  const [newPlateUnit, setNewPlateUnit] = useState<string>("home");
  const addRef = useRef<HTMLDivElement>(null);

  const [defOpen, setDefOpen] = useState(false);
  const [defPlate, setDefPlate] = useState("");
  const [defUnit, setDefUnit] = useState<string>("home");
  const defRef = useRef<HTMLDivElement>(null);

  const [ownershipDefaults, setOwnershipDefaults] = useState<Record<string, string>>({ ...DEFAULT_PLACEMENTS });

  const touchXRef = useRef<number | null>(null);
  const touchYRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/vehicle-arrangement/defaults", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.placements) return;
        const map: Record<string, string> = {};
        for (const p of data.placements) map[p.plate] = p.location;
        setOwnershipDefaults((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/vehicle-arrangement?date=${selectedDate}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const map: Record<string, Location> = {};
        for (const plate of ALL_PLATES) map[plate] = "home";
        for (const p of data.placements ?? []) map[p.plate] = p.location;
        setPlacements(map);
      })
      .catch(() => {});
  }, [selectedDate, version]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/roster-plan/schedule?date=${selectedDate}`).then((r) => (r.ok ? r.json() : { duties: [] })),
      fetch(`/api/roster-plan/leave?date=${selectedDate}`).then((r) => (r.ok ? r.json() : [])),
    ]).then(([sched, leaves]) => {
      setScheduleData(sched.duties ?? []);
      const lm: Record<string, string> = {};
      for (const l of Array.isArray(leaves) ? leaves : []) lm[l.officerId] = l.leaveType;
      setLeaveMap(lm);
    }).catch(() => {});
  }, [selectedDate]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  useEffect(() => {
    if (!addOpen) return;
    const h = (e: MouseEvent) => { if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [addOpen]);

  useEffect(() => {
    if (!defOpen) return;
    const h = (e: MouseEvent) => { if (defRef.current && !defRef.current.contains(e.target as Node)) setDefOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [defOpen]);

  const navigate = useCallback((dir: 1 | -1) => {
    setSelectedDate((d) => format(addDays(parseISO(d), dir), "yyyy-MM-dd"));
  }, []);

  const parsedDate = useMemo(() => parseISO(selectedDate), [selectedDate]);
  const dayOfWeek = new Date(selectedDate + "T12:00:00Z").getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isPH = SG_PH_SET.has(selectedDate);

  const { ndCount, dayCount, pdCount } = useMemo(() => {
    let nd = 0, day = 0, pd = 0;
    const subcatchSet = new Set(allSubcatchments);
    const subcatchIds = new Set((officers ?? []).filter((o: any) => subcatchSet.has(o.unitCode)).map((o: any) => o.id));
    const dutyById: Record<string, string> = {};
    for (const d of scheduleData) {
      if (d.date?.startsWith(selectedDate) && subcatchIds.has(d.officerId)) dutyById[d.officerId] = d.duty;
    }
    for (const [id, duty] of Object.entries(dutyById)) {
      if (leaveMap[id]) continue;
      if (duty === "ND") nd++;
      else if (duty === "DAY") day++;
      else if (duty === "PD") pd++;
    }
    return { ndCount: nd, dayCount: day, pdCount: pd };
  }, [officers, scheduleData, leaveMap, selectedDate, allSubcatchments]);

  const officersByUnit = useMemo(() => {
    const map: Record<string, { name: string; duty: string; isCovering: boolean; isAbsent?: boolean }[]> = {};
    const dutyById: Record<string, string> = {};
    const crossPostById: Record<string, string> = {};
    const coverForUnit: Record<string, string[]> = {};

    for (const d of scheduleData) {
      if (!d.date?.startsWith(selectedDate)) continue;
      dutyById[d.officerId] = d.duty;
      if (d.crossPostedToUnit) crossPostById[d.officerId] = d.crossPostedToUnit;
    }
    for (const d of scheduleData) {
      if (!d.date?.startsWith(selectedDate)) continue;
      if (d.crossPostedToUnit && WORKING_DUTIES.has(d.duty)) {
        const targetUnit = d.crossPostedToUnit;
        if (!coverForUnit[targetUnit]) coverForUnit[targetUnit] = [];
        const o = (officers ?? []).find((x: any) => x.id === d.officerId);
        if (o) coverForUnit[targetUnit].push(o.name);
      }
    }

    for (const unit of allSubcatchments) {
      const list: { name: string; duty: string; isCovering: boolean; isAbsent?: boolean }[] = [];
      for (const o of (officers ?? []) as any[]) {
        if (o.unitCode !== unit) continue;
        if (leaveMap[o.id]) continue;
        if (crossPostById[o.id]) continue;
        const duty = dutyById[o.id] ?? "";
        if (!duty) continue;
        const isAbsent = duty === "OFF" || duty === "REST" || duty === "PH" || duty === "OIL";
        if (!WORKING_DUTIES.has(duty) && !isAbsent) continue;
        list.push({ name: o.name, duty, isCovering: false, isAbsent });
      }
      for (const name of coverForUnit[unit] ?? []) {
        const o = (officers ?? []).find((x: any) => x.name === name) as any;
        const duty = o ? (dutyById[o.id] ?? "DAY") : "DAY";
        list.push({ name, duty, isCovering: true });
      }
      map[unit] = list;
    }
    return map;
  }, [officers, scheduleData, leaveMap, selectedDate, allSubcatchments]);

  const vehiclesByLocation = useMemo(() => {
    const map: Record<string, string[]> = { maintenance: [], home: [] };
    for (const sub of allSubcatchments) map[sub] = [];
    for (const [plate, loc] of Object.entries(placements)) {
      if (!map[loc]) map[loc] = [];
      map[loc].push(plate);
    }
    return map;
  }, [placements, allSubcatchments]);

  const allPlates = useMemo(() => Object.keys(placements), [placements]);
  const placedCount = useMemo(
    () => allPlates.filter((p) => placements[p] !== "maintenance" && placements[p] !== "home").length,
    [allPlates, placements],
  );

  const unitDutyForAssign = useMemo(() => {
    const result: Record<string, string> = {};
    const dutyById: Record<string, string> = {};
    const crossPostById: Record<string, string> = {};
    for (const d of scheduleData) {
      if (!d.date?.startsWith(selectedDate)) continue;
      dutyById[d.officerId] = d.duty;
      if (d.crossPostedToUnit) crossPostById[d.officerId] = d.crossPostedToUnit;
    }
    for (const o of (officers ?? []) as any[]) {
      if (leaveMap[o.id]) continue;
      const duty = dutyById[o.id] ?? "";
      if (!duty || !WORKING_DUTIES.has(duty)) continue;
      const targetUnit = crossPostById[o.id] ?? o.unitCode;
      if (!result[targetUnit] || result[targetUnit] === "ND") result[targetUnit] = duty;
    }
    return result;
  }, [scheduleData, officers, leaveMap, selectedDate]);

  const unitPlateMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [plate, loc] of Object.entries(placements)) {
      if (loc !== "maintenance" && loc !== "home") m[loc] = plate;
    }
    return m;
  }, [placements]);

  const uncoveredPdDayUnits = useMemo(() => {
    const cascaded = applyVehicleCascade(unitDutyForAssign, unitPlateMap);
    return new Set(
      Object.keys(unitDutyForAssign).filter(
        (u) => (unitDutyForAssign[u] === "PD" || unitDutyForAssign[u] === "DAY") && !cascaded[u],
      ),
    );
  }, [unitDutyForAssign, unitPlateMap]);

  const saveArrangement = useCallback((newPlacements: Record<string, Location>) => {
    const payload = Object.entries(newPlacements).map(([plate, location]) => ({ plate, location }));
    setSavePending(true);
    fetch("/api/vehicle-arrangement", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: selectedDate, placements: payload }),
    }).then(() => bumpVersion()).finally(() => setSavePending(false));
  }, [selectedDate, bumpVersion]);

  const autoAssign = useCallback(() => {
    const cascaded = applyVehicleCascade(unitDutyForAssign, unitPlateMap);
    const next: Record<string, Location> = {};
    for (const [plate, loc] of Object.entries(placements)) {
      if (loc === "maintenance" || loc === "home") { next[plate] = loc as Location; continue; }
      const newUnit = (Object.entries(cascaded) as [string, string][]).find(([, p]) => p === plate)?.[0];
      next[plate] = (newUnit ?? "home") as Location;
    }
    setPlacements(next);
    saveArrangement(next);
  }, [unitDutyForAssign, unitPlateMap, placements, saveArrangement]);

  const defaultPlateByUnit = useMemo(() => {
    const inv: Record<string, string> = {};
    for (const [plate, unit] of Object.entries(ownershipDefaults)) {
      if (unit && unit !== "home" && unit !== "maintenance") inv[unit] = plate;
    }
    return inv;
  }, [ownershipDefaults]);

  const submitAddVehicle = useCallback(() => {
    const plate = newPlate.trim().toUpperCase();
    if (!plate) return;
    const next = { ...placements, [plate]: newPlateUnit as Location };
    setPlacements(next);
    saveArrangement(next);
    setNewPlate("");
    setNewPlateUnit("home");
    setAddOpen(false);
  }, [newPlate, newPlateUnit, placements, saveArrangement]);

  const submitDefaultUnit = useCallback(() => {
    if (!defPlate) return;
    fetch("/api/vehicle-arrangement/defaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ plate: defPlate, location: defUnit }),
    }).catch(() => {});
    setOwnershipDefaults((prev) => ({ ...prev, [defPlate]: defUnit }));
    const next = { ...placements, [defPlate]: defUnit as Location };
    setPlacements(next);
    saveArrangement(next);
    setDefOpen(false);
  }, [defPlate, defUnit, placements, saveArrangement]);

  const handleDragStart = useCallback((plate: string) => setDraggingPlate(plate), []);
  const handleDragEnd = useCallback(() => { setDraggingPlate(null); setDragOverLocation(null); }, []);
  const handleDragOver = useCallback((loc: string) => setDragOverLocation(loc), []);
  const handleDragLeave = useCallback(() => setDragOverLocation(null), []);

  const handleDrop = useCallback((loc: string) => {
    if (!draggingPlate) return;
    setDragOverLocation(null);
    setDraggingPlate(null);
    setPlacements((prev) => {
      const next = { ...prev, [draggingPlate]: loc as Location };
      saveArrangement(next);
      return next;
    });
  }, [draggingPlate, saveArrangement]);

  const handleTouchStart = useCallback((e: React.TouchEvent, plate: string) => {
    touchPlateRef.current = plate;
    setDraggingPlate(plate);
    const ghost = document.createElement("div");
    ghost.textContent = plate;
    ghost.style.cssText = "position:fixed;top:-100px;left:-100px;background:#1e293b;color:white;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:bold;pointer-events:none;z-index:9999;";
    document.body.appendChild(ghost);
    touchGhostRef.current = ghost;
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRaf.current !== null) { cancelAnimationFrame(autoScrollRaf.current); autoScrollRaf.current = null; }
  }, []);

  const startAutoScroll = useCallback((speed: number) => {
    stopAutoScroll();
    const tick = () => {
      const el = scrollBodyRef.current;
      if (!el || !touchPlateRef.current) { stopAutoScroll(); return; }
      el.scrollTop += speed;
      autoScrollRaf.current = requestAnimationFrame(tick);
    };
    autoScrollRaf.current = requestAnimationFrame(tick);
  }, [stopAutoScroll]);

  useEffect(() => {
    const EDGE_ZONE = 40;
    const MAX_SPEED = 5;

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchPlateRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      if (touchGhostRef.current) {
        touchGhostRef.current.style.left = `${t.clientX + 10}px`;
        touchGhostRef.current.style.top = `${t.clientY - 20}px`;
      }
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const zone = el?.closest("[data-dropzone]");
      setDragOverLocation(zone?.getAttribute("data-dropzone") ?? null);

      const container = scrollBodyRef.current;
      if (container) {
        const { top, bottom } = container.getBoundingClientRect();
        const distFromBottom = bottom - t.clientY;
        const distFromTop = t.clientY - top;
        if (distFromBottom < EDGE_ZONE && distFromBottom > 0) {
          startAutoScroll(Math.round(MAX_SPEED * (1 - distFromBottom / EDGE_ZONE)));
        } else if (distFromTop < EDGE_ZONE && distFromTop > 0) {
          startAutoScroll(-Math.round(MAX_SPEED * (1 - distFromTop / EDGE_ZONE)));
        } else {
          stopAutoScroll();
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchPlateRef.current) return;
      stopAutoScroll();
      const plate = touchPlateRef.current;
      touchPlateRef.current = null;
      if (touchGhostRef.current) { document.body.removeChild(touchGhostRef.current); touchGhostRef.current = null; }
      const t = e.changedTouches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const zone = el?.closest("[data-dropzone]");
      const loc = zone?.getAttribute("data-dropzone") ?? null;
      setDraggingPlate(null);
      setDragOverLocation(null);
      if (loc) {
        setPlacements((prev) => {
          const next = { ...prev, [plate]: loc as Location };
          saveArrangement(next);
          return next;
        });
      }
    };

    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      stopAutoScroll();
    };
  }, [saveArrangement, startAutoScroll, stopAutoScroll]);

  const resetToDefaults = useCallback(() => {
    const next: Record<string, Location> = {};
    for (const plate of allPlates) next[plate] = (ownershipDefaults[plate] ?? "home") as Location;
    setPlacements(next);
    saveArrangement(next);
  }, [allPlates, ownershipDefaults, saveArrangement]);

  const openPicker = () => { setPickerViewMonth(startOfMonth(parsedDate)); setPickerOpen(true); };
  const calendarDays = useMemo(() => {
    const start = startOfMonth(pickerViewMonth);
    const end = endOfMonth(pickerViewMonth);
    const days = eachDayOfInterval({ start, end });
    return { days, leadingBlanks: start.getDay() };
  }, [pickerViewMonth]);
  const today = useMemo(() => new Date(), []);

  const dzProps = {
    draggingPlate,
    dragOverLocation,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragLeave: handleDragLeave,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onTouchStart: handleTouchStart,
  };

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ touchAction: "pan-y" }}
      onTouchStart={(e) => { touchXRef.current = e.touches[0].clientX; touchYRef.current = e.touches[0].clientY; }}
      onTouchEnd={(e) => {
        if (touchXRef.current === null || touchPlateRef.current) return;
        const dx = e.changedTouches[0].clientX - touchXRef.current;
        const dy = e.changedTouches[0].clientY - (touchYRef.current ?? 0);
        touchXRef.current = null;
        touchYRef.current = null;
        if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2) return;
        navigate(dx > 0 ? -1 : 1);
      }}
    >
      <header className="shrink-0 border-b bg-card px-4 py-2 space-y-2">
        <div className="flex items-center gap-2 h-10">
          <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
          <h2 className="text-base font-semibold shrink-0 hidden sm:block">Vehicle Arrangement</h2>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="relative" ref={pickerRef}>
              <button type="button" onClick={openPicker}
                className="text-sm font-semibold px-2 py-1 rounded-md hover:bg-muted transition-colors whitespace-nowrap">
                {format(parsedDate, "EEE, d MMM yyyy")}
              </button>
              {pickerOpen && (
                <div className="absolute top-full mt-1 right-0 z-50 bg-card border border-border rounded-xl shadow-lg p-3 w-64">
                  <div className="flex items-center justify-between mb-2">
                    <button type="button" onClick={() => setPickerViewMonth((m) => subMonths(m, 1))}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-bold">{format(pickerViewMonth, "MMM yyyy")}</span>
                    <button type="button" onClick={() => setPickerViewMonth((m) => addMonths(m, 1))}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 mb-1">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-0.5">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-y-0.5">
                    {Array.from({ length: calendarDays.leadingBlanks }).map((_, i) => <div key={`blank-${i}`} />)}
                    {calendarDays.days.map((day) => {
                      const ds = format(day, "yyyy-MM-dd");
                      const isSelected = ds === selectedDate;
                      const isToday = isSameDay(day, today);
                      const isPHDay = SG_PH_SET.has(ds);
                      const isWeekendDay = day.getDay() === 0 || day.getDay() === 6;
                      return (
                        <button key={ds} type="button" onClick={() => { setSelectedDate(ds); setPickerOpen(false); }}
                          className={cn(
                            "text-xs h-7 w-full rounded-md transition-colors font-medium",
                            isSelected ? "bg-primary text-primary-foreground"
                              : isToday ? "border border-primary text-primary hover:bg-primary/10"
                              : isPHDay ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              : isWeekendDay ? "text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                              : "text-foreground hover:bg-muted",
                          )}>
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn(
            "text-[11px] font-bold px-2 py-0.5 rounded border",
            isPH ? "bg-red-100 text-red-700 border-red-300" : isWeekend ? "bg-purple-100 text-purple-700 border-purple-300" : "bg-blue-100 text-blue-700 border-blue-300",
          )}>
            {isPH ? "Public Holiday" : isWeekend ? "Weekend" : "Weekday"}
          </span>

          {(["ND", "DAY", "PD"] as const).map((d) => {
            const count = d === "ND" ? ndCount : d === "DAY" ? dayCount : pdCount;
            const totalWorking = ndCount + dayCount + pdCount;
            const isActive = dutyFilter.has(d);
            const isFiltering = dutyFilter.size > 0;
            const baseCls = d === "ND" ? "bg-[#FDFCCC] text-yellow-900 border-yellow-200"
              : d === "DAY" ? "bg-[#D3E6F5] text-blue-900 border-blue-200"
              : "bg-[#FDD9BB] text-orange-900 border-orange-200";
            return (
              <button key={d} type="button"
                onClick={() => setDutyFilter((prev) => { const next = new Set(prev); next.has(d) ? next.delete(d) : next.add(d); return next; })}
                title={isActive ? `Remove ${d} filter` : `Show only ${d}`}
                className={cn("text-[11px] px-1.5 py-0.5 rounded border transition-all cursor-pointer", baseCls,
                  isFiltering && !isActive && "opacity-30", isActive && "ring-2 ring-offset-1 ring-gray-500 font-bold")}>
                {d} {count}/{totalWorking}
              </button>
            );
          })}

          <div className="ml-auto flex items-center flex-wrap gap-1 sm:gap-2">
            {savePending && <span className="text-[10px] text-muted-foreground italic hidden sm:inline">Saving…</span>}

            <div className="relative" ref={addRef}>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2" title="Add Vehicle"
                onClick={() => { setAddOpen((v) => !v); setDefOpen(false); }}>
                <Plus className="h-3 w-3" />
                <span className="hidden sm:inline">Add Vehicle</span>
              </Button>
              {addOpen && (
                <div className="absolute top-full mt-1 right-0 z-50 bg-card border border-border rounded-xl shadow-lg p-3 w-56 space-y-2">
                  <p className="text-[11px] font-semibold text-foreground">Add New Vehicle</p>
                  <input type="text" value={newPlate} onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && submitAddVehicle()} placeholder="Plate number…"
                    className="w-full text-[11px] h-7 border rounded px-2 bg-background outline-none focus:ring-1 focus:ring-primary" autoFocus />
                  <select value={newPlateUnit} onChange={(e) => setNewPlateUnit(e.target.value)}
                    className="w-full text-[11px] h-7 border rounded px-1.5 bg-background outline-none focus:ring-1 focus:ring-primary">
                    <option value="home">Home / Base</option>
                    <option value="maintenance">Under Maintenance</option>
                    {catchmentGroups.map(({ prefix, units, label }) => (
                      <optgroup key={prefix} label={label}>
                        {units.map((s) => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <Button size="sm" className="w-full h-7 text-[11px]" onClick={submitAddVehicle} disabled={!newPlate.trim()}>Add</Button>
                </div>
              )}
            </div>

            <div className="relative" ref={defRef}>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2" title="Edit Vehicle Ownership"
                onClick={() => {
                  setDefPlate(allPlates[0] ?? "");
                  setDefUnit(allPlates[0] ? (ownershipDefaults[allPlates[0]] ?? "home") : "home");
                  setDefOpen((v) => !v);
                  setAddOpen(false);
                }}>
                <MapPin className="h-3 w-3" />
                <span className="hidden sm:inline">Edit Ownership</span>
              </Button>
              {defOpen && (
                <div className="absolute top-full mt-1 right-0 z-50 bg-card border border-border rounded-xl shadow-lg p-3 w-60 space-y-2">
                  <p className="text-[11px] font-semibold text-foreground">Edit Vehicle Ownership Unit</p>
                  <p className="text-[10px] text-muted-foreground">Sets the permanent home unit for this vehicle. "Reset to Default Unit" will return it here.</p>
                  <select value={defPlate} onChange={(e) => { setDefPlate(e.target.value); setDefUnit(ownershipDefaults[e.target.value] ?? "home"); }}
                    className="w-full text-[11px] h-7 border rounded px-1.5 bg-background outline-none focus:ring-1 focus:ring-primary">
                    {allPlates.map((p) => <option key={p} value={p}>{p} → {ownershipDefaults[p] ?? "home"}</option>)}
                  </select>
                  <select value={defUnit} onChange={(e) => setDefUnit(e.target.value)}
                    className="w-full text-[11px] h-7 border rounded px-1.5 bg-background outline-none focus:ring-1 focus:ring-primary">
                    <option value="home">Home / Base</option>
                    <option value="maintenance">Under Maintenance</option>
                    {catchmentGroups.map(({ prefix, units, label }) => (
                      <optgroup key={prefix} label={label}>
                        {units.map((s) => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <Button size="sm" className="w-full h-7 text-[11px]" onClick={submitDefaultUnit} disabled={!defPlate}>Save Ownership</Button>
                </div>
              )}
            </div>

            <span className={cn(
              "text-[11px] font-bold px-1.5 py-0.5 rounded border shrink-0",
              placedCount === allPlates.length ? "bg-green-100 text-green-700 border-green-300" : "bg-amber-100 text-amber-700 border-amber-300",
            )}>
              {placedCount}/{allPlates.length}
            </span>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2" onClick={resetToDefaults}
              title="Reset all vehicles to their ownership units">
              <RotateCcw className="h-3 w-3" />
              <span className="hidden sm:inline">Reset</span>
            </Button>

            <Button variant="outline" size="sm"
              className={cn("h-7 text-[11px] gap-1 px-2", uncoveredPdDayUnits.size > 0 && "border-red-400 text-red-700 hover:bg-red-50")}
              onClick={autoAssign} title="Move ND vehicles to PD/DAY units that currently have none">
              <Zap className="h-3 w-3" />
              <span className="hidden sm:inline">Auto-assign</span>
              {uncoveredPdDayUnits.size > 0 && (
                <span className="ml-0.5 bg-red-500 text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center font-bold">
                  {uncoveredPdDayUnits.size}
                </span>
              )}
            </Button>
          </div>
        </div>
      </header>

      <div ref={scrollBodyRef} className="flex-1 overflow-auto p-3 space-y-3">
        <div data-dropzone="maintenance">
          <DropZone {...dzProps} location="maintenance" label="🔧 Under Maintenance" bg="#fff1f2" border="#fca5a5"
            vehicles={vehiclesByLocation["maintenance"] ?? []} officers={[]} />
        </div>

        <div data-dropzone="home">
          <DropZone {...dzProps} location="home" label="🏠 Home / Base" bg="#f0fdf4" border="#86efac"
            vehicles={vehiclesByLocation["home"] ?? []} officers={[]} />
        </div>

        {catchmentGroups.map(({ prefix, units, label }) => {
          const bg = CATCHMENT_BG[prefix] ?? "#f5f5f5";
          const border = CATCHMENT_BORDER[prefix] ?? "#cccccc";
          return (
            <div key={prefix}>
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">{label}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {units.map((sub) => {
                  const filtered = (officersByUnit[sub] ?? []).filter((o) => !dutyFilter.size || dutyFilter.has(o.duty));
                  if (dutyFilter.size && filtered.length === 0) return null;
                  return (
                    <div key={sub} data-dropzone={sub}>
                      <DropZone {...dzProps} location={sub} label={sub} bg={bg} border={border}
                        vehicles={vehiclesByLocation[sub] ?? []} officers={filtered}
                        needsVehicle={uncoveredPdDayUnits.has(sub)} defaultPlate={defaultPlateByUnit[sub]} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
