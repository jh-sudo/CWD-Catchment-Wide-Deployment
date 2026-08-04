import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Circle, Tooltip, Marker, CircleMarker } from "react-leaflet";
import { PRESET_LOCATIONS } from "./data/presetLocations";
import {
  CATCHMENT_COLORS,
  CATCHMENT_LABELS,
  LOCATION_CATCHMENT,
  FLOOD_DOTS,
  FRA_CLUSTERS,
  FRA_COLOR,
  type Catchment,
} from "./data/catchments";

const SG_CENTER: [number, number] = [1.3221, 103.8690];
const RADIUS_M = 2500;
const CATCHMENTS: Catchment[] = ["BU", "CP", "KG", "PJ", "WK"];

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "forbidden"; username: string; role: string }
  | { status: "authenticated"; username: string };

function makeDeployDotIcon(fill: string, stroke: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
    <circle cx="7" cy="7" r="5.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    className: "",
    html: svg,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    tooltipAnchor: [0, -10],
  });
}

function makeClusterLabelIcon(label: string, fill: string, stroke: string) {
  const html = `
    <div style="
      background:${fill};
      border:2px solid ${stroke};
      color:#fff;
      font-size:10px;
      font-weight:700;
      padding:2px 6px;
      border-radius:4px;
      white-space:nowrap;
      box-shadow:0 1px 4px rgba(0,0,0,0.3);
      font-family:system-ui,sans-serif;
      letter-spacing:0.02em;
    ">${label}</div>`;
  return L.divIcon({
    className: "",
    html,
    iconAnchor: [0, 0],
    tooltipAnchor: [0, -20],
  });
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (username: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/manager/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message ?? "Invalid credentials");
      } else if (data.role !== "admin") {
        setError("Admin access only. Your role: " + data.role);
      } else {
        onLogin(data.username);
      }
    } catch {
      setError("Network error — check connection");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        background: "linear-gradient(135deg, #0f172a 0%, #164e63 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.05)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: "36px 40px",
          width: 340,
          boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 52,
              height: 52,
              borderRadius: 14,
              background: "rgba(6,182,212,0.2)",
              border: "1px solid rgba(6,182,212,0.4)",
              marginBottom: 14,
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                fill="#06b6d4"
                opacity="0.8"
              />
              <circle cx="12" cy="9" r="2.5" fill="#fff" />
            </svg>
          </div>
          <div
            style={{
              color: "#06b6d4",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            APA1 Operations
          </div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>
            FRA Map
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
            Admin access required
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label
              style={{
                display: "block",
                color: "#cbd5e1",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                letterSpacing: "0.04em",
              }}
            >
              USERNAME
            </label>
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#fff",
                fontSize: 14,
                outline: "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#06b6d4";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                display: "block",
                color: "#cbd5e1",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                letterSpacing: "0.04em",
              }}
            >
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#fff",
                fontSize: 14,
                outline: "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#06b6d4";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              }}
            />
          </div>

          {error && (
            <div
              style={{
                background: "rgba(239,68,68,0.15)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#fca5a5",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px 0",
              borderRadius: 8,
              border: "none",
              background: loading
                ? "rgba(6,182,212,0.4)"
                : "linear-gradient(90deg, #0e7490, #06b6d4)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: "0.03em",
              transition: "opacity 0.15s",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

function FRAMap({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [showCatchments, setShowCatchments] = useState(true);
  const [showFlood, setShowFlood] = useState(true);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <MapContainer
        center={SG_CENTER}
        zoom={12}
        minZoom={10}
        maxZoom={18}
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          subdomains="abcd"
        />

        {showCatchments && PRESET_LOCATIONS.map((loc) => {
          const catchment: Catchment = LOCATION_CATCHMENT[loc.id] ?? "BU";
          const { fill, stroke } = CATCHMENT_COLORS[catchment];
          return (
            <Circle
              key={loc.id}
              center={[loc.lat, loc.lng]}
              radius={RADIUS_M}
              pathOptions={{
                color: stroke,
                weight: 1.5,
                fillColor: fill,
                fillOpacity: 0.13,
              }}
            >
              <Tooltip sticky>{loc.name} — {CATCHMENT_LABELS[catchment]}</Tooltip>
            </Circle>
          );
        })}

        {showCatchments && PRESET_LOCATIONS.map((loc) => {
          const catchment: Catchment = LOCATION_CATCHMENT[loc.id] ?? "BU";
          const { fill, stroke } = CATCHMENT_COLORS[catchment];
          return (
            <Marker
              key={`marker-${loc.id}`}
              position={[loc.lat, loc.lng]}
              icon={makeDeployDotIcon(fill, stroke)}
            >
              <Tooltip direction="top" offset={[0, -8]}>{loc.name}</Tooltip>
            </Marker>
          );
        })}

        {showFlood && FLOOD_DOTS.map(([lat, lng], i) => (
          <CircleMarker
            key={`fra-dot-${i}`}
            center={[lat, lng]}
            radius={5}
            pathOptions={{
              color: FRA_COLOR.stroke,
              weight: 1,
              fillColor: FRA_COLOR.fill,
              fillOpacity: 0.85,
            }}
          />
        ))}

        {showFlood && FRA_CLUSTERS.map((cluster) => (
          <Circle
            key={cluster.id}
            center={[cluster.lat, cluster.lng]}
            radius={RADIUS_M}
            pathOptions={{
              color: FRA_COLOR.stroke,
              weight: 2,
              dashArray: "6 5",
              fillColor: FRA_COLOR.fill,
              fillOpacity: 0.07,
            }}
          >
            <Tooltip sticky direction="top">
              <strong>{cluster.label}</strong><br />{cluster.areas}
            </Tooltip>
          </Circle>
        ))}

        {showFlood && FRA_CLUSTERS.map((cluster) => (
          <Marker
            key={`fra-label-${cluster.id}`}
            position={[cluster.lat, cluster.lng]}
            icon={makeClusterLabelIcon(cluster.label, FRA_COLOR.stroke, FRA_COLOR.fill)}
          />
        ))}
      </MapContainer>

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          right: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,0.97)",
          backdropFilter: "blur(4px)",
          borderRadius: 10,
          padding: "12px 14px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          fontSize: 13,
          lineHeight: 1.7,
          minWidth: 240,
          border: "1px solid rgba(0,0,0,0.08)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>APA1 FRA Map</div>
          <button
            onClick={onLogout}
            title="Sign out"
            style={{
              background: "none",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: "2px 8px",
              fontSize: 11,
              color: "#6b7280",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign out
          </button>
        </div>
        <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 2 }}>
          Signed in as <strong>{username}</strong>
        </div>
        <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 8 }}>
          ● 5-min vehicle reach (~2.5 km)
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            userSelect: "none",
            marginBottom: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
            {CATCHMENTS.map((c, i) => {
              const { fill } = CATCHMENT_COLORS[c];
              const x = 2 + i * 2.2;
              return <circle key={c} cx={x + 1.1} cy="7" r="1.8" fill={fill} />;
            })}
          </svg>
          <span style={{ fontWeight: 600, fontSize: 12, color: "#374151" }}>
            Catchment areas (BU/CP/KG/PJ/WK)
          </span>
          <input
            type="checkbox"
            checked={showCatchments}
            onChange={(e) => setShowCatchments(e.target.checked)}
            style={{ marginLeft: "auto", cursor: "pointer", accentColor: "#6b7280" }}
          />
        </label>

        {showCatchments && (
          <div style={{ paddingLeft: 22, marginBottom: 6 }}>
            {CATCHMENTS.map((c) => {
              const { fill, stroke, text } = CATCHMENT_COLORS[c];
              return (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
                    <circle cx="6" cy="6" r="5" fill={fill} fillOpacity={0.3} stroke={stroke} strokeWidth="1.5" />
                    <circle cx="6" cy="6" r="2.5" fill={fill} />
                  </svg>
                  <span style={{ color: text, fontWeight: 500, fontSize: 11 }}>{CATCHMENT_LABELS[c]}</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 8, marginTop: 2 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              userSelect: "none",
              marginBottom: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
              <circle cx="7" cy="7" r="5" fill={FRA_COLOR.fill} fillOpacity={0.85} stroke={FRA_COLOR.stroke} strokeWidth="1.5" />
            </svg>
            <span style={{ color: FRA_COLOR.text, fontWeight: 700, fontSize: 12 }}>
              APA1 FRA (Flood Risk Areas)
            </span>
            <input
              type="checkbox"
              checked={showFlood}
              onChange={(e) => setShowFlood(e.target.checked)}
              style={{ marginLeft: "auto", cursor: "pointer", accentColor: FRA_COLOR.stroke }}
            />
          </label>

          {showFlood && (
            <div style={{ paddingLeft: 22 }}>
              {FRA_CLUSTERS.map((cluster) => (
                <div key={cluster.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 2 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, marginTop: 2 }}>
                    <circle cx="6" cy="6" r="5" fill={FRA_COLOR.fill} fillOpacity={0.1}
                      stroke={FRA_COLOR.stroke} strokeWidth="1.5" strokeDasharray="3 2" />
                  </svg>
                  <div>
                    <div style={{ color: FRA_COLOR.text, fontWeight: 700, fontSize: 11 }}>{cluster.label}</div>
                    <div style={{ color: "#6b7280", fontSize: 10, lineHeight: 1.3 }}>{cluster.areas}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 8, borderTop: "1px solid #f3f4f6", paddingTop: 6 }}>
          25 deployment points · 4 APA1 FRA vehicles
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    fetch("/manager/auth/me", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) {
          setAuth({ status: "unauthenticated" });
          return;
        }
        const data = await res.json();
        if (data.role !== "admin") {
          setAuth({ status: "forbidden", username: data.username ?? "", role: data.role ?? "" });
        } else {
          setAuth({ status: "authenticated", username: data.username });
        }
      })
      .catch(() => setAuth({ status: "unauthenticated" }));
  }, []);

  async function handleLogout() {
    try {
      await fetch("/manager/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    setAuth({ status: "unauthenticated" });
  }

  if (auth.status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          width: "100vw",
          background: "linear-gradient(135deg, #0f172a 0%, #164e63 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ color: "#94a3b8", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (auth.status === "forbidden") {
    return (
      <div
        style={{
          minHeight: "100vh",
          width: "100vw",
          background: "linear-gradient(135deg, #0f172a 0%, #164e63 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 12,
            padding: "28px 36px",
            textAlign: "center",
            maxWidth: 320,
          }}
        >
          <div style={{ color: "#fca5a5", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
            Access Denied
          </div>
          <div style={{ color: "#cbd5e1", fontSize: 13, marginBottom: 20 }}>
            Signed in as <strong>{auth.username}</strong> ({auth.role}).<br />
            Admin role required to view this page.
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 8,
              padding: "8px 20px",
              color: "#fff",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <LoginScreen
        onLogin={(username) => setAuth({ status: "authenticated", username })}
      />
    );
  }

  return <FRAMap username={auth.username} onLogout={handleLogout} />;
}
