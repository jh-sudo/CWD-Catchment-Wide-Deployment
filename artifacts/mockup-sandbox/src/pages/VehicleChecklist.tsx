import { useState, useRef } from "react";
import { ClipboardCheck, ChevronDown, ChevronUp, RotateCcw, AlertTriangle, Wrench, CheckCircle2, X, History, Download } from "lucide-react";
import { useStore } from "../store";

const VEHICLES = [
  "TST0001A","TST0002A","TST0003A","TST0004A","TST0005A","TST0006A",
  "TST0007A","TST0008A","TST0009A","TST0010A","TST0011A","GBL725E",
  "TST0012A","TST0013A","TST0014A","TST0015A","TST0016A","TST0017A",
];

interface ChecklistItem {
  no: number;
  item: string;
  unit: string;
  qty: number;
  location: string;
}

interface Category {
  name: string;
  items: ChecklistItem[];
}

const EXPIRY_ITEM_NOS = new Set([22, 23, 24]);
const PROBE_ITEM_NO = 15;

const CATEGORIES: Category[] = [
  {
    name: "Flood Protection Equipment",
    items: [
      { no: 1,  item: "Floodsax",                    unit: "No",   qty: 100, location: "L1" },
      { no: 2,  item: "Portable Flood Barrier",       unit: "No",   qty: 10,  location: "L2" },
      { no: 3,  item: "Absorbant Boom",               unit: "No",   qty: 2,   location: "L1" },
      { no: 4,  item: "Absorbant Pad",                unit: "No",   qty: 100, location: "L1" },
    ],
  },
  {
    name: "Safety Equipment",
    items: [
      { no: 5,  item: "Safety Cones",                 unit: "No",   qty: 8,   location: "L2" },
      { no: 6,  item: "Barricade Pole",               unit: "No",   qty: 8,   location: "R2" },
      { no: 7,  item: "Cone Blinker Light",           unit: "No",   qty: 8,   location: "R2" },
      { no: 8,  item: "Gas Meter",                    unit: "No",   qty: 1,   location: "VC" },
      { no: 9,  item: "Vehicle Breakdown Sign",       unit: "No",   qty: 1,   location: "VC" },
      { no: 10, item: "Vehicle Tool Kit",             unit: "Set",  qty: 1,   location: "VC" },
    ],
  },
  {
    name: "Water Sampling Equipment",
    items: [
      { no: 11, item: "Trolley",                      unit: "No",   qty: 1,   location: "R2" },
      { no: 12, item: "4 Gallon Pail",                unit: "No",   qty: 1,   location: "R2" },
      { no: 13, item: "10M Rope",                     unit: "No",   qty: 1,   location: "L1" },
      { no: 14, item: "Water Sample 1 Litre Bottle Glass", unit: "No", qty: 1, location: "R2" },
      { no: 15, item: "Probe",                        unit: "No",   qty: 1,   location: "VC" },
      { no: 16, item: "Cooler Box",                   unit: "No",   qty: 1,   location: "R2" },
      { no: 17, item: "10 Liter Jerry Can",           unit: "No",   qty: 2,   location: "R2" },
      { no: 18, item: "Hand Pump",                    unit: "No",   qty: 1,   location: "R2" },
      { no: 19, item: "Life Buoy",                    unit: "No",   qty: 1,   location: "R2" },
      { no: 20, item: "Fish net",                     unit: "No",   qty: 1,   location: "L1" },
      { no: 21, item: "Ziplock Bag",                  unit: "Box",  qty: 1,   location: "R2" },
    ],
  },
  {
    name: "Expiry Equipment",
    items: [
      { no: 22, item: "Fire Extinguisher 10KG",       unit: "No",   qty: 1,   location: "R2" },
      { no: 23, item: "First Aid Box",                unit: "No",   qty: 1,   location: "VC" },
      { no: 24, item: "Ammonia Kit",                  unit: "No",   qty: 1,   location: "R2" },
    ],
  },
  {
    name: "Miscellaneous Equipment",
    items: [
      { no: 25, item: "Toyogo Box",                   unit: "Box",  qty: 1,   location: "R2" },
      { no: 26, item: "Broom",                        unit: "No",   qty: 1,   location: "R2" },
      { no: 27, item: "Squeegee",                     unit: "No",   qty: 1,   location: "R2" },
      { no: 28, item: "Spade",                        unit: "No",   qty: 1,   location: "R2" },
      { no: 29, item: "Crowbar",                      unit: "No",   qty: 1,   location: "R2" },
      { no: 30, item: "Drain Hook",                   unit: "No",   qty: 2,   location: "VC" },
      { no: 31, item: "Heavy Duty Drain Hook",        unit: "No",   qty: 2,   location: "R2" },
      { no: 32, item: "Walkie Talkie",                unit: "No",   qty: 2,   location: "R2" },
      { no: 33, item: "Bodyworn Camera",              unit: "No",   qty: 2,   location: "VC" },
      { no: 34, item: "Toolbox/Tool Bag",             unit: "No",   qty: 1,   location: "R1" },
      { no: 35, item: "Hammer",                       unit: "No",   qty: 1,   location: "R1" },
      { no: 36, item: "Adjustable Spanner Big",       unit: "No",   qty: 1,   location: "R1" },
      { no: 37, item: "Adjustable Spanner Small",     unit: "No",   qty: 1,   location: "R1" },
      { no: 38, item: "Plier",                        unit: "No",   qty: 1,   location: "R1" },
      { no: 39, item: "Wire Cutter",                  unit: "No",   qty: 1,   location: "R1" },
      { no: 40, item: "Flat Head Screwdriver",        unit: "No",   qty: 1,   location: "R1" },
      { no: 41, item: "Phillip Screwdriver",          unit: "No",   qty: 1,   location: "R1" },
      { no: 42, item: "WD-40",                        unit: "No",   qty: 1,   location: "R1" },
    ],
  },
  {
    name: "Expendable Equipment",
    items: [
      { no: 43, item: "Label Sticker",                unit: "No",   qty: 100, location: "R2" },
      { no: 44, item: "Masking Tape",                 unit: "No",   qty: 2,   location: "R2" },
      { no: 45, item: "Red & White Tape",             unit: "Roll", qty: 2,   location: "R2" },
      { no: 46, item: "Long Rubber Glove",            unit: "Pair", qty: 5,   location: "R2" },
      { no: 47, item: "Latex Glove",                  unit: "Box",  qty: 1,   location: "R2" },
    ],
  },
  {
    name: "Files",
    items: [
      { no: 48, item: "SOP File",                     unit: "No",   qty: 1,   location: "VC" },
      { no: 49, item: "Road Closure File",            unit: "No",   qty: 1,   location: "VC" },
    ],
  },
];

const ALL_ITEM_NOS = CATEGORIES.flatMap(c => c.items.map(i => i.no));
const TOTAL = ALL_ITEM_NOS.length;

type CheckState = Record<number, boolean>;
type VehicleChecks = Record<string, CheckState>;
// expiryDates[plate][itemNo] = "YYYY-MM-DD"
type ExpiryDates = Record<string, Record<number, string>>;
// serviceDates[plate][itemNo] = "YYYY-MM-DD"
type ServiceDates = Record<string, Record<number, string>>;

interface SubmissionEntry {
  plate: string;
  submittedBy: string;
  submittedAt: string; // ISO datetime
  hasAlerts: boolean;
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function expiryStatus(dateStr: string): "expired" | "warning" | "ok" | "none" {
  if (!dateStr) return "none";
  const exp = new Date(dateStr).getTime();
  const now = Date.now();
  if (exp < now) return "expired";
  if (exp - now <= TWO_WEEKS_MS) return "warning";
  return "ok";
}

function fmtDate(dateStr: string) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return dateStr; }
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function initChecks(): VehicleChecks {
  const out: VehicleChecks = {};
  for (const plate of VEHICLES) {
    out[plate] = {};
    for (const no of ALL_ITEM_NOS) out[plate][no] = false;
  }
  return out;
}

const LOCATION_COLORS: Record<string, string> = {
  L1: "bg-blue-100 text-blue-700",
  L2: "bg-indigo-100 text-indigo-700",
  R1: "bg-purple-100 text-purple-700",
  R2: "bg-violet-100 text-violet-700",
  VC: "bg-slate-100 text-slate-700",
};

const EXPIRY_ITEMS = CATEGORIES.find(c => c.name === "Expiry Equipment")!.items;

export default function VehicleChecklist() {
  const [selectedPlate, setSelectedPlate] = useState<string>(VEHICLES[0]);
  const [checks, setChecks] = useState<VehicleChecks>(initChecks);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expiryDates, setExpiryDates] = useState<ExpiryDates>({});
  const [inlineExpiry, setInlineExpiry] = useState<{ plate: string; no: number } | null>(null);
  const [inlineVal, setInlineVal] = useState("");
  const inlineRef = useRef<HTMLInputElement>(null);
  const [serviceDates, setServiceDates] = useState<ServiceDates>({});
  const [inlineService, setInlineService] = useState<{ plate: string; no: number } | null>(null);
  const [inlineServiceVal, setInlineServiceVal] = useState("");
  const inlineServiceRef = useRef<HTMLInputElement>(null);
  const [submitted, setSubmitted] = useState<Record<string, SubmissionEntry>>({});
  const [submissionLog, setSubmissionLog] = useState<SubmissionEntry[]>([]);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const { currentUser } = useStore();

  const plateChecks = checks[selectedPlate] ?? {};
  const plateExpiry = expiryDates[selectedPlate] ?? {};
  const checkedCount = Object.values(plateChecks).filter(Boolean).length;
  const pct = Math.round((checkedCount / TOTAL) * 100);

  // Required date fields — must all be filled before submission is allowed
  const plateSvc = serviceDates[selectedPlate] ?? {};
  const missingDates: string[] = [];
  if (!(plateSvc[PROBE_ITEM_NO] ?? "")) missingDates.push("Probe — last service date");
  for (const item of EXPIRY_ITEMS) {
    if (!(plateExpiry[item.no] ?? "")) missingDates.push(`${item.item} — expiry date`);
  }
  const datesComplete = missingDates.length === 0;

  // Expiry alerts for the selected vehicle
  const expiryAlerts = EXPIRY_ITEMS
    .map(item => ({ item, status: expiryStatus(plateExpiry[item.no] ?? ""), date: plateExpiry[item.no] ?? "" }))
    .filter(e => e.status === "expired" || e.status === "warning");

  // Does any vehicle have expiring items? (for vehicle selector badge)
  const vehicleHasAlert = (plate: string) => {
    const ed = expiryDates[plate] ?? {};
    return EXPIRY_ITEM_NOS.size > 0 && EXPIRY_ITEMS.some(item => {
      const s = expiryStatus(ed[item.no] ?? "");
      return s === "expired" || s === "warning";
    });
  };

  const toggle = (no: number) => {
    setChecks(prev => ({
      ...prev,
      [selectedPlate]: { ...prev[selectedPlate], [no]: !prev[selectedPlate][no] },
    }));
  };

  const toggleAll = (items: ChecklistItem[], val: boolean) => {
    setChecks(prev => {
      const next = { ...prev[selectedPlate] };
      for (const i of items) next[i.no] = val;
      return { ...prev, [selectedPlate]: next };
    });
  };

  const resetPlate = () => {
    setChecks(prev => {
      const next: CheckState = {};
      for (const no of ALL_ITEM_NOS) next[no] = false;
      return { ...prev, [selectedPlate]: next };
    });
  };

  const toggleSection = (name: string) =>
    setCollapsed(prev => ({ ...prev, [name]: !prev[name] }));

  const vehiclePct = (plate: string) => {
    const c = checks[plate] ?? {};
    const done = Object.values(c).filter(Boolean).length;
    return Math.round((done / TOTAL) * 100);
  };

  const openInlineExpiry = (no: number, current: string) => {
    setInlineExpiry({ plate: selectedPlate, no });
    setInlineVal(current);
    setTimeout(() => inlineRef.current?.focus(), 30);
  };

  const saveInlineExpiry = () => {
    if (!inlineExpiry) return;
    setExpiryDates(prev => ({
      ...prev,
      [inlineExpiry.plate]: { ...(prev[inlineExpiry.plate] ?? {}), [inlineExpiry.no]: inlineVal },
    }));
    setInlineExpiry(null);
  };

  const openInlineService = (no: number, current: string) => {
    setInlineService({ plate: selectedPlate, no });
    setInlineServiceVal(current);
    setTimeout(() => inlineServiceRef.current?.focus(), 30);
  };

  const saveInlineService = () => {
    if (!inlineService) return;
    setServiceDates(prev => ({
      ...prev,
      [inlineService.plate]: { ...(prev[inlineService.plate] ?? {}), [inlineService.no]: inlineServiceVal },
    }));
    setInlineService(null);
  };

  const confirmSubmit = () => {
    const entry: SubmissionEntry = {
      plate: selectedPlate,
      submittedBy: currentUser?.name ?? "Unknown",
      submittedAt: new Date().toISOString(),
      hasAlerts: expiryAlerts.length > 0,
    };
    setSubmitted(prev => ({ ...prev, [selectedPlate]: entry }));
    setSubmissionLog(prev => [entry, ...prev]);
    setShowSubmitModal(false);
  };

  const isSubmitted = !!submitted[selectedPlate];

  const downloadReport = () => {
    const now = new Date();
    const generated = now.toLocaleString("en-SG", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });

    const lines: string[] = [
      "VEHICLE CHECKLIST — SUBMISSION REPORT",
      "======================================",
      `Generated : ${generated}`,
      `Submitted by : ${currentUser?.name ?? "—"}`,
      `Total submitted : ${submissionLog.length} vehicle(s)`,
      "",
      "─────────────────────────────────────────────────────",
      `${"VEHICLE".padEnd(14)}${"SUBMITTED BY".padEnd(22)}${"DATE".padEnd(16)}${"TIME".padEnd(8)}ALERTS`,
      "─────────────────────────────────────────────────────",
      ...submissionLog.map(e => {
        const dt = new Date(e.submittedAt);
        const d = dt.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
        const t = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });
        return `${e.plate.padEnd(14)}${e.submittedBy.padEnd(22)}${d.padEnd(16)}${t.padEnd(8)}${e.hasAlerts ? "⚠ Expiry alerts noted" : "—"}`;
      }),
      "─────────────────────────────────────────────────────",
      "",
      submissionLog.some(e => e.hasAlerts)
        ? "NOTE: Vehicles marked with ⚠ had expiry items acknowledged at submission."
        : "All submissions clear — no expiry issues noted.",
    ];

    const text = lines.join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = now.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
    a.href = url;
    a.download = `Checklist-Report-${dateStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Vehicle Checklist</h1>
        <p className="text-sm text-slate-500 mt-0.5">Weekly minimum equipment checklist — {TOTAL} items</p>
      </div>

      {/* Vehicle selector */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Vehicle</p>
        <div className="flex flex-wrap gap-2">
          {VEHICLES.map(plate => {
            const p = vehiclePct(plate);
            const hasAlert = vehicleHasAlert(plate);
            const isSelected = plate === selectedPlate;
            return (
              <button
                key={plate}
                onClick={() => setSelectedPlate(plate)}
                className={`relative px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
                  isSelected
                    ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                    : hasAlert
                    ? "bg-red-50 border-red-200 text-red-700"
                    : submitted[plate]
                    ? "bg-green-600 border-green-600 text-white"
                    : p === 100
                    ? "bg-green-50 border-green-200 text-green-700"
                    : p > 0
                    ? "bg-amber-50 border-amber-200 text-amber-700"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {plate}
                {hasAlert && !isSelected && <span className="ml-1 text-[9px]">⚠</span>}
                {!hasAlert && submitted[plate] && !isSelected && <span className="ml-1 text-[9px]">✓</span>}
                {!hasAlert && !submitted[plate] && p > 0 && !isSelected && (
                  <span className={`ml-1.5 text-[9px] font-normal ${p === 100 ? "text-green-500" : "text-amber-500"}`}>
                    {p}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Expiry alert banner */}
      {expiryAlerts.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <span className="text-sm font-semibold text-red-700">
              {expiryAlerts.length} item{expiryAlerts.length > 1 ? "s" : ""} expiring soon — {selectedPlate}
            </span>
          </div>
          <div className="space-y-1">
            {expiryAlerts.map(({ item, status, date }) => {
              const days = daysUntil(date);
              return (
                <div key={item.no} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${status === "expired" ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800"}`}>
                    {status === "expired" ? "EXPIRED" : `${days}d left`}
                  </span>
                  <span className="text-red-700 font-medium">{item.item}</span>
                  <span className="text-red-400">· expires {fmtDate(date)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Progress bar for selected vehicle */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">{selectedPlate}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-bold ${pct === 100 ? "text-green-600" : pct > 0 ? "text-amber-600" : "text-slate-400"}`}>
              {checkedCount} / {TOTAL}
            </span>
            <button
              onClick={resetPlate}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors"
              title="Reset checklist"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${pct === 100 ? "bg-green-500" : "bg-blue-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {pct === 100 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-green-600 font-medium">✓ All items accounted for</p>
              {isSubmitted ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 border border-green-200 rounded-lg px-3 py-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Submitted
                </span>
              ) : datesComplete ? (
                <button
                  onClick={() => setShowSubmitModal(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 active:bg-green-800 rounded-lg px-3 py-1.5 transition-colors shadow-sm"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Submit Checklist
                </button>
              ) : (
                <button
                  disabled
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-slate-400 rounded-lg px-3 py-1.5 cursor-not-allowed opacity-60"
                  title="Fill in all required dates first"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Submit Checklist
                </button>
              )}
            </div>
            {!isSubmitted && !datesComplete && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-1.5">
                <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Fill in the following before submitting:
                </p>
                <ul className="space-y-0.5 pl-5">
                  {missingDates.map(label => (
                    <li key={label} className="text-xs text-amber-700 list-disc">{label}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Checklist by category */}
      <div className="space-y-3">
        {CATEGORIES.map(cat => {
          const isExpiryCategory = cat.name === "Expiry Equipment";
          const catDone = cat.items.filter(i => plateChecks[i.no]).length;
          const allDone = catDone === cat.items.length;
          const isCollapsed = collapsed[cat.name];
          const catHasAlert = isExpiryCategory && expiryAlerts.length > 0;

          return (
            <div key={cat.name} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${catHasAlert ? "border-red-200" : "border-slate-100"}`}>
              {/* Category header */}
              <div
                className={`flex items-center justify-between px-4 py-3 cursor-pointer select-none border-b ${
                  catHasAlert ? "bg-red-50 border-red-100" : allDone ? "bg-green-50 border-slate-100" : "bg-slate-50 border-slate-100"
                }`}
                onClick={() => toggleSection(cat.name)}
              >
                <div className="flex items-center gap-2">
                  {isCollapsed ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
                  <span className={`text-sm font-semibold ${catHasAlert ? "text-red-700" : allDone ? "text-green-700" : "text-slate-700"}`}>
                    {allDone && !catHasAlert && "✓ "}
                    {catHasAlert && <AlertTriangle className="inline w-3.5 h-3.5 mr-1 mb-0.5" />}
                    {cat.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{catDone}/{cat.items.length}</span>
                  {!allDone ? (
                    <button
                      onClick={e => { e.stopPropagation(); toggleAll(cat.items, true); }}
                      className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-600 hover:bg-blue-200 font-medium"
                    >
                      Tick all
                    </button>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); toggleAll(cat.items, false); }}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 font-medium"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Items */}
              {!isCollapsed && (
                <div className="divide-y divide-slate-50">
                  {cat.items.map(item => {
                    const checked = plateChecks[item.no] ?? false;
                    const isExpiry = EXPIRY_ITEM_NOS.has(item.no);
                    const isProbe = item.no === PROBE_ITEM_NO;
                    const expDate = isExpiry ? (plateExpiry[item.no] ?? "") : "";
                    const expSt = isExpiry ? expiryStatus(expDate) : "none";
                    const isEditingExpiry = inlineExpiry?.plate === selectedPlate && inlineExpiry.no === item.no;
                    const plateService = serviceDates[selectedPlate] ?? {};
                    const svcDate = isProbe ? (plateService[item.no] ?? "") : "";
                    const isEditingService = inlineService?.plate === selectedPlate && inlineService.no === item.no;

                    const rowBg = expSt === "expired"
                      ? "bg-red-50/70"
                      : expSt === "warning"
                      ? "bg-amber-50/70"
                      : checked
                      ? "bg-green-50/60"
                      : "hover:bg-slate-50";

                    return (
                      <div
                        key={item.no}
                        className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${rowBg}`}
                      >
                        <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(item.no)}
                            className="w-4 h-4 rounded accent-blue-600 shrink-0"
                          />
                          <span className="text-xs text-slate-400 w-5 shrink-0">{item.no}</span>
                          <span className={`flex-1 text-sm min-w-0 ${checked && expSt === "none" ? "line-through text-slate-400" : expSt === "expired" ? "text-red-700 font-medium" : expSt === "warning" ? "text-amber-700 font-medium" : "text-slate-700"}`}>
                            {item.item}
                          </span>
                        </label>

                        {/* Last service date input — Probe only */}
                        {isProbe && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Wrench className="w-3 h-3 text-slate-400 shrink-0" />
                            {isEditingService ? (
                              <input
                                ref={inlineServiceRef}
                                type="date"
                                value={inlineServiceVal}
                                onChange={e => setInlineServiceVal(e.target.value)}
                                onBlur={saveInlineService}
                                onKeyDown={e => {
                                  if (e.key === "Enter") saveInlineService();
                                  if (e.key === "Escape") setInlineService(null);
                                }}
                                className="text-xs border border-blue-400 rounded-md px-2 py-0.5 bg-white outline-none ring-1 ring-blue-300 w-32"
                              />
                            ) : (
                              <button
                                onClick={() => openInlineService(item.no, svcDate)}
                                className={`text-xs px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap ${
                                  svcDate
                                    ? "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                                    : "border-dashed border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-50"
                                }`}
                              >
                                {svcDate ? fmtDate(svcDate) : "Set service date"}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Expiry date input — only for Expiry Equipment */}
                        {isExpiry && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isEditingExpiry ? (
                              <input
                                ref={inlineRef}
                                type="date"
                                value={inlineVal}
                                onChange={e => setInlineVal(e.target.value)}
                                onBlur={saveInlineExpiry}
                                onKeyDown={e => {
                                  if (e.key === "Enter") saveInlineExpiry();
                                  if (e.key === "Escape") setInlineExpiry(null);
                                }}
                                className="text-xs border border-blue-400 rounded-md px-2 py-0.5 bg-white outline-none ring-1 ring-blue-300 w-32"
                              />
                            ) : (
                              <button
                                onClick={() => openInlineExpiry(item.no, expDate)}
                                className={`text-xs px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap ${
                                  expSt === "expired"
                                    ? "border-red-300 bg-red-100 text-red-700 font-semibold"
                                    : expSt === "warning"
                                    ? "border-amber-300 bg-amber-100 text-amber-700 font-semibold"
                                    : expSt === "ok"
                                    ? "border-green-200 bg-green-50 text-green-700"
                                    : "border-dashed border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-50"
                                }`}
                              >
                                {expSt === "expired" && "⚠ EXPIRED"}
                                {expSt === "warning" && `⚠ ${daysUntil(expDate)}d left`}
                                {expSt === "ok" && fmtDate(expDate)}
                                {expSt === "none" && "Set expiry"}
                              </button>
                            )}
                          </div>
                        )}

                        <span className="text-xs text-slate-400 hidden sm:inline shrink-0">
                          {item.qty} {item.unit}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${LOCATION_COLORS[item.location] ?? "bg-slate-100 text-slate-600"}`}>
                          {item.location}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Submission Log */}
      {submissionLog.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">Submission Log</span>
              <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">{submissionLog.length}</span>
            </div>
            <button
              onClick={downloadReport}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded-lg px-2.5 py-1.5 transition-colors bg-white hover:bg-blue-50"
            >
              <Download className="w-3 h-3" /> Download Report
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {submissionLog.map((entry, i) => {
              const dt = new Date(entry.submittedAt);
              const datePart = dt.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
              const timePart = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 rounded px-2 py-0.5 shrink-0">
                    {entry.plate}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-slate-600">{entry.submittedBy}</span>
                  </div>
                  {entry.hasAlerts && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold shrink-0">
                      ⚠ alerts noted
                    </span>
                  )}
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-500">{datePart}</p>
                    <p className="text-[11px] text-slate-400 font-mono">{timePart}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Submit confirmation modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            {/* Header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b ${expiryAlerts.length > 0 ? "bg-amber-50 border-amber-100" : "bg-green-50 border-green-100"}`}>
              <div className="flex items-center gap-2">
                {expiryAlerts.length > 0
                  ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  : <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                }
                <span className={`text-sm font-bold ${expiryAlerts.length > 0 ? "text-amber-800" : "text-green-800"}`}>
                  Submit Checklist — {selectedPlate}
                </span>
              </div>
              <button onClick={() => setShowSubmitModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Expiry warnings */}
              {expiryAlerts.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                    ⚠ {expiryAlerts.length} item{expiryAlerts.length > 1 ? "s" : ""} near expiry — acknowledge before submitting
                  </p>
                  <div className="space-y-1.5">
                    {expiryAlerts.map(({ item, status, date }) => {
                      const days = daysUntil(date);
                      return (
                        <div key={item.no} className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${status === "expired" ? "bg-red-50 border border-red-200" : "bg-amber-50 border border-amber-200"}`}>
                          <span className={`px-1.5 py-0.5 rounded-full font-bold shrink-0 ${status === "expired" ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800"}`}>
                            {status === "expired" ? "EXPIRED" : `${days}d left`}
                          </span>
                          <span className={`font-medium ${status === "expired" ? "text-red-700" : "text-amber-700"}`}>{item.item}</span>
                          <span className="text-slate-400 ml-auto shrink-0">{fmtDate(date)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  All {TOTAL} items have been verified for <span className="font-semibold">{selectedPlate}</span>. Confirm submission?
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowSubmitModal(false)}
                  className="flex-1 text-sm font-medium py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmSubmit}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold py-2 rounded-xl text-white transition-colors ${expiryAlerts.length > 0 ? "bg-amber-500 hover:bg-amber-600" : "bg-green-600 hover:bg-green-700"}`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {expiryAlerts.length > 0 ? "Acknowledge & Submit" : "Confirm Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
