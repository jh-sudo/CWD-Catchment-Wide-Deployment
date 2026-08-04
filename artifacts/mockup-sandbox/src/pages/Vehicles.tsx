import { useState, useRef } from "react";
import { Truck, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Badge } from "../components/ui/badge";

const VEHICLE_NUMBERS = [
  "TST0001A","TST0002A","TST0003A","TST0004A","TST0005A","TST0006A",
  "TST0007A","TST0008A","TST0009A","TST0010A","TST0011A","GBL725E",
  "TST0012A","TST0013A","TST0014A","TST0015A","TST0016A","TST0017A",
];

type Status = "available" | "deployed" | "maintenance";
type SortKey = "plate" | "status" | "mileage" | "lastServiced";
type SortDir = "asc" | "desc";

interface VehicleEntry {
  plate: string;
  status: Status;
  mileage: string;
  lastServiced: string;
  remarks: string;
}

function isDueForService(lastServiced: string): boolean {
  if (!lastServiced) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  return new Date(lastServiced) < cutoff;
}

const STATUS_COLORS: Record<Status, string> = {
  available:   "bg-green-100 text-green-700",
  deployed:    "bg-blue-100 text-blue-700",
  maintenance: "bg-amber-100 text-amber-700",
};

const STATUS_LABELS: Record<Status, string> = {
  available:   "Available",
  deployed:    "Deployed",
  maintenance: "Maintenance",
};

type EditForm = { status: Status; mileage: string; lastServiced: string; remarks: string };

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="w-3 h-3 text-slate-400" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 text-blue-500" />
    : <ChevronDown className="w-3 h-3 text-blue-500" />;
}

export default function Vehicles() {
  const [vehicles, setVehicles] = useState<VehicleEntry[]>(
    VEHICLE_NUMBERS.map(plate => ({ plate, status: "available", mileage: "", lastServiced: "", remarks: "" }))
  );
  const [editingPlate, setEditingPlate] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ status: "available", mileage: "", lastServiced: "", remarks: "" });
  const [inlineEdit, setInlineEdit] = useState<{ plate: string; field: "mileage" | "lastServiced" } | null>(null);
  const [inlineVal, setInlineVal] = useState("");
  const inlineRef = useRef<HTMLInputElement>(null);

  const [sortKey, setSortKey] = useState<SortKey>("plate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const counts: Record<Status, number> = { available: 0, deployed: 0, maintenance: 0 };
  for (const v of vehicles) counts[v.status]++;
  const dueCount = vehicles.filter(v => isDueForService(v.lastServiced)).length;

  const startEdit = (v: VehicleEntry) => {
    setInlineEdit(null);
    setEditingPlate(v.plate);
    setEditForm({ status: v.status, mileage: v.mileage, lastServiced: v.lastServiced, remarks: v.remarks });
  };

  const saveEdit = () => {
    setVehicles(prev => prev.map(v => v.plate === editingPlate ? { ...v, ...editForm } : v));
    setEditingPlate(null);
  };

  const openInline = (plate: string, field: "mileage" | "lastServiced", current: string) => {
    if (editingPlate) return;
    setInlineEdit({ plate, field });
    setInlineVal(current);
    setTimeout(() => inlineRef.current?.focus(), 30);
  };

  const saveInline = () => {
    if (!inlineEdit) return;
    setVehicles(prev => prev.map(v =>
      v.plate === inlineEdit.plate ? { ...v, [inlineEdit.field]: inlineVal } : v
    ));
    setInlineEdit(null);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = [...vehicles].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "plate")        cmp = a.plate.localeCompare(b.plate);
    else if (sortKey === "status")  cmp = a.status.localeCompare(b.status);
    else if (sortKey === "mileage") cmp = (Number(a.mileage) || 0) - (Number(b.mileage) || 0);
    else if (sortKey === "lastServiced") {
      const da = a.lastServiced ? new Date(a.lastServiced).getTime() : 0;
      const db = b.lastServiced ? new Date(b.lastServiced).getTime() : 0;
      cmp = da - db;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const thClass = "px-3 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider select-none whitespace-nowrap";
  const thBtn = "flex items-center gap-1 hover:text-slate-800 transition-colors cursor-pointer";

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Vehicles</h1>
        <p className="text-sm text-slate-500 mt-0.5">{vehicles.length} vehicles registered</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["available","deployed","maintenance"] as Status[]).map(s => (
          <div key={s} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-slate-800">{counts[s]}</p>
            <p className="text-xs text-slate-500 mt-0.5">{STATUS_LABELS[s]}</p>
          </div>
        ))}
        <div className={`rounded-xl border shadow-sm p-4 text-center ${dueCount > 0 ? "bg-amber-50 border-amber-200" : "bg-white border-slate-100"}`}>
          <p className={`text-2xl font-bold ${dueCount > 0 ? "text-amber-700" : "text-slate-800"}`}>{dueCount}</p>
          <p className={`text-xs mt-0.5 ${dueCount > 0 ? "text-amber-600" : "text-slate-500"}`}>Due for Service</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className={thClass}>#</th>
                <th className={thClass}>
                  <button className={thBtn} onClick={() => handleSort("plate")}>
                    Vehicle No. <SortIcon col="plate" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className={thClass}>
                  <button className={thBtn} onClick={() => handleSort("status")}>
                    Status <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className={thClass}>
                  <button className={thBtn} onClick={() => handleSort("mileage")}>
                    Mileage (km) <SortIcon col="mileage" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className={thClass}>
                  <button className={thBtn} onClick={() => handleSort("lastServiced")}>
                    Last Serviced <SortIcon col="lastServiced" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className={`${thClass} hidden lg:table-cell`}>Remarks</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sorted.map((v, i) => {
                const isEditing = editingPlate === v.plate;
                const due = !isEditing && isDueForService(v.lastServiced);
                const inlineMileage = inlineEdit?.plate === v.plate && inlineEdit.field === "mileage";
                const inlineDate   = inlineEdit?.plate === v.plate && inlineEdit.field === "lastServiced";

                return (
                  <tr key={v.plate} className={due ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-slate-50"}>
                    <td className="px-3 py-3 text-slate-400 text-xs">{i + 1}</td>

                    {/* Vehicle No. */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Truck className="w-3.5 h-3.5 text-slate-500" />
                        </div>
                        <span className="font-mono font-semibold text-slate-800 whitespace-nowrap">{v.plate}</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3">
                      {isEditing ? (
                        <select
                          value={editForm.status}
                          onChange={e => setEditForm(f => ({ ...f, status: e.target.value as Status }))}
                          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white"
                        >
                          <option value="available">Available</option>
                          <option value="deployed">Deployed</option>
                          <option value="maintenance">Maintenance</option>
                        </select>
                      ) : (
                        <Badge className={STATUS_COLORS[v.status]}>{STATUS_LABELS[v.status]}</Badge>
                      )}
                    </td>

                    {/* Mileage — always visible, tap to edit inline */}
                    <td className="px-3 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          value={editForm.mileage}
                          onChange={e => setEditForm(f => ({ ...f, mileage: e.target.value }))}
                          placeholder="e.g. 45000"
                          className="text-xs border border-slate-200 rounded-md px-2 py-1 w-24 bg-white"
                        />
                      ) : inlineMileage ? (
                        <input
                          ref={inlineRef}
                          type="number"
                          min="0"
                          value={inlineVal}
                          onChange={e => setInlineVal(e.target.value)}
                          onBlur={saveInline}
                          onKeyDown={e => { if (e.key === "Enter") saveInline(); if (e.key === "Escape") setInlineEdit(null); }}
                          className="text-xs border border-blue-400 rounded-md px-2 py-1 w-24 bg-white outline-none ring-1 ring-blue-300"
                        />
                      ) : (
                        <button
                          onClick={() => openInline(v.plate, "mileage", v.mileage)}
                          className="text-left w-full min-w-[72px] text-xs px-2 py-1 rounded-md border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors tabular-nums"
                        >
                          {v.mileage
                            ? <span className="text-slate-700">{Number(v.mileage).toLocaleString()}</span>
                            : <span className="text-slate-300 italic">Tap to enter</span>}
                        </button>
                      )}
                    </td>

                    {/* Last Serviced — always visible, tap to edit inline */}
                    <td className="px-3 py-3">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editForm.lastServiced}
                          onChange={e => setEditForm(f => ({ ...f, lastServiced: e.target.value }))}
                          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white"
                        />
                      ) : inlineDate ? (
                        <input
                          ref={inlineRef}
                          type="date"
                          value={inlineVal}
                          onChange={e => setInlineVal(e.target.value)}
                          onBlur={saveInline}
                          onKeyDown={e => { if (e.key === "Enter") saveInline(); if (e.key === "Escape") setInlineEdit(null); }}
                          className="text-xs border border-blue-400 rounded-md px-2 py-1 bg-white outline-none ring-1 ring-blue-300"
                        />
                      ) : (
                        <button
                          onClick={() => openInline(v.plate, "lastServiced", v.lastServiced)}
                          className="text-left w-full min-w-[100px] text-xs px-2 py-1 rounded-md border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors"
                        >
                          {v.lastServiced ? (
                            <span className="flex items-center gap-1.5 text-slate-700 whitespace-nowrap">
                              {new Date(v.lastServiced).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" })}
                              {due && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 font-semibold">Due</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-300 italic">Tap to enter</span>
                          )}
                        </button>
                      )}
                    </td>

                    {/* Remarks — desktop only, edit mode only */}
                    <td className="px-3 py-3 hidden lg:table-cell">
                      {isEditing ? (
                        <input
                          value={editForm.remarks}
                          onChange={e => setEditForm(f => ({ ...f, remarks: e.target.value }))}
                          placeholder="Add remarks…"
                          className="text-xs border border-slate-200 rounded-md px-2 py-1 w-full bg-white"
                        />
                      ) : (
                        <span className="text-slate-400 text-xs">{v.remarks || "—"}</span>
                      )}
                    </td>

                    {/* Edit / Save / Cancel */}
                    <td className="px-3 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={saveEdit}
                            className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap">
                            Save
                          </button>
                          <button onClick={() => setEditingPlate(null)}
                            className="text-xs px-2.5 py-1 border border-slate-200 rounded-md hover:bg-slate-50">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(v)}
                          className="text-xs px-2.5 py-1 border border-slate-200 rounded-md text-slate-500 hover:bg-slate-50 whitespace-nowrap">
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
