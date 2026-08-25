import { useState, useRef, useCallback, useEffect } from "react";
import { ManagerDashboard } from "./ManagerDashboard";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ── Types ────────────────────────────────────────────────────────────────────

interface RosterTeam {
  id: string;
  unitCode: string;
  vehicleNumber: string;
  vehicleId: string;
  partner: string;
  shift: string;
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function pinIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div class="photo-pin">${n}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// Singapore centre
const SG_CENTER: [number, number] = [1.3521, 103.8198];

// ── Map ref setter ────────────────────────────────────────────────────────────

function MapRefSetter({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}

// ── Map click handler component ───────────────────────────────────────────────

interface MapClickHandlerProps {
  mode: "photo" | "draw" | null;
  onMapClick: (lat: number, lng: number) => void;
}

function MapClickHandler({ mode, onMapClick }: MapClickHandlerProps) {
  useMapEvents({
    click(e) {
      if (mode) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ── Team Select Screen ────────────────────────────────────────────────────────

interface TeamSelectProps {
  onStart: (team: { vehicleNumber: string; officers: string; shift: string; teamId: string; teamName: string }) => Promise<void>;
}

function TeamSelect({ onStart }: TeamSelectProps) {
  const [rosterTeams, setRosterTeams] = useState<RosterTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<RosterTeam | null>(null);
  const [manualVehicle, setManualVehicle] = useState("");
  const [manualOfficers, setManualOfficers] = useState("");
  const [manualShift, setManualShift] = useState("DAY");
  const [loading, setLoading] = useState(false);
  const [useManual, setUseManual] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/deployments/state")
      .then((r) => r.json())
      .then((data: { rosterTeams?: RosterTeam[] }) => {
        if (Array.isArray(data.rosterTeams)) setRosterTeams(data.rosterTeams);
      })
      .catch(() => {});
  }, []);

  async function handleStart() {
    const team = useManual || rosterTeams.length === 0
      ? (!manualVehicle.trim() ? null : {
          vehicleNumber: manualVehicle.trim().toUpperCase(),
          officers: manualOfficers.trim(),
          shift: manualShift,
          teamId: "",
          teamName: manualVehicle.trim().toUpperCase(),
        })
      : (!selectedTeam ? null : {
          vehicleNumber: selectedTeam.vehicleNumber || selectedTeam.vehicleId || selectedTeam.id,
          officers: selectedTeam.partner,
          shift: selectedTeam.shift,
          teamId: selectedTeam.id,
          teamName: `${selectedTeam.unitCode} ${selectedTeam.vehicleNumber || selectedTeam.vehicleId || selectedTeam.id}`.trim(),
        });
    if (!team) return;

    setLoading(true);
    setStartError(null);
    try {
      await onStart(team);
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Network error — check your connection and retry"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="team-select">
      <div className="team-select-card">
        <div className="app-header">
          <span className="app-icon">🔍</span>
          <h1>Field Inspector</h1>
          <p>Select your team to begin inspection</p>
        </div>

        {!useManual && rosterTeams.length > 0 ? (
          <div className="roster-list">
            <label className="field-label">Select Team from Roster</label>
            {rosterTeams.map((t) => (
              <button
                key={t.id}
                className={`roster-item ${selectedTeam?.id === t.id ? "selected" : ""}`}
                onClick={() => setSelectedTeam(t)}
              >
                <span className="roster-vehicle">{t.vehicleNumber || t.vehicleId || t.unitCode}</span>
                <span className="roster-officers">{t.partner}</span>
                <span className="roster-shift shift-badge">{t.shift}</span>
              </button>
            ))}
            <button className="link-btn" onClick={() => setUseManual(true)}>
              Enter manually instead
            </button>
          </div>
        ) : (
          <div className="manual-form">
            <label className="field-label">Vehicle Number</label>
            <input
              className="field-input"
              placeholder="e.g. GBL378Z"
              value={manualVehicle}
              onChange={(e) => setManualVehicle(e.target.value)}
            />
            <label className="field-label">Officers</label>
            <input
              className="field-input"
              placeholder="e.g. Suffi & Nash"
              value={manualOfficers}
              onChange={(e) => setManualOfficers(e.target.value)}
            />
            <label className="field-label">Shift</label>
            <div className="shift-row">
              {["DAY", "PD", "NIGHT"].map((s) => (
                <button
                  key={s}
                  className={`shift-btn ${manualShift === s ? "active" : ""}`}
                  onClick={() => setManualShift(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            {rosterTeams.length > 0 && (
              <button className="link-btn" onClick={() => { setUseManual(false); }}>
                ← Back to roster
              </button>
            )}
          </div>
        )}

        {startError && (
          <div className="upload-error">
            ⚠️ {startError}
          </div>
        )}

        <button
          className="start-btn"
          onClick={handleStart}
          disabled={
            loading ||
            (!useManual && rosterTeams.length > 0 && !selectedTeam) ||
            ((useManual || rosterTeams.length === 0) && !manualVehicle.trim())
          }
        >
          {loading ? "Starting…" : startError ? "Retry" : "Start Inspection"}
        </button>
      </div>
    </div>
  );
}

// ── Inspection Screen ─────────────────────────────────────────────────────────

interface InspectionScreenProps {
  inspectionId: string;
  vehicleNumber: string;
  officers: string;
  shift: string;
  onComplete: () => void;
}

function InspectionScreen({ inspectionId, vehicleNumber, officers, shift, onComplete }: InspectionScreenProps) {
  const [mode, setMode] = useState<"photo" | "draw" | null>(null);
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [lines, setLines] = useState<InspectionLine[]>([]);
  const [drawPoints, setDrawPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [pendingCoord, setPendingCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [remarksInput, setRemarksInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [lineSaving, setLineSaving] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);
  const [drawColor, setDrawColor] = useState("#e74c3c");
  const [gpsPos, setGpsPos] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [liveTracking, setLiveTracking] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (mode === "photo") {
        setPendingCoord({ lat, lng });
        fileRef.current?.click();
      } else if (mode === "draw") {
        setDrawPoints((pts) => [...pts, { lat, lng }]);
      }
    },
    [mode]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !pendingCoord) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const isRetake = pendingFile !== null;
    setPendingFile(file);
    if (!isRetake) {
      setLabelInput("");
      setRemarksInput("");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleRetake() {
    if (fileRef.current) fileRef.current.value = "";
    fileRef.current?.click();
  }

  function handlePhotoDiscard() {
    setPendingFile(null);
    setPendingCoord(null);
    setLabelInput("");
    setRemarksInput("");
    setUploadError(null);
  }

  async function handlePhotoSave() {
    if (!pendingFile || !pendingCoord) return;
    setUploading(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append("photo", pendingFile);
    fd.append("lat", String(pendingCoord.lat));
    fd.append("lng", String(pendingCoord.lng));
    fd.append("label", labelInput.trim());
    fd.append("remarks", remarksInput.trim());
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/photos`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        const photo: InspectionPhoto = await res.json();
        setPhotos((p) => [...p, photo]);
        setPendingFile(null);
        setPendingCoord(null);
        setLabelInput("");
        setRemarksInput("");
      } else {
        let msg = `Upload failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          // ignore parse errors
        }
        setUploadError(msg);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Network error — check your connection and retry"
      );
    } finally {
      setUploading(false);
    }
  }

  function handleLocate() {
    if (!navigator.geolocation) {
      setLocateError("Geolocation is not supported by your browser.");
      setTimeout(() => setLocateError(null), 4000);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        mapRef.current?.flyTo([lat, lng], 17);
        setGpsPos([lat, lng]);
        setLocating(false);
        setLocateError(null);
      },
      () => {
        setLocateError("Location access denied. Check your browser permissions.");
        setLocating(false);
        setTimeout(() => setLocateError(null), 4000);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function handleLiveToggle() {
    if (!navigator.geolocation) {
      setLocateError("Geolocation is not supported by your browser.");
      setTimeout(() => setLocateError(null), 4000);
      return;
    }
    if (liveTracking) {
      stopLiveTracking();
    } else {
      setLiveTracking(true);
      setLocateError(null);
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setGpsPos([lat, lng]);
        },
        () => {
          setLocateError("Location access denied. Check your browser permissions.");
          setTimeout(() => setLocateError(null), 4000);
          stopLiveTracking();
        },
        { enableHighAccuracy: true }
      );
      watchIdRef.current = id;
    }
  }

  async function finishLine() {
    if (drawPoints.length < 2) {
      setDrawPoints([]);
      return;
    }
    setLineSaving(true);
    setLineError(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: drawPoints, color: drawColor }),
      });
      if (res.ok) {
        const line: InspectionLine = await res.json();
        setLines((l) => [...l, line]);
        setDrawPoints([]);
      } else {
        let msg = `Could not save line (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          // ignore parse errors
        }
        setLineError(msg);
      }
    } catch (err) {
      setLineError(
        err instanceof Error ? err.message : "Network error — check your connection and retry"
      );
    } finally {
      setLineSaving(false);
    }
  }

  function stopLiveTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setLiveTracking(false);
  }

  async function handleSubmit() {
    stopLiveTracking();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/complete`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        setDone(true);
      } else {
        let msg = `Could not submit inspection (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          // ignore parse errors
        }
        setSubmitError(msg);
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Network error — check your connection and retry"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="done-screen">
        <div className="done-card">
          <div className="done-icon">✅</div>
          <h2>Inspection Submitted</h2>
          <p>{vehicleNumber} — {officers} ({shift})</p>
          <p className="done-stats">
            {photos.length} photo{photos.length !== 1 ? "s" : ""} · {lines.length} line{lines.length !== 1 ? "s" : ""}
          </p>
          <button className="start-btn" onClick={onComplete}>
            Start New Inspection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inspection-screen">
      <div className="top-bar">
        <div className="top-bar-info">
          <span className="vehicle-badge">{vehicleNumber}</span>
          <span className="officers-text">{officers}</span>
          <span className={`shift-badge shift-${shift.toLowerCase()}`}>{shift}</span>
        </div>
        <div className="top-bar-stats">
          <span>📷 {photos.length}</span>
          <span>✏️ {lines.length}</span>
        </div>
      </div>

      <div className="map-wrapper">
        <MapContainer
          center={SG_CENTER}
          zoom={12}
          style={{ width: "100%", height: "100%" }}
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapRefSetter mapRef={mapRef} />
          <MapClickHandler mode={mode} onMapClick={handleMapClick} />

          {gpsPos && (
            <CircleMarker
              center={gpsPos}
              radius={10}
              pathOptions={{ color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.85, weight: 2 }}
            />
          )}

          {photos.map((p) => (
            <Marker key={p.photoId} position={[p.lat, p.lng]} icon={pinIcon(p.pinNumber)}>
              <Popup>
                <strong>Pin {p.pinNumber}</strong>
                {p.label && <div>{p.label}</div>}
                {p.remarks && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{p.remarks}</div>}
                <img
                  src={`/api/inspections/${inspectionId}/photos/${p.photoId}/file`}
                  alt={p.label || `Pin ${p.pinNumber}`}
                  style={{ width: 160, marginTop: 6, borderRadius: 4 }}
                />
              </Popup>
            </Marker>
          ))}

          {lines.map((l) => (
            <Polyline
              key={l.lineId}
              positions={l.points.map((pt) => [pt.lat, pt.lng] as [number, number])}
              pathOptions={{ color: l.color, weight: 3 }}
            />
          ))}

          {drawPoints.length > 0 && (
            <Polyline
              positions={drawPoints.map((pt) => [pt.lat, pt.lng] as [number, number])}
              pathOptions={{ color: drawColor, weight: 3, dashArray: "6 4" }}
            />
          )}
        </MapContainer>

        {mode === "photo" && (
          <div className="map-hint photo-hint">📷 Tap map to place photo pin</div>
        )}
        {mode === "draw" && (
          <div className="map-hint draw-hint">
            ✏️ Tap map to add points ({drawPoints.length} so far)
          </div>
        )}

        <button
          className={`live-btn ${liveTracking ? "live-active" : ""}`}
          onClick={handleLiveToggle}
          title={liveTracking ? "Stop live tracking" : "Start live tracking"}
        >
          {liveTracking ? "🔴 Live" : "📡 Live"}
        </button>

        <button
          className={`locate-btn ${locating ? "locating" : ""}`}
          onClick={handleLocate}
          title="Find my location"
          disabled={locating || liveTracking}
        >
          {locating ? "⏳" : "📍"}
        </button>

        {locateError && (
          <div className="locate-error">{locateError}</div>
        )}
      </div>

      {pendingFile && pendingCoord && (
        <div className="label-overlay">
          <div className="label-card">
            <p className="label-card-title">📷 Photo Details</p>
            <label className="field-label">Label <span className="optional-hint">(optional)</span></label>
            <input
              className="field-input"
              placeholder="e.g. Damaged road surface"
              value={labelInput}
              autoFocus
              onChange={(e) => setLabelInput(e.target.value)}
            />
            <label className="field-label">Remarks <span className="optional-hint">(optional)</span></label>
            <textarea
              className="field-textarea"
              placeholder="Additional notes for this photo…"
              value={remarksInput}
              rows={3}
              onChange={(e) => setRemarksInput(e.target.value)}
            />
            {uploadError && (
              <div className="upload-error">
                ⚠️ {uploadError}
              </div>
            )}
            <div className="label-actions">
              <button className="ghost-btn" onClick={handlePhotoDiscard} disabled={uploading}>
                Discard
              </button>
              <button className="ghost-btn" onClick={handleRetake} disabled={uploading}>
                🔄 Retake
              </button>
              <button className="primary-btn" onClick={handlePhotoSave} disabled={uploading}>
                {uploading ? "Saving…" : uploadError ? "Retry" : "Save Photo"}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      <div className="bottom-toolbar">
        <div className="tool-group">
          <button
            className={`tool-btn ${mode === "photo" ? "active" : ""}`}
            onClick={() => setMode(mode === "photo" ? null : "photo")}
          >
            📷 Photo
          </button>

          <button
            className={`tool-btn ${mode === "draw" ? "active" : ""}`}
            onClick={() => {
              if (mode === "draw") return;
              setMode("draw");
              setDrawPoints([]);
            }}
          >
            ✏️ Draw
          </button>

          {mode === "draw" && (
            <>
              <input
                type="color"
                value={drawColor}
                onChange={(e) => setDrawColor(e.target.value)}
                title="Line colour"
                className="color-picker"
              />
              <button
                className={`tool-btn finish-btn ${drawPoints.length < 2 ? "disabled" : ""}`}
                onClick={finishLine}
                disabled={lineSaving || drawPoints.length < 2}
              >
                {lineSaving ? "Saving…" : lineError ? "Retry" : "✓ Finish Line"}
              </button>
              <button
                className="tool-btn cancel-btn"
                onClick={() => { setMode(null); setDrawPoints([]); setLineError(null); }}
              >
                ✕ Cancel
              </button>
            </>
          )}
        </div>
        {mode === "draw" && lineError && (
          <div className="upload-error">
            ⚠️ {lineError}
          </div>
        )}

        {submitError && (
          <div className="upload-error">
            ⚠️ {submitError}
          </div>
        )}

        <button
          className="submit-btn"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Submitting…" : submitError ? "Retry Submit" : "Submit ✓"}
        </button>
      </div>
    </div>
  );
}

// ── Role Picker ───────────────────────────────────────────────────────────────

function RolePicker({ onPickInspector, onPickManager }: { onPickInspector: () => void; onPickManager: () => void }) {
  return (
    <div style={{
      minHeight: "100vh",
      width: "100vw",
      background: "linear-gradient(160deg, #0f172a 0%, #1e3a5f 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "24px 16px",
      boxSizing: "border-box",
    }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 60,
          height: 60,
          borderRadius: 16,
          background: "rgba(14,165,233,0.2)",
          border: "1px solid rgba(14,165,233,0.4)",
          marginBottom: 16,
        }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path d="M9 11l3 3L22 4" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ color: "#38bdf8", fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
          Field Inspection System
        </div>
        <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 24 }}>
          Who are you?
        </div>
        <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 6 }}>
          Select your role to continue
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 340 }}>
        <button
          onClick={onPickInspector}
          style={{
            background: "rgba(14,165,233,0.12)",
            border: "1.5px solid rgba(14,165,233,0.45)",
            borderRadius: 14,
            padding: "20px 22px",
            cursor: "pointer",
            textAlign: "left",
            transition: "background 0.15s, border-color 0.15s",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(14,165,233,0.22)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(14,165,233,0.12)"; }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "rgba(14,165,233,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, flexShrink: 0,
          }}>🔍</div>
          <div>
            <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Field Inspector</div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>Log photos, draw paths, submit inspection report</div>
          </div>
          <div style={{ marginLeft: "auto", color: "#38bdf8", fontSize: 18 }}>›</div>
        </button>

        <button
          onClick={() => onPickManager()}
          style={{
            background: "rgba(168,85,247,0.12)",
            border: "1.5px solid rgba(168,85,247,0.45)",
            borderRadius: 14,
            padding: "20px 22px",
            cursor: "pointer",
            textAlign: "left",
            transition: "background 0.15s, border-color 0.15s",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(168,85,247,0.22)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(168,85,247,0.12)"; }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "rgba(168,85,247,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, flexShrink: 0,
          }}>📋</div>
          <div>
            <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Manager</div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>Monitor inspections, view reports, manage records</div>
          </div>
          <div style={{ marginLeft: "auto", color: "#a855f7", fontSize: 18 }}>›</div>
        </button>
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

type AppState =
  | { screen: "role" }
  | { screen: "manager" }
  | { screen: "select" }
  | { screen: "inspection"; inspectionId: string; vehicleNumber: string; officers: string; shift: string };

export default function App() {
  const [state, setState] = useState<AppState>({ screen: "role" });

  async function handleTeamStart(team: {
    vehicleNumber: string;
    officers: string;
    shift: string;
    teamId: string;
    teamName: string;
  }) {
    const res = await fetch("/api/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(team),
    });
    if (!res.ok) {
      let msg = `Could not start inspection (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        // ignore parse errors
      }
      throw new Error(msg);
    }
    const insp = await res.json();
    setState({
      screen: "inspection",
      inspectionId: insp.id,
      vehicleNumber: team.vehicleNumber,
      officers: team.officers,
      shift: team.shift,
    });
  }

  if (state.screen === "role") {
    return (
      <RolePicker
        onPickInspector={() => setState({ screen: "select" })}
        onPickManager={() => setState({ screen: "manager" })}
      />
    );
  }

  if (state.screen === "manager") {
    return <ManagerDashboard onBack={() => setState({ screen: "role" })} />;
  }

  if (state.screen === "select") {
    return <TeamSelect onStart={handleTeamStart} />;
  }

  return (
    <InspectionScreen
      inspectionId={state.inspectionId}
      vehicleNumber={state.vehicleNumber}
      officers={state.officers}
      shift={state.shift}
      onComplete={() => setState({ screen: "role" })}
    />
  );
}
