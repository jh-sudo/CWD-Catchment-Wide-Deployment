import { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./ManagerDashboard.css";

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface InspectionPhoto {
  photoId: string;
  label: string;
  remarks: string;
  lat: number;
  lng: number;
  takenAt: string;
  pinNumber: number;
}

interface InspectionLine {
  lineId: string;
  points: { lat: number; lng: number }[];
  color: string;
}

interface Inspection {
  id: string;
  teamName: string;
  vehicleNumber: string;
  officers: string;
  shift: string;
  startedAt: string;
  completedAt: string | null;
  status: "active" | "completed";
  photos: InspectionPhoto[];
  lines: InspectionLine[];
}

function mgrPinIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div class="photo-pin">${n}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function elapsedMin(start: string, end: string | null) {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const SG_CENTER: [number, number] = [1.3521, 103.8198];

function MapPreview({ inspection }: { inspection: Inspection }) {
  const allPoints: [number, number][] = [
    ...inspection.photos.map((p) => [p.lat, p.lng] as [number, number]),
    ...inspection.lines.flatMap((l) => l.points.map((pt) => [pt.lat, pt.lng] as [number, number])),
  ];

  const center: [number, number] =
    allPoints.length > 0
      ? [
          allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length,
          allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length,
        ]
      : SG_CENTER;

  return (
    <MapContainer
      key={inspection.id}
      center={center}
      zoom={allPoints.length > 0 ? 15 : 12}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {inspection.photos.map((p) => (
        <Marker key={p.photoId} position={[p.lat, p.lng]} icon={mgrPinIcon(p.pinNumber)}>
          <Popup>
            <strong>Pin {p.pinNumber}</strong>
            {p.label && <div>{p.label}</div>}
            {p.remarks && <div style={{ fontSize: 12, color: "#555", marginTop: 2, fontStyle: "italic" }}>{p.remarks}</div>}
            <img
              src={`/api/inspections/${inspection.id}/photos/${p.photoId}/file`}
              alt={p.label || `Pin ${p.pinNumber}`}
              style={{ width: 160, marginTop: 6, borderRadius: 4 }}
            />
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{fmtDate(p.takenAt)}</div>
          </Popup>
        </Marker>
      ))}
      {inspection.lines.map((l) => (
        <Polyline
          key={l.lineId}
          positions={l.points.map((pt) => [pt.lat, pt.lng] as [number, number])}
          pathOptions={{ color: l.color, weight: 3 }}
        />
      ))}
    </MapContainer>
  );
}

function DetailPanel({ inspection, onClose }: { inspection: Inspection; onClose: () => void }) {
  function downloadReport() {
    const a = document.createElement("a");
    a.href = `/api/inspections/${inspection.id}/report`;
    a.download = "";
    a.click();
  }

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-header-info">
          <span className="vehicle-badge">{inspection.vehicleNumber}</span>
          <span className={`status-badge status-${inspection.status}`}>
            {inspection.status === "active" ? "🟡 Active" : "✅ Done"}
          </span>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="detail-meta">
        <div className="meta-row"><span className="meta-label">Officers</span><span>{inspection.officers || "—"}</span></div>
        <div className="meta-row">
          <span className="meta-label">Shift</span>
          <span className={`shift-badge shift-${inspection.shift.toLowerCase()}`}>{inspection.shift}</span>
        </div>
        <div className="meta-row"><span className="meta-label">Started</span><span>{fmtDate(inspection.startedAt)}</span></div>
        {inspection.completedAt && (
          <div className="meta-row"><span className="meta-label">Completed</span><span>{fmtDate(inspection.completedAt)}</span></div>
        )}
        <div className="meta-row"><span className="meta-label">Duration</span><span>{elapsedMin(inspection.startedAt, inspection.completedAt)}</span></div>
        <div className="meta-row"><span className="meta-label">Photos</span><span>{inspection.photos.length}</span></div>
        <div className="meta-row"><span className="meta-label">Lines</span><span>{inspection.lines.length}</span></div>
      </div>
      <div className="map-preview-wrap">
        {inspection.photos.length === 0 && inspection.lines.length === 0 ? (
          <div className="map-empty">No data recorded yet</div>
        ) : (
          <MapPreview inspection={inspection} />
        )}
      </div>
      {inspection.photos.length > 0 && (
        <div className="photo-strip">
          {inspection.photos.map((p) => (
            <div key={p.photoId} className="photo-thumb-wrap">
              <img
                className="photo-thumb"
                src={`/api/inspections/${inspection.id}/photos/${p.photoId}/file`}
                alt={p.label || `Pin ${p.pinNumber}`}
              />
              <span className="thumb-pin">{p.pinNumber}</span>
              {p.label && <span className="thumb-label">{p.label}</span>}
              {p.remarks && <span className="thumb-remarks">{p.remarks}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="detail-actions">
        <button className="report-btn" onClick={downloadReport}>⬇ Download Report (.docx)</button>
      </div>
    </div>
  );
}

export function ManagerDashboard({ onBack }: { onBack: () => void }) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [selected, setSelected] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("completed");
  const [search, setSearch] = useState("");
  const [clearConfirm, setClearConfirm] = useState<"completed" | "all" | null>(null);
  const [clearing, setClearing] = useState(false);

  const fetchInspections = useCallback(async () => {
    try {
      const res = await fetch("/api/inspections");
      if (res.ok) {
        const data: Inspection[] = await res.json();
        setInspections(data);
        if (selected) {
          const updated = data.find((i) => i.id === selected.id);
          if (updated) setSelected(updated);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    fetchInspections();
    const interval = setInterval(fetchInspections, 10000);
    return () => clearInterval(interval);
  }, [fetchInspections]);

  const filtered = inspections.filter((i) => {
    if (filter === "active" && i.status !== "active") return false;
    if (filter === "completed" && i.status !== "completed") return false;
    const q = search.toLowerCase();
    if (q && !i.vehicleNumber.toLowerCase().includes(q) && !i.officers.toLowerCase().includes(q)) return false;
    return true;
  });

  const activeCount = inspections.filter((i) => i.status === "active").length;
  const completedCount = inspections.filter((i) => i.status === "completed").length;

  function downloadSummary(mode: "all" | "completed") {
    const a = document.createElement("a");
    a.href = `/api/inspections/summary?mode=${mode}`;
    a.download = "";
    a.click();
  }

  async function handleClear(mode: "completed" | "all") {
    setClearing(true);
    try {
      const res = await fetch(`/api/inspections?mode=${mode}`, { method: "DELETE" });
      if (res.ok) {
        setSelected(null);
        await fetchInspections();
      }
    } finally {
      setClearing(false);
      setClearConfirm(null);
    }
  }

  return (
    <div className="mgr-app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <button className="mgr-back-btn" onClick={onBack} title="Back to role picker">‹</button>
            <span>📋</span>
            <h1>Inspection Manager</h1>
          </div>
          <button className="refresh-btn" onClick={fetchInspections} title="Refresh">⟳</button>
        </div>

        <div className="stat-row">
          <div className="stat"><span className="stat-value">{inspections.length}</span><span className="stat-label">Total</span></div>
          <div className="stat"><span className="stat-value active-val">{activeCount}</span><span className="stat-label">Active</span></div>
          <div className="stat"><span className="stat-value done-val">{completedCount}</span><span className="stat-label">Done</span></div>
        </div>

        <input
          className="search-input"
          placeholder="🔎 Search vehicle / officers"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="filter-tabs">
          {(["all", "active", "completed"] as const).map((f) => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="insp-list">
          {loading && <div className="list-empty">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="list-empty">
              {filter === "completed" && inspections.filter(i => i.status === "completed").length === 0
                ? "No completed inspections yet"
                : inspections.length === 0
                ? "No inspections yet."
                : "No results"}
            </div>
          )}
          {filtered.map((insp) => (
            <button
              key={insp.id}
              className={`insp-item ${selected?.id === insp.id ? "selected" : ""}`}
              onClick={() => setSelected(insp)}
            >
              <div className="insp-item-top">
                <span className="insp-team">{insp.teamName || insp.vehicleNumber}</span>
                <span className={`status-dot status-${insp.status}`} title={insp.status} />
              </div>
              <div className="insp-item-mid">
                <span className="insp-officers">{insp.officers || "—"}</span>
                <span className={`shift-badge shift-${insp.shift.toLowerCase()}`}>{insp.shift}</span>
              </div>
              <div className="insp-item-bot">
                <span className="insp-date">{insp.completedAt ? fmtDate(insp.completedAt) : fmtDate(insp.startedAt)}</span>
                <span className="insp-counts">📷{insp.photos.length} ✏️{insp.lines.length}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="footer-row">
            <button
              className="footer-btn download-btn"
              onClick={() => downloadSummary("completed")}
              disabled={completedCount === 0}
            >
              ⬇ Download Report
            </button>
            <button
              className="footer-btn clear-btn"
              onClick={() => setClearConfirm("completed")}
              disabled={completedCount === 0}
            >
              🗑 Clear
            </button>
          </div>
        </div>
      </aside>

      {clearConfirm && (
        <div className="confirm-overlay">
          <div className="confirm-card">
            <h3>Clear inspections?</h3>
            <p>
              {clearConfirm === "completed"
                ? `This will permanently delete all ${completedCount} completed inspection${completedCount !== 1 ? "s" : ""} and their photos.`
                : `This will permanently delete all ${inspections.length} inspection${inspections.length !== 1 ? "s" : ""} and their photos.`}
            </p>
            <p className="confirm-tip">Download the report first if you need to keep a record.</p>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setClearConfirm(null)} disabled={clearing}>Cancel</button>
              <button className="confirm-delete" onClick={() => handleClear(clearConfirm)} disabled={clearing}>
                {clearing ? "Clearing…" : clearConfirm === "completed" ? "Clear Completed" : "Clear All"}
              </button>
            </div>
            {clearConfirm === "completed" && inspections.length > completedCount && (
              <button className="confirm-all-link" onClick={() => setClearConfirm("all")} disabled={clearing}>
                Clear everything including active ({inspections.length} total)
              </button>
            )}
          </div>
        </div>
      )}

      <main className="main-content">
        {selected ? (
          <DetailPanel inspection={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🗺️</div>
            <h2>Select an inspection</h2>
            <p>Click a row to view details, map, and download report</p>
          </div>
        )}
      </main>
    </div>
  );
}
