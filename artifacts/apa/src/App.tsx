import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Circle, Tooltip, Marker, CircleMarker } from "react-leaflet";

const SG_CENTER: [number, number] = [1.3221, 103.8690];
const RADIUS_M = 2500;

type Catchment = "BU" | "CP" | "KG" | "PJ" | "WK";
const CATCHMENTS: Catchment[] = ["BU", "CP", "KG", "PJ", "WK"];

// Deployment points, flood-risk-area clusters, and flood dot coordinates —
// fetched at runtime from the authenticated GET /api/apa/fra-data instead
// of being bundled into this app's static JS chunk. See
// .scratch/full-repo-review/issues/08-apa-data-exposed-in-public-bundle.md.
interface PresetLocation {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}
interface FRACluster {
  id: string;
  label: string;
  lat: number;
  lng: number;
  areas: string;
}
interface FraData {
  presetLocations: PresetLocation[];
  catchmentLabels: Record<Catchment, string>;
  catchmentColors: Record<Catchment, { fill: string; stroke: string; text: string }>;
  locationCatchment: Record<string, Catchment>;
  fraColor: { fill: string; stroke: string; text: string };
  fraClusters: FRACluster[];
  floodDots: [number, number][];
}

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "forbidden"; username: string; role: string }
  | { status: "authenticated"; username: string };

interface MfaSetupInfo {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

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

type LoginStep = "credentials" | "mfa-challenge" | "mfa-enroll";

function LoginScreen({
  onLogin,
}: {
  onLogin: (username: string) => void;
}) {
  const [step, setStep] = useState<LoginStep>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollInfo, setEnrollInfo] = useState<MfaSetupInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "credentials") usernameRef.current?.focus();
    else codeRef.current?.focus();
  }, [step]);

  // Kick off enrollment (fetch the QR/secret) as soon as we land on that step.
  useEffect(() => {
    if (step !== "mfa-enroll" || enrollInfo) return;
    setError("");
    fetch("/manager/auth/mfa/setup", { method: "POST", credentials: "include" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Could not start MFA setup"); return; }
        setEnrollInfo({ secret: data.secret, otpauthUrl: data.otpauthUrl, qrCodeDataUrl: data.qrCodeDataUrl });
      })
      .catch(() => setError("Network error — check connection"));
  }, [step, enrollInfo]);

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
        setError(data.error ?? data.message ?? "Invalid credentials");
      } else if (data.mfaStep === "challenge") {
        setStep("mfa-challenge");
      } else if (data.mfaStep === "enroll") {
        setStep("mfa-enroll");
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

  async function handleMfaChallenge(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/manager/auth/mfa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? "Incorrect code");
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

  async function handleMfaEnrollVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/manager/auth/mfa/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? "Incorrect code");
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

  function backToCredentials() {
    setStep("credentials");
    setCode("");
    setEnrollInfo(null);
    setError("");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#fff",
    fontSize: 14,
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 6,
    letterSpacing: "0.04em",
  };
  const errorBoxStyle: React.CSSProperties = {
    background: "rgba(239,68,68,0.15)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 8,
    padding: "8px 12px",
    color: "#fca5a5",
    fontSize: 13,
    marginBottom: 16,
  };
  const linkButtonStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "center",
    marginTop: 14,
    background: "none",
    border: "none",
    color: "#94a3b8",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  function submitButtonStyle(disabled: boolean): React.CSSProperties {
    return {
      width: "100%",
      padding: "11px 0",
      borderRadius: 8,
      border: "none",
      background: disabled
        ? "rgba(6,182,212,0.4)"
        : "linear-gradient(90deg, #0e7490, #06b6d4)",
      color: "#fff",
      fontWeight: 700,
      fontSize: 14,
      cursor: disabled ? "not-allowed" : "pointer",
      letterSpacing: "0.03em",
      transition: "opacity 0.15s",
    };
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
            {step === "credentials"
              ? "Admin access required"
              : step === "mfa-challenge"
              ? "Enter your authenticator code"
              : "Two-factor setup required"}
          </div>
        </div>

        {step === "credentials" && (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>USERNAME</label>
              <input
                ref={usernameRef}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#06b6d4"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>PASSWORD</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#06b6d4"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              />
            </div>

            {error && <div style={errorBoxStyle}>{error}</div>}

            <button type="submit" disabled={loading} style={submitButtonStyle(loading)}>
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        )}

        {step === "mfa-challenge" && (
          <form onSubmit={handleMfaChallenge}>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>AUTHENTICATION CODE</label>
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                required
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#06b6d4"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              />
            </div>

            {error && <div style={errorBoxStyle}>{error}</div>}

            <button type="submit" disabled={loading} style={submitButtonStyle(loading)}>
              {loading ? "Verifying…" : "Verify"}
            </button>
            <button type="button" onClick={backToCredentials} style={linkButtonStyle}>
              Back to sign in
            </button>
          </form>
        )}

        {step === "mfa-enroll" && (
          <form onSubmit={handleMfaEnrollVerify}>
            <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
              Scan this with an authenticator app (Microsoft/Google Authenticator, etc.), or enter
              the setup key manually.
            </div>

            {enrollInfo ? (
              <>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                  <img
                    src={enrollInfo.qrCodeDataUrl}
                    alt="MFA setup QR code"
                    style={{ width: 168, height: 168, borderRadius: 8, background: "#fff", padding: 8 }}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>SETUP KEY</label>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      letterSpacing: 1,
                      wordBreak: "break-all",
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 8,
                      padding: "9px 11px",
                      color: "#fff",
                    }}
                  >
                    {enrollInfo.secret}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, marginBottom: 16 }}>
                Loading setup code…
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>ENTER THE 6-DIGIT CODE IT SHOWS</label>
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                required
                disabled={!enrollInfo}
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#06b6d4"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              />
            </div>

            {error && <div style={errorBoxStyle}>{error}</div>}

            <button type="submit" disabled={loading || !enrollInfo} style={submitButtonStyle(loading || !enrollInfo)}>
              {loading ? "Verifying…" : "Confirm & Continue"}
            </button>
            <button type="button" onClick={backToCredentials} style={linkButtonStyle}>
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function FRAMap({ username, onLogout, data }: { username: string; onLogout: () => void; data: FraData }) {
  const [showCatchments, setShowCatchments] = useState(true);
  const [showFlood, setShowFlood] = useState(true);
  const {
    presetLocations: PRESET_LOCATIONS,
    catchmentLabels: CATCHMENT_LABELS,
    catchmentColors: CATCHMENT_COLORS,
    locationCatchment: LOCATION_CATCHMENT,
    fraColor: FRA_COLOR,
    fraClusters: FRA_CLUSTERS,
    floodDots: FLOOD_DOTS,
  } = data;

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
  const [fraData, setFraData] = useState<FraData | null>(null);
  const [fraError, setFraError] = useState<string | null>(null);

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

  // Map data is fetched only once the session is confirmed authenticated —
  // it's admin-only and previously shipped in the public JS bundle
  // regardless of login state, which is the bug this fetch replaces.
  useEffect(() => {
    if (auth.status !== "authenticated" || fraData) return;
    fetch("/api/apa/fra-data", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load map data (${res.status})`);
        setFraData(await res.json());
      })
      .catch((err) => setFraError(err instanceof Error ? err.message : "Network error — check your connection"));
  }, [auth.status, fraData]);

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

  if (fraError) {
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
            Could Not Load Map
          </div>
          <div style={{ color: "#cbd5e1", fontSize: 13, marginBottom: 20 }}>{fraError}</div>
          <button
            onClick={() => setFraError(null)}
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
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!fraData) {
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
        <div style={{ color: "#94a3b8", fontSize: 14 }}>Loading map data…</div>
      </div>
    );
  }

  return <FRAMap username={auth.username} onLogout={handleLogout} data={fraData} />;
}
