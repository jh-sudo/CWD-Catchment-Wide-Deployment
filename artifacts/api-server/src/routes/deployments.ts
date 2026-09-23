import fs from "fs";
import path from "path";
import { Router } from "express";
import { eq, and, ne } from "drizzle-orm";
import {
  db,
  deploymentTeamsTable,
  deploymentSettingsTable,
  deploymentLocationsTable,
  deploymentAssignmentsTable,
  deploymentEntriesTable,
  deploymentReassignmentHistoryTable,
  deploymentVehiclePositionsTable,
  deploymentSwapRequestsTable,
  deploymentAlertsTable,
  deploymentAlertAcknowledgmentsTable,
} from "@workspace/db";
import { sendToManagers, broadcastToCrew, sendToCrewVehicle } from "./push";
import { getRadarStatus } from "../radar-monitor.js";
import { getOneMapToken } from "../lib/oneMapAuth.js";
import { logger } from "../lib/logger";
import { requireCrew, requireManager, requireAdminOrManager } from "./auth";
import { getRosterSummary } from "./rosterPlan.js";

const router = Router();

// ── State version for ETag-based conditional GETs ─────────────────────────────
// Pure in-process cache-busting for polling clients — not domain data, so it
// isn't persisted (resets to 0 on restart, same as before).
let stateVersion = 0;
function bumpState() { stateVersion++; }
// Included in the ETag alongside stateVersion so a client's cached ETag from
// before a restart/redeploy can never coincidentally match the new
// process's counter (which also restarts at 0) and produce a false 304 with
// stale deployment state. .scratch/replit-resync-2026-09-21/issues/15.
const processEpoch = Date.now();
// Per-vehicle position rate-limit: reject updates faster than 5s from same vehicle
const lastPositionTime = new Map<string, number>();

// ── Persistence ──────────────────────────────────────────────────────────────
// Every table below backs an in-memory Map/array/scalar that the rest of
// this file reads and writes synchronously, exactly as before — the Maps
// are still the source of truth *within* a running process (unchanged, so
// none of the extensive business logic below needed to change). Postgres is
// the durable backing store: every mutation also fires a background write
// so state survives restarts, closing the gap found in the core ops state
// schema ticket (deploymentEntries/vehiclePositions/swapRequests/
// activeAlert/reassignmentHistory were entirely in-memory before).
const DATA_DIR = path.join(__dirname, "..", "data");

// Fire-and-forget by design (see comment above) — the in-memory Maps stay
// the source of truth within a running process, so a failed background
// write must never block or fail the request. To reduce the odds of a
// transient Postgres error silently dropping a mutation before it's ever
// retried, failures get a few quick retries; if they all fail, the error
// is logged at error level via the structured logger (not console.error)
// so it's actually alertable in production rather than only visible in a
// raw stdout scrape.
const PERSIST_RETRY_DELAYS_MS = [200, 1000, 3000];

async function persist(fn: () => Promise<unknown>, label: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt >= PERSIST_RETRY_DELAYS_MS.length) {
        logger.error({ err, label }, `[deployments] persist failed permanently after ${attempt + 1} attempts: ${label}`);
        return;
      }
      logger.warn({ err, label, attempt }, `[deployments] persist attempt ${attempt + 1} failed, retrying: ${label}`);
      await new Promise((r) => setTimeout(r, PERSIST_RETRY_DELAYS_MS[attempt]));
    }
  }
}

// ── NEA Rain Radar helpers (unchanged — no persistence involved) ─────────────
const NEA_UA = "Mozilla/5.0 (compatible; SG-FloodTracker/1.0)";

// Exact bounds from NEA's calculatePosition function (utils1.0.js / weather-rain-area-50km page)
// 70km local Singapore radar — 217×120 px, 5-minute intervals
const RADAR_BOUNDS_70KM = {
  nw: [1.4572, 103.565] as [number, number],
  se: [1.1450, 104.130] as [number, number],
};

// Calibrated bounds for NEA's 240km national radar (480×480 px)
// Derived by basemap pixel-matching — Changi radar station centre ~(1.402°N, 104.065°E)
const RADAR_BOUNDS_240KM = {
  nw: [3.558, 101.908] as [number, number],
  se: [-0.754, 106.221] as [number, number],
};

function radarTimestamp(offsetSlots: number): { at: string; label: string } {
  const t = new Date(Date.now() - offsetSlots * 5 * 60000 + 8 * 3600000);
  const y  = t.getUTCFullYear();
  const mo = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(t.getUTCDate()).padStart(2, "0");
  const h  = String(t.getUTCHours()).padStart(2, "0");
  const m  = String(Math.floor(t.getUTCMinutes() / 5) * 5).padStart(2, "0");
  const at = `${y}${mo}${d}${h}${m}`;
  return { at, label: `${y}-${mo}-${d} ${h}:${m} SGT` };
}

function radarSlotInfo(offsetSlots: number): { url: string; at: string; label: string } {
  const { at, label } = radarTimestamp(offsetSlots);
  return {
    // 70km local Singapore radar (primary, accurate)
    url: `https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_${at}0000dBR.dpsri.png`,
    at,
    label,
  };
}

function radarWideSlotInfo(offsetSlots: number): { url: string; at: string; label: string } {
  const { at, label } = radarTimestamp(offsetSlots);
  return {
    // 240km national radar (wide context)
    url: `https://www.weather.gov.sg/files/rainarea/240km/dpsri_240km_${at}0000dBR.dpsri.png`,
    at,
    label,
  };
}

/** Returns true if the URL serves an image (tries GET, falls back to HEAD). */
async function radarUrlLive(url: string): Promise<boolean> {
  try {
    // Try GET with Range so we only pull a few bytes — fast and avoids HEAD quirks
    const r = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": NEA_UA, "Range": "bytes=0-3" },
      redirect: "follow",
    });
    if (r.ok || r.status === 206) {
      await r.arrayBuffer(); // drain
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Serve a specific frame by SGT timestamp string (YYYYMMDDHHMM)
router.get("/rain-radar", async (req, res) => {
  const atParam = req.query.at as string | undefined;
  const headers = { "User-Agent": NEA_UA };

  if (atParam && /^\d{12}$/.test(atParam)) {
    const url = `https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_${atParam}0000dBR.dpsri.png`;
    const label = `${atParam.slice(0,4)}-${atParam.slice(4,6)}-${atParam.slice(6,8)} ${atParam.slice(8,10)}:${atParam.slice(10,12)} SGT`;
    try {
      const r = await fetch(url, { redirect: "follow", headers });
      if (!r.ok || !r.headers.get("content-type")?.startsWith("image")) {
        res.status(404).json({ error: "frame not found" }); return;
      }
      const buf = await r.arrayBuffer();
      res.set({ "Content-Type": "image/png", "Access-Control-Allow-Origin": "*", "Cache-Control": "public,max-age=3600", "X-Radar-Timestamp": label });
      // buf is a binary PNG fetched from NEA's radar API, sent with an
      // explicit image/png Content-Type above — not HTML, no escaping applies.
      res.send(Buffer.from(buf)); return; // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    } catch { res.status(502).json({ error: "radar fetch failed" }); return; }
  }

  // No slot specified → find latest available (NEA publishes ~10 min late, try up to 8 slots back)
  try {
    for (let i = 0; i <= 8; i++) {
      const { url, at, label } = radarSlotInfo(i);
      const r = await fetch(url, { redirect: "follow", headers });
      if (!r.ok || !r.headers.get("content-type")?.startsWith("image")) continue;
      const buf = await r.arrayBuffer();
      res.set({ "Content-Type": "image/png", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache,no-store", "X-Radar-Timestamp": label, "X-Radar-At": at });
      // buf is a binary PNG fetched from NEA's radar API, sent with an
      // explicit image/png Content-Type above — not HTML, no escaping applies.
      res.send(Buffer.from(buf)); return; // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    }
    res.status(502).json({ error: "radar unavailable" });
  } catch {
    res.status(502).json({ error: "radar fetch failed" });
  }
});

// Current radar monitor status (last analysis result + next check time)
router.get("/rain-radar/status", (_req, res) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache,no-store" });
  res.json(getRadarStatus());
});

// Return metadata for the 6 most recent available frames (for animation preloading)
// Returns primary (70km) bounds, wide (240km) bounds, and frame timestamps
router.get("/rain-radar/frames", async (_req, res) => {
  try {
    // Find the latest available slot using lightweight range-GET (avoids HEAD blocks)
    let latestOffset = -1;
    for (let i = 0; i <= 10; i++) {
      const { url } = radarSlotInfo(i);
      if (await radarUrlLive(url)) { latestOffset = i; break; }
    }
    if (latestOffset < 0) { res.status(502).json({ error: "radar unavailable" }); return; }
    // Return 6 frames: latest + 5 preceding slots
    const frames = Array.from({ length: 6 }, (_, k) => {
      const { at, label } = radarSlotInfo(latestOffset + k);
      return { at, label };
    });
    res.set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache,no-store" });
    res.json({
      frames,
      bounds: RADAR_BOUNDS_70KM,       // primary 70km — accurate Singapore coverage
      wideBounds: RADAR_BOUNDS_240KM,  // secondary 240km — regional context
    });
  } catch {
    res.status(502).json({ error: "frames fetch failed" });
  }
});

// Serve a specific 240km wide-area radar frame
router.get("/rain-radar-wide", async (req, res) => {
  const atParam = req.query.at as string | undefined;
  const headers = { "User-Agent": NEA_UA };

  if (atParam && /^\d{12}$/.test(atParam)) {
    const url = `https://www.weather.gov.sg/files/rainarea/240km/dpsri_240km_${atParam}0000dBR.dpsri.png`;
    const label = `${atParam.slice(0,4)}-${atParam.slice(4,6)}-${atParam.slice(6,8)} ${atParam.slice(8,10)}:${atParam.slice(10,12)} SGT`;
    try {
      const r = await fetch(url, { redirect: "follow", headers });
      if (!r.ok || !r.headers.get("content-type")?.startsWith("image")) {
        res.status(404).json({ error: "frame not found" }); return;
      }
      const buf = await r.arrayBuffer();
      res.set({ "Content-Type": "image/png", "Access-Control-Allow-Origin": "*", "Cache-Control": "public,max-age=3600", "X-Radar-Timestamp": label });
      // buf is a binary PNG fetched from NEA's radar API, sent with an
      // explicit image/png Content-Type above — not HTML, no escaping applies.
      res.send(Buffer.from(buf)); return; // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    } catch { res.status(502).json({ error: "radar fetch failed" }); return; }
  }

  // No slot specified → find latest available
  try {
    for (let i = 0; i <= 8; i++) {
      const { url, at, label } = radarWideSlotInfo(i);
      const r = await fetch(url, { redirect: "follow", headers });
      if (!r.ok || !r.headers.get("content-type")?.startsWith("image")) continue;
      const buf = await r.arrayBuffer();
      res.set({ "Content-Type": "image/png", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache,no-store", "X-Radar-Timestamp": label, "X-Radar-At": at });
      // buf is a binary PNG fetched from NEA's radar API, sent with an
      // explicit image/png Content-Type above — not HTML, no escaping applies.
      res.send(Buffer.from(buf)); return; // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    }
    res.status(502).json({ error: "radar unavailable" });
  } catch {
    res.status(502).json({ error: "radar fetch failed" });
  }
});

// ── OneMap Singapore search proxy (no API key needed, great postal code support) ──
router.get("/search/sg", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q) { res.json({ results: [] }); return; }
  try {
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const r = await fetch(url);
    const json = await r.json() as {
      found: number;
      results?: Array<{
        SEARCHVAL: string; ADDRESS: string; BUILDING: string;
        BLK_NO: string; ROAD_NAME: string; POSTAL: string;
        LATITUDE: string; LONGITUDE: string;
      }>;
    };
    const results = (json.results ?? []).slice(0, 8).map(item => {
      const building = item.BUILDING !== "NIL" ? item.BUILDING : "";
      const label = building || `${item.BLK_NO} ${item.ROAD_NAME}`.trim();
      return { label, sub: item.ADDRESS, lat: parseFloat(item.LATITUDE), lng: parseFloat(item.LONGITUDE) };
    });
    res.json({ results });
  } catch {
    res.json({ results: [] });
  }
});

interface OneMapGeocodeResult {
  BUILDINGNAME?: string;
  BLOCK?: string;
  ROAD?: string;
  POSTALCODE?: string;
}

// OneMap uses the literal string "NIL" as its no-value sentinel across
// BUILDINGNAME/BLOCK/ROAD/POSTALCODE (confirmed against a live response,
// not assumed) — normalized away here so nothing downstream has to
// special-case it.
function nilToUndefined(v: string | undefined): string | undefined {
  return v && v !== "NIL" ? v : undefined;
}

/** Reverse-geocode via OneMap Singapore (official .gov.sg source) instead
 * of a non-government third party. Requires a bearer token — see
 * lib/oneMapAuth.ts for the transparent 3-day-refresh handling.
 * .scratch/replit-resync-2026-09-21 (external-API confidentiality audit,
 * 2026-09-22). */
async function reverseGeocodeOneMap(lat: number, lng: number): Promise<OneMapGeocodeResult | null> {
  try {
    const token = await getOneMapToken();
    const url = `https://www.onemap.gov.sg/api/public/revgeocode?location=${lat},${lng}&buffer=40&addressType=All&otherFeatures=N`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "CWDFloodOps/1.0 (flood-ops-sg)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { GeocodeInfo?: OneMapGeocodeResult[] };
    const info = data.GeocodeInfo?.[0];
    if (!info) return null;
    return {
      BUILDINGNAME: nilToUndefined(info.BUILDINGNAME),
      BLOCK: nilToUndefined(info.BLOCK),
      ROAD: nilToUndefined(info.ROAD),
      POSTALCODE: nilToUndefined(info.POSTALCODE),
    };
  } catch {
    return null;
  }
}

// Reverse geocode a point to a human-readable address — used by any
// map-pin-drop flow that needs an address auto-filled from coordinates.
// .scratch/replit-resync-2026-09-21/issues/27.
router.get("/search/sg/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 1.1 || lat > 1.6 || lng < 103.5 || lng > 104.2) {
    res.status(400).json({ error: "Valid Singapore coordinates are required" });
    return;
  }
  const info = await reverseGeocodeOneMap(lat, lng);
  const blockRoad = [info?.BLOCK, info?.ROAD].filter(Boolean).join(" ");
  const withPostal = blockRoad && info?.POSTALCODE ? `${blockRoad}, Singapore ${info.POSTALCODE}` : blockRoad;
  const address = info?.BUILDINGNAME || withPostal || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  res.json({ address });
});

interface PresetLocation {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  region?: string;
  priority?: number;
  tier?: 1 | 2;
}

interface DeploymentEntry {
  locationId: string;
  vehicleId: string;
  vehicleNumber: string;
  unitCode: string;
  partner: string;
  shift: string;
  acceptedAt: string;
  eta: string;
  etaMinutes: number;
  arrived: boolean;
  arrivedAt: string | null;
  weather: string | null;
  fromRoad: string | null;
  assignedBy?: string | null;
  previousLocationId?: string | null;
  previousLocationName?: string | null;
  reassignedAt?: string | null;
}

interface ReassignmentRecord {
  vehicleId: string;
  vehicleNumber: string;
  unitCode: string;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  reassignedAt: string;
  reassignedBy?: string | null;
}

const reassignmentHistory: ReassignmentRecord[] = [];

interface VehiclePosition {
  vehicleId: string;
  vehicleNumber: string;
  unitCode: string;
  partner?: string;
  shift?: string;
  lat: number;
  lng: number;
  updatedAt: string;
  acceptedLocationId: string | null;
}

// ── Load locations from CSV (data/locations.csv) — unchanged, static seed ────
const LOCATIONS_CSV = path.join(DATA_DIR, "locations.csv");

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function loadLocationsFromCSV(): PresetLocation[] {
  try {
    if (!fs.existsSync(LOCATIONS_CSV)) return [];
    const lines = fs.readFileSync(LOCATIONS_CSV, "utf8").split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase().split(",");
    const idx = (col: string) => header.indexOf(col);
    const ni = idx("name"), ri = idx("region"), pi = idx("priority"), lai = idx("latitude"), loi = idx("longitude"), ti = idx("tier");
    return lines.slice(1).map(line => {
      const c = line.split(",");
      const name = c[ni]?.trim() ?? "";
      const region = c[ri]?.trim() ?? "";
      const priority = parseInt(c[pi]?.trim() ?? "0") || 0;
      const lat = parseFloat(c[lai]?.trim() ?? "0");
      const lng = parseFloat(c[loi]?.trim() ?? "0");
      // Tier column is optional — absent (or anything but "2") defaults to
      // Tier 1, matching every `loc.tier ?? 1` fallback read elsewhere.
      const tier: 1 | 2 = (ti >= 0 ? parseInt(c[ti]?.trim() ?? "1") : 1) === 2 ? 2 : 1;
      if (!name || !lat || !lng) return null;
      return { id: slugify(name), name, address: `${name}, Singapore`, lat, lng, region, priority, tier } as PresetLocation;
    }).filter(Boolean) as PresetLocation[];
  } catch {
    return [];
  }
}

const PRESET_LOCATIONS: PresetLocation[] = loadLocationsFromCSV();
const PRESET_LOCATION_IDS = new Set(PRESET_LOCATIONS.map((p) => p.id));

interface Assignment {
  vehicleId: string;
  vehicleNumber: string;
  unitCode: string;
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  assignedAt: string;
  status: "pending" | "accepted" | "declined";
  assignedBy?: string | null;
  previousLocationId?: string | null;
  previousLocationName?: string | null;
}

const deploymentEntries = new Map<string, DeploymentEntry>();
const vehiclePositions = new Map<string, VehiclePosition>();

// ── Entry helpers (composite key: locationId:vehicleId) ───────────────────────
function eKey(locationId: string, vehicleId: string) { return `${locationId}:${vehicleId}`; }
function getEntry(locationId: string, vehicleId: string) { return deploymentEntries.get(eKey(locationId, vehicleId)); }
function setEntry(entry: DeploymentEntry) {
  deploymentEntries.set(eKey(entry.locationId, entry.vehicleId), entry);
  const row = {
    ...entry,
    acceptedAt: new Date(entry.acceptedAt),
    reassignedAt: entry.reassignedAt ? new Date(entry.reassignedAt) : null,
  };
  persist(
    () => db.insert(deploymentEntriesTable).values(row).onConflictDoUpdate({
      target: [deploymentEntriesTable.locationId, deploymentEntriesTable.vehicleId],
      set: row,
    }),
    `entry ${entry.locationId}:${entry.vehicleId}`,
  );
}
/** Remove all entries for a vehicle except at the given locationId (pass undefined to remove all) */
function removeVehicleEntries(vehicleId: string, exceptLocationId?: string) {
  for (const [key, e] of deploymentEntries.entries()) {
    if (e.vehicleId === vehicleId && e.locationId !== exceptLocationId) {
      deploymentEntries.delete(key);
      clearWeatherReminder(vehicleId);
      persist(
        () => db.delete(deploymentEntriesTable).where(
          and(eq(deploymentEntriesTable.locationId, e.locationId), eq(deploymentEntriesTable.vehicleId, vehicleId)),
        ),
        `remove entry ${e.locationId}:${vehicleId}`,
      );
    }
  }
}

/** Server-side reverse geocode via OneMap (see reverseGeocodeOneMap above). */
async function geocodeRoadName(lat: number, lng: number): Promise<string | null> {
  const info = await reverseGeocodeOneMap(lat, lng);
  return info?.ROAD ?? null;
}
const customLocations = new Map<string, PresetLocation>(
  PRESET_LOCATIONS.map((l) => [l.id, l])
);
const assignments = new Map<string, Assignment>();

function persistLocation(loc: PresetLocation) {
  // Presets are CSV-seeded, never persisted — matches the original saveState()
  // filter (`!PRESET_LOCATIONS.find(...)`).
  if (PRESET_LOCATION_IDS.has(loc.id)) return;
  persist(
    () => db.insert(deploymentLocationsTable).values(loc).onConflictDoUpdate({
      target: deploymentLocationsTable.id,
      set: loc,
    }),
    `location ${loc.id}`,
  );
}
function deleteLocationRow(id: string) {
  if (PRESET_LOCATION_IDS.has(id)) return;
  persist(() => db.delete(deploymentLocationsTable).where(eq(deploymentLocationsTable.id, id)), `delete location ${id}`);
}

function setAssignment(a: Assignment) {
  assignments.set(a.vehicleId, a);
  persist(
    () => db.insert(deploymentAssignmentsTable).values({ ...a, assignedAt: new Date(a.assignedAt) })
      .onConflictDoUpdate({ target: deploymentAssignmentsTable.vehicleId, set: { ...a, assignedAt: new Date(a.assignedAt) } }),
    `assignment ${a.vehicleId}`,
  );
}
function deleteAssignment(vehicleId: string) {
  assignments.delete(vehicleId);
  persist(() => db.delete(deploymentAssignmentsTable).where(eq(deploymentAssignmentsTable.vehicleId, vehicleId)), `delete assignment ${vehicleId}`);
}

// ── Weather reminder timers (per vehicleId) ───────────────────────────────────
const weatherReminderTimers = new Map<string, ReturnType<typeof setInterval>>();
function clearWeatherReminder(vehicleId: string) {
  const t = weatherReminderTimers.get(vehicleId);
  if (t) { clearInterval(t); weatherReminderTimers.delete(vehicleId); }
}
function startWeatherReminder(vehicleId: string, unitCode: string, locationName: string) {
  clearWeatherReminder(vehicleId); // reset if already running
  const timer = setInterval(() => {
    sendToCrewVehicle(vehicleId, {
      title: "🌦 Weather Update Required",
      body: `Please report current conditions at ${locationName}`,
      tag: `weather-reminder-${vehicleId}`,
      url: "/",
    }).catch(() => {});
  }, 15 * 60 * 1000);
  weatherReminderTimers.set(vehicleId, timer);
}

interface SwapRequest {
  id: string;
  fromVehicleId: string;
  fromUnitCode: string;
  fromVehicleNumber: string;
  fromLocationId: string;
  fromLocationName: string;
  toVehicleId: string;
  toUnitCode: string;
  toVehicleNumber: string;
  toLocationId: string;
  toLocationName: string;
  createdAt: string;
}
const swapRequests = new Map<string, SwapRequest>();
function setSwapRequest(sr: SwapRequest) {
  swapRequests.set(sr.id, sr);
  persist(
    () => db.insert(deploymentSwapRequestsTable).values({ ...sr, createdAt: new Date(sr.createdAt) })
      .onConflictDoUpdate({ target: deploymentSwapRequestsTable.id, set: { ...sr, createdAt: new Date(sr.createdAt) } }),
    `swap request ${sr.id}`,
  );
}
function deleteSwapRequest(id: string) {
  swapRequests.delete(id);
  persist(() => db.delete(deploymentSwapRequestsTable).where(eq(deploymentSwapRequestsTable.id, id)), `delete swap request ${id}`);
}

function defaultDeploymentDate(): string {
  return new Date().toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
}
let deploymentDate = defaultDeploymentDate();

// ── Roster ────────────────────────────────────────────────────────────────────
interface RosterTeam {
  id: string;
  vehicleId: string;
  unitCode: string;
  vehicleNumber: string;
  partner: string;
  shift: string;
}
let currentRoster: RosterTeam[] = [];
let activeShifts: string[] = ["DAY", "PD", "ND"];
let activeTeams: string[] = []; // empty = all teams

function persistRoster() {
  persist(async () => {
    await db.delete(deploymentTeamsTable);
    if (currentRoster.length > 0) await db.insert(deploymentTeamsTable).values(currentRoster);
  }, "roster");
}
function persistSettings() {
  persist(
    () => db.insert(deploymentSettingsTable).values({ id: 1, activeShifts, activeTeams, deploymentDate })
      .onConflictDoUpdate({ target: deploymentSettingsTable.id, set: { activeShifts, activeTeams, deploymentDate } }),
    "settings",
  );
}

// ── Active Alert ──────────────────────────────────────────────────────────────
interface AlertRecord {
  id: string;
  extracted: string;
  broadcastAt: string;
  acknowledgments: string[];
}
let activeAlert: AlertRecord | null = null;

// ── Hydrate all in-memory state from Postgres at boot ─────────────────────────
// Replaces loadState(). Fire-and-forget at module load, same pattern as the
// rest of this codebase's boot-time async loads (e.g. auth.ts's seedAdmin) —
// a request arriving before this completes sees empty state, same risk
// profile as before.
async function hydrateFromDb(): Promise<void> {
  const [teams, settings, locations, assignmentRows, entryRows, reassignRows, positionRows, swapRows, alertRows, ackRows] =
    await Promise.all([
      db.select().from(deploymentTeamsTable),
      db.select().from(deploymentSettingsTable).where(eq(deploymentSettingsTable.id, 1)),
      db.select().from(deploymentLocationsTable),
      db.select().from(deploymentAssignmentsTable),
      db.select().from(deploymentEntriesTable),
      db.select().from(deploymentReassignmentHistoryTable),
      db.select().from(deploymentVehiclePositionsTable),
      db.select().from(deploymentSwapRequestsTable),
      db.select().from(deploymentAlertsTable),
      db.select().from(deploymentAlertAcknowledgmentsTable),
    ]);

  if (teams.length > 0) currentRoster = teams;
  const s = settings[0];
  if (s) {
    if (s.activeShifts.length) activeShifts = s.activeShifts;
    activeTeams = s.activeTeams;
    deploymentDate = s.deploymentDate;
  }
  for (const loc of locations) {
    customLocations.set(loc.id, { ...loc, region: loc.region ?? undefined, priority: loc.priority ?? undefined });
  }
  for (const a of assignmentRows) {
    assignments.set(a.vehicleId, {
      ...a,
      status: a.status as Assignment["status"],
      assignedAt: a.assignedAt.toISOString(),
      assignedBy: a.assignedBy ?? undefined,
      previousLocationId: a.previousLocationId ?? undefined,
      previousLocationName: a.previousLocationName ?? undefined,
    });
  }
  for (const e of entryRows) {
    deploymentEntries.set(eKey(e.locationId, e.vehicleId), { ...e, acceptedAt: e.acceptedAt.toISOString(), reassignedAt: e.reassignedAt?.toISOString() ?? null });
  }
  reassignmentHistory.push(...reassignRows.map((r) => ({ ...r, reassignedAt: r.reassignedAt.toISOString() })));
  for (const p of positionRows) {
    vehiclePositions.set(p.vehicleId, {
      ...p,
      partner: p.partner ?? undefined,
      shift: p.shift ?? undefined,
      updatedAt: p.updatedAt.toISOString(),
    });
  }
  for (const sr of swapRows) swapRequests.set(sr.id, { ...sr, createdAt: sr.createdAt.toISOString() });

  // activeAlert = the most recently broadcast alert (deployment_alerts keeps
  // full history now; this mirrors the old single-pointer semantic on top).
  const latestAlert = alertRows.sort((a, b) => b.broadcastAt.getTime() - a.broadcastAt.getTime())[0];
  if (latestAlert) {
    activeAlert = {
      id: latestAlert.id,
      extracted: latestAlert.extracted,
      broadcastAt: latestAlert.broadcastAt.toISOString(),
      acknowledgments: ackRows.filter((a) => a.alertId === latestAlert.id).map((a) => a.unitCode),
    };
  }
}
// Exported so index.ts can await it before app.listen() — otherwise a
// request arriving in the gap between module load and hydration completing
// sees empty state even though Postgres has full data.
export const deploymentsReady: Promise<void> = hydrateFromDb().catch((err) => {
  logger.error({ err }, "[deployments] hydrate failed");
});

function parseDateFromRoster(text: string): string | null {
  const MONTH_MAP: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  const re = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\s*(\\d{4})?\\b`, "i");
  const m = text.match(re);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthNum = MONTH_MAP[m[2].slice(0, 3).toLowerCase()];
  if (!monthNum) return null;
  const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  const d = new Date(year, monthNum - 1, day);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-SG", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Singapore" });
}

function parseRoster(text: string): { teams: RosterTeam[]; duplicateUnits: string[] } {
  // Keyed by unitCode (not the composed id, which also embeds the vehicle
  // number) so a corrected line pasted after an original for the SAME unit —
  // even with a different or corrected vehicle number — replaces it instead
  // of producing two team entries for one unit. Last line for a given unit
  // wins. .scratch/replit-resync-2026-09-21/issues/15.
  const byUnit = new Map<string, RosterTeam>();
  const duplicateUnits = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // Must start with a unit code: BU1, PJ3, WK1, CP2, KG1, etc.
    const unitMatch = line.match(/^([A-Z]{1,4}\d+)/i);
    if (!unitMatch) continue;
    const unitCode = unitMatch[1].toUpperCase();

    // Shift is whatever is inside the first set of parentheses — (DAY), (ND), (PD), (NIGHT), etc.
    const shiftMatch = line.match(/\(([^)]+)\)/);
    if (!shiftMatch) continue;
    const shift = shiftMatch[1].trim().toUpperCase();

    // Names are the text between the colon and the opening parenthesis
    const namesMatch = line.match(/:\s*(.+?)\s*\(/);
    if (!namesMatch) continue;
    const partner = namesMatch[1].trim();

    // Vehicle number is optional — alphanumeric word between unit code and colon
    const vehicleMatch = line.match(/^[A-Z]{1,4}\d+\s+([A-Z0-9]{4,})\s*:/i);
    const vehicleNumber = vehicleMatch ? vehicleMatch[1].toUpperCase() : "";

    if (byUnit.has(unitCode)) duplicateUnits.add(unitCode);
    byUnit.set(unitCode, {
      id: `${unitCode}-${vehicleNumber || "NA"}`,
      vehicleId: `${unitCode}-${vehicleNumber || "NA"}`,
      unitCode,
      vehicleNumber,
      partner,
      shift,
    });
  }
  return { teams: Array.from(byUnit.values()), duplicateUnits: Array.from(duplicateUnits) };
}

function extractAlertText(raw: string): string {
  const parts = raw.split(/[-]{3,}/);
  if (parts.length >= 3) {
    return parts.slice(1, -1).join("").split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("Frm:") && !/automated message/i.test(l))
      .join("\n").trim();
  }
  return raw
    .replace(/National Environment Agency/gi, "")
    .replace(/This is an automated.*$/gis, "")
    .trim();
}

function getActiveLocations(): PresetLocation[] {
  return Array.from(customLocations.values());
}

function weatherEmoji(weather: string | null): string {
  if (!weather) return "";
  if (weather === "Heavy Rain") return " 🔴";
  if (weather === "Moderate Rain") return " 🟠";
  if (weather === "Light Rain") return " 🟢";
  if (weather === "Nil Rain") return " 🟢";
  return "";
}

router.get("/deployments/state", requireManager, async (req, res) => {
  await syncDeploymentRosterFromCentralSource();
  const etag = `"v${stateVersion}-${processEpoch}"`;
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "no-cache");
  res.json({
    deploymentDate,
    presetLocations: getActiveLocations(),
    entries: Array.from(deploymentEntries.values()),
    vehicles: Array.from(vehiclePositions.values()),
    assignments: Array.from(assignments.values()),
    swapRequests: Array.from(swapRequests.values()),
    rosterTeams: currentRoster,
    activeAlert,
    activeShifts,
    activeTeams,
    reassignmentHistory,
  });
});

// When a roster reimport changes a unit's vehicle (vehicleId embeds the
// vehicle number: `${unitCode}-${vehicleNumber}`), migrate that unit's live
// deployment state to the new identity instead of leaving it orphaned under
// the old vehicleId — a "ghost" entry/assignment/position that never shows
// up again — and instead of letting a crew device that pings its position
// under the old id recreate a stale vehicle entry after the reimport. Only
// handles units whose vehicle identity actually changed; a unit removed
// from the roster entirely is out of scope here.
// .scratch/replit-resync-2026-09-21/issues/15.
function reconcileDeploymentStateWithRoster(previous: RosterTeam[], next: RosterTeam[]): void {
  const nextByUnit = new Map(next.map((t) => [t.unitCode, t]));
  for (const prevTeam of previous) {
    const nextTeam = nextByUnit.get(prevTeam.unitCode);
    if (!nextTeam || nextTeam.vehicleId === prevTeam.vehicleId) continue;
    const oldId = prevTeam.vehicleId;
    const newId = nextTeam.vehicleId;

    const oldAssignment = assignments.get(oldId);
    if (oldAssignment) {
      deleteAssignment(oldId);
      setAssignment({ ...oldAssignment, vehicleId: newId, vehicleNumber: nextTeam.vehicleNumber, unitCode: nextTeam.unitCode });
    }

    const oldPos = vehiclePositions.get(oldId);
    if (oldPos) {
      vehiclePositions.delete(oldId);
      const migratedPos: VehiclePosition = { ...oldPos, vehicleId: newId, vehicleNumber: nextTeam.vehicleNumber, unitCode: nextTeam.unitCode };
      vehiclePositions.set(newId, migratedPos);
      persist(
        () => db.insert(deploymentVehiclePositionsTable)
          .values({ ...migratedPos, updatedAt: new Date(migratedPos.updatedAt) })
          .onConflictDoUpdate({ target: deploymentVehiclePositionsTable.vehicleId, set: { ...migratedPos, updatedAt: new Date(migratedPos.updatedAt) } }),
        `migrate position ${oldId} -> ${newId}`,
      );
      persist(
        () => db.delete(deploymentVehiclePositionsTable).where(eq(deploymentVehiclePositionsTable.vehicleId, oldId)),
        `delete stale position ${oldId}`,
      );
    }

    for (const [key, entry] of Array.from(deploymentEntries.entries())) {
      if (entry.vehicleId !== oldId) continue;
      deploymentEntries.delete(key);
      const migrated: DeploymentEntry = { ...entry, vehicleId: newId, vehicleNumber: nextTeam.vehicleNumber, unitCode: nextTeam.unitCode };
      setEntry(migrated);
      persist(
        () => db.delete(deploymentEntriesTable).where(
          and(eq(deploymentEntriesTable.locationId, entry.locationId), eq(deploymentEntriesTable.vehicleId, oldId)),
        ),
        `delete stale entry ${entry.locationId}:${oldId}`,
      );
    }
  }
}

function singaporeDateISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Auto-pulls today's roster from rosterPlan's own FIRB summary into the live
// deployment roster, instead of requiring a manual paste-import every day.
// Only touches state when the central roster actually differs from what's
// currently loaded here (normalized comparison), so this is safe to call on
// every read without generating unnecessary Postgres writes.
// .scratch/replit-resync-2026-09-21/issues/27.
async function syncDeploymentRosterFromCentralSource(): Promise<void> {
  const date = singaporeDateISO();
  const summaryText = await getRosterSummary(date);
  const { teams } = parseRoster(summaryText);
  if (teams.length === 0) return;

  const normalized = (list: RosterTeam[]) =>
    [...list]
      .sort((a, b) => a.unitCode.localeCompare(b.unitCode))
      .map(({ unitCode, vehicleNumber, partner, shift }) => ({ unitCode, vehicleNumber, partner, shift }));

  if (JSON.stringify(normalized(currentRoster)) === JSON.stringify(normalized(teams))) return;

  const previousRoster = currentRoster;
  currentRoster = teams;
  deploymentDate = new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Singapore",
  });
  reconcileDeploymentStateWithRoster(previousRoster, currentRoster);
  bumpState();
  persistRoster();
  persistSettings();
}

// ── Roster endpoints ──────────────────────────────────────────────────────────
// Factored out of the route handler so autoDeployment.ts can trigger the same
// import path directly (in-process function call) rather than an internal
// HTTP self-call requiring its own auth story.
// .scratch/replit-resync-2026-09-21/issues/32.
export function importRosterText(text: string, merge?: boolean): {
  count: number; teams: RosterTeam[]; deploymentDate: string; duplicateUnits: string[];
} | { error: string; message: string } {
  const { teams, duplicateUnits } = parseRoster(text);
  if (!teams.length) {
    return { error: "no_teams", message: "No valid team lines found. Format: BU1 TST0004A: Name & Name (DAY)" };
  }
  const previousRoster = currentRoster;
  if (merge && currentRoster.length > 0) {
    // Merge: update existing entries by id, append new ones — never wipes existing teams
    const existingMap = new Map(currentRoster.map(t => [t.id, t]));
    for (const t of teams) existingMap.set(t.id, t);
    currentRoster = Array.from(existingMap.values());
  } else {
    currentRoster = teams;
  }
  reconcileDeploymentStateWithRoster(previousRoster, currentRoster);
  const rosterDate = parseDateFromRoster(text);
  if (rosterDate) deploymentDate = rosterDate;
  bumpState();
  persistRoster();
  persistSettings();
  return { count: teams.length, teams: currentRoster, deploymentDate, duplicateUnits };
}

router.post("/roster/import", requireManager, (req, res) => {
  const { text, merge } = req.body as { text: string; merge?: boolean };
  if (!text) { res.status(400).json({ error: "text required" }); return; }
  const result = importRosterText(text, merge);
  if ("error" in result) { res.status(400).json(result); return; }
  res.json({ success: true, ...result });
});

router.get("/roster", async (req, res) => {
  await syncDeploymentRosterFromCentralSource();
  res.json({ teams: currentRoster });
});

export function clearRoster(): void {
  currentRoster = [];
  bumpState();
  persistRoster();
}

router.delete("/roster", requireManager, (req, res) => {
  clearRoster();
  res.json({ success: true });
});

// .scratch/replit-resync-2026-09-21/issues/32 — factored out for autoDeployment.ts.
export function setActiveShiftsFiltered(shifts: string[]): string[] {
  activeShifts = shifts.filter(s => ["DAY", "PD", "ND"].includes(s));
  if (activeShifts.length === 0) activeShifts = ["DAY", "PD", "ND"];
  persistSettings();
  return activeShifts;
}

router.post("/roster/active-shifts", (req, res) => {
  const { shifts } = req.body as { shifts: string[] };
  if (!Array.isArray(shifts) || shifts.length === 0) {
    res.status(400).json({ error: "shifts array required (e.g. [\"DAY\",\"PD\"])" });
    return;
  }
  res.json({ success: true, activeShifts: setActiveShiftsFiltered(shifts) });
});

router.post("/roster/active-teams", (req, res) => {
  const { teams } = req.body as { teams: string[] };
  if (!Array.isArray(teams)) {
    res.status(400).json({ error: "teams array required (e.g. [\"BU\",\"KG\"]) or [] for all" });
    return;
  }
  const VALID = ["BU", "PJ", "WK", "CP", "KG"];
  activeTeams = teams.filter(t => VALID.includes(t));
  persistSettings();
  res.json({ success: true, activeTeams });
});

// ── Alert endpoints ───────────────────────────────────────────────────────────
// .scratch/replit-resync-2026-09-21/issues/32 — factored out for autoDeployment.ts.
export function broadcastAlertText(text: string): string {
  const extracted = extractAlertText(text);
  activeAlert = {
    id: Date.now().toString(),
    extracted,
    broadcastAt: new Date().toISOString(),
    acknowledgments: [],
  };
  bumpState();
  // Alerts are kept as full history (deployment_alerts), not overwritten —
  // see the core ops state schema ticket's decision.
  persist(
    () => db.insert(deploymentAlertsTable).values({
      id: activeAlert!.id, extracted, broadcastAt: new Date(activeAlert!.broadcastAt),
    }),
    `alert ${activeAlert.id}`,
  );

  // Push to managers and all crew
  const pushPayload = {
    title: "⚠️ NEA Weather Alert",
    body: extracted.length > 120 ? extracted.slice(0, 117) + "…" : extracted,
    tag: "nea-alert",
    url: "/manager",
  };
  sendToManagers(pushPayload).catch(() => {});
  broadcastToCrew({ ...pushPayload, url: "/" }).catch(() => {});
  return extracted;
}

router.post("/alert/broadcast", requireManager, (req, res) => {
  const { text } = req.body as { text: string };
  if (!text) { res.status(400).json({ error: "text required" }); return; }
  const extracted = broadcastAlertText(text);
  res.json({ success: true, extracted });
});

router.get("/alert", (req, res) => {
  res.json(activeAlert || null);
});

router.post("/alert/acknowledge", requireCrew, (req, res) => {
  if (!activeAlert) { res.status(404).json({ error: "no_active_alert" }); return; }
  const { unitCode } = req.body as { unitCode: string };
  if (unitCode && !activeAlert.acknowledgments.includes(unitCode)) {
    activeAlert.acknowledgments.push(unitCode);
    // acknowledged_at is a new column (see the core ops state schema ticket) —
    // not present in the original AlertRecord shape, only in the DB row.
    persist(
      () => db.insert(deploymentAlertAcknowledgmentsTable).values({
        alertId: activeAlert!.id, unitCode, acknowledgedAt: new Date(),
      }).onConflictDoNothing(),
      `alert ack ${activeAlert.id}:${unitCode}`,
    );
  }
  res.json({ success: true, count: activeAlert.acknowledgments.length });
});

router.delete("/alert", requireManager, (req, res) => {
  // Clears only the in-memory "current" pointer — the broadcast history in
  // deployment_alerts is intentionally not deleted (accountability record).
  activeAlert = null;
  bumpState();
  res.json({ success: true });
});

router.post("/deployments/accept", requireCrew, async (req, res) => {
  const { vehicleId, vehicleNumber, unitCode, partner, shift, locationId, eta, etaMinutes, fromRoad } = req.body as AcceptLocationRequest;
  logger.info({ officer: req.officer, vehicleId, locationId }, "[deployments] accept");

  if (!vehicleId || !vehicleNumber || !unitCode || !locationId) {
    res.status(400).json({ error: "bad_request", message: "Missing required fields" });
    return;
  }

  // One vehicle → one location: remove this vehicle's entries at any OTHER location
  removeVehicleEntries(vehicleId, locationId);

  // Server-side geocoding fallback: if client didn't supply fromRoad, use tracked position
  let resolvedFromRoad = fromRoad ?? null;
  if (!resolvedFromRoad) {
    const pos = vehiclePositions.get(vehicleId);
    if (pos) {
      resolvedFromRoad = await geocodeRoadName(pos.lat, pos.lng);
    }
  }

  const entry: DeploymentEntry = {
    locationId,
    vehicleId,
    vehicleNumber,
    unitCode,
    partner,
    shift,
    acceptedAt: new Date().toISOString(),
    eta,
    etaMinutes,
    arrived: false,
    arrivedAt: null,
    weather: null,
    fromRoad: resolvedFromRoad,
  };

  setEntry(entry);
  bumpState();
  res.json({ success: true, entry });
});

interface AcceptLocationRequest {
  vehicleId: string;
  vehicleNumber: string;
  unitCode: string;
  partner: string;
  shift: string;
  locationId: string;
  eta: string;
  etaMinutes: number;
  fromRoad?: string | null;
}

router.post("/deployments/position", requireCrew, (req, res) => {
  const { vehicleId: clientVehicleId, vehicleNumber: clientVehicleNumber, unitCode, partner, shift, lat, lng, acceptedLocationId, eta, etaMinutes } = req.body as {
    vehicleId: string;
    vehicleNumber: string;
    unitCode: string;
    partner?: string;
    shift?: string;
    lat: number;
    lng: number;
    acceptedLocationId: string | null;
    eta?: string;
    etaMinutes?: number;
  };

  if (!clientVehicleId || !clientVehicleNumber || !unitCode) {
    res.status(400).json({ error: "bad_request", message: "Missing required fields" });
    return;
  }

  // Re-resolve the roster-authoritative vehicleId/vehicleNumber for this unit
  // before saving — a crew device can still be caching the vehicleId from
  // before a roster reimport changed this unit's vehicle, which would
  // otherwise recreate a stale vehicle position/entry under the old
  // identity. unitCode is the stable identity here, not vehicleId.
  // .scratch/replit-resync-2026-09-21/issues/15.
  const currentTeam = currentRoster.find((t) => t.unitCode === unitCode);
  const vehicleId = currentTeam?.vehicleId ?? clientVehicleId;
  const vehicleNumber = currentTeam?.vehicleNumber ?? clientVehicleNumber;

  // Rate-limit: ignore duplicate position pings from same vehicle within 5s
  const now = Date.now();
  const lastPing = lastPositionTime.get(vehicleId);
  if (lastPing && now - lastPing < 5000) {
    res.json({ success: true, message: "Rate limited" });
    return;
  }
  lastPositionTime.set(vehicleId, now);

  const position: VehiclePosition = {
    vehicleId,
    vehicleNumber,
    unitCode,
    partner,
    shift,
    lat,
    lng,
    updatedAt: new Date().toISOString(),
    acceptedLocationId: acceptedLocationId ?? null,
  };
  vehiclePositions.set(vehicleId, position);
  persist(
    () => db.insert(deploymentVehiclePositionsTable).values({ ...position, updatedAt: new Date(position.updatedAt) })
      .onConflictDoUpdate({ target: deploymentVehiclePositionsTable.vehicleId, set: { ...position, updatedAt: new Date(position.updatedAt) } }),
    `position ${vehicleId}`,
  );

  // If live ETA is provided and vehicle has an accepted deployment entry, update it
  if (eta && acceptedLocationId) {
    const entry = getEntry(acceptedLocationId, vehicleId);
    if (entry && !entry.arrived) {
      entry.eta = eta;
      if (etaMinutes !== undefined) entry.etaMinutes = etaMinutes;
      setEntry(entry);
    }
  }

  bumpState();
  res.json({ success: true, message: "Position updated" });
});

// Mark arrival at accepted location
router.post("/deployments/arrive", requireCrew, (req, res) => {
  const { vehicleId, locationId } = req.body as { vehicleId: string; locationId: string };
  const entry = getEntry(locationId, vehicleId);
  if (!entry) {
    res.status(404).json({ error: "not_found", message: "Deployment entry not found" });
    return;
  }
  // Always record time in SGT (UTC+8) — server runs on UTC
  const sgNow = new Date(Date.now() + 8 * 3600000);
  const hrs = sgNow.getUTCHours().toString().padStart(2, "0");
  const mins = sgNow.getUTCMinutes().toString().padStart(2, "0");
  entry.arrived = true;
  entry.arrivedAt = `${hrs}${mins}`;
  setEntry(entry);
  bumpState();
  res.json({ success: true, arrivedAt: entry.arrivedAt });

  // Start 15-min weather reminder push notifications for this crew
  const arrivedLocName = customLocations.get(locationId)?.name ?? locationId;
  startWeatherReminder(vehicleId, entry.unitCode, arrivedLocName);

  // Notify managers that a vehicle has arrived
  sendToManagers({
    title: `✅ ${entry.unitCode} Arrived`,
    body: `${entry.unitCode} (${entry.vehicleNumber}) has arrived at ${arrivedLocName} at ${hrs}:${mins} SGT`,
    tag: `arrived-${vehicleId}`,
    url: "/manager",
  }).catch(() => {});
});

// Update weather condition
router.post("/deployments/weather", requireCrew, (req, res) => {
  const { vehicleId, locationId, weather } = req.body as {
    vehicleId: string;
    locationId: string;
    weather: string;
  };
  const VALID = ["Heavy Rain", "Moderate Rain", "Light Rain", "Nil Rain"];
  if (!VALID.includes(weather)) {
    res.status(400).json({ error: "bad_request", message: "Invalid weather value" });
    return;
  }
  const entry = getEntry(locationId, vehicleId);
  if (!entry) {
    res.status(404).json({ error: "not_found", message: "Deployment entry not found" });
    return;
  }
  entry.weather = weather;
  setEntry(entry);
  bumpState();
  res.json({ success: true });
});

router.get("/deployments/report", (req, res) => {
  const date = deploymentDate;
  const entries = Array.from(deploymentEntries.values());
  const deployedVehicleIds = new Set(entries.map(e => e.vehicleId));
  // Also exclude by unitCode, not just vehicleId — a unit's entry and its
  // pending assignment can end up keyed by different vehicleId strings after
  // a roster reimport changes that unit's vehicle (see the stale-identity
  // issue below), which would otherwise let both produce a report line for
  // the same unit. The materialised entry is roster-authoritative; prefer it.
  // .scratch/replit-resync-2026-09-21/issues/15.
  const deployedUnitCodes = new Set(entries.map(e => e.unitCode));

  // Include pending assignments that haven't been accepted yet
  const pendingAssignments = Array.from(assignments.values()).filter(
    a => a.status === "pending" && !deployedVehicleIds.has(a.vehicleId) && !deployedUnitCodes.has(a.unitCode)
  );

  // Build combined line list, sort all by unitCode
  type ReportLine = { unitCode: string; line: string; arrived: boolean };
  const reportLines: ReportLine[] = [];

  // Vehicles currently waiting for a swap to be accepted
  const swapPendingVehicleIds = new Set<string>();
  for (const sr of swapRequests.values()) {
    swapPendingVehicleIds.add(sr.fromVehicleId);
    swapPendingVehicleIds.add(sr.toVehicleId);
  }

  for (const entry of entries) {
    const locationName = customLocations.get(entry.locationId)?.name ?? entry.locationId;
    const timeStr = entry.arrived && entry.arrivedAt ? entry.arrivedAt : entry.eta;
    const weatherSuffix = entry.weather ? weatherEmoji(entry.weather) : "";
    const swapSuffix = swapPendingVehicleIds.has(entry.vehicleId) ? " ⇄" : "";
    const suffix = `${weatherSuffix}${swapSuffix}`;
    // Fall back to roster for partner/shift if the entry was materialised from an assignment
    const rosterTeam = (!entry.partner || !entry.shift)
      ? currentRoster.find(t => t.vehicleId === entry.vehicleId || t.id === entry.vehicleId)
      : null;
    const partner = entry.partner || rosterTeam?.partner || "—";
    const shift = entry.shift || rosterTeam?.shift || "—";
    reportLines.push({
      unitCode: entry.unitCode,
      arrived: entry.arrived,
      line: `${entry.unitCode} ${entry.vehicleNumber}: ${partner} (${shift}) - ${locationName} ${timeStr} hrs${suffix ? " " + suffix.trim() : ""}`,
    });
  }

  for (const a of pendingAssignments) {
    const roster = currentRoster.find(t => `${t.unitCode}-${t.vehicleNumber || "NA"}` === a.vehicleId);
    const partner = roster?.partner ?? "—";
    const shift = roster?.shift ?? "—";
    const locationName = customLocations.get(a.locationId)?.name ?? a.locationName;
    reportLines.push({
      unitCode: a.unitCode,
      arrived: false,
      line: `${a.unitCode} ${a.vehicleNumber}: ${partner} (${shift}) - ${locationName} [Assigned]`,
    });
  }

  reportLines.sort((a, b) => a.unitCode.localeCompare(b.unitCode));

  const arrivedCount = reportLines.filter(r => r.arrived).length;
  const totalUnits = reportLines.length;
  const summary = `📍 ${arrivedCount}/${totalUnits} arrived`;

  // Build reassignment lines: "BU1 TST0004A: Yarwood → CCK Ave 1 (1340 hrs)"
  const toHHMM = (iso: string) => {
    const d = new Date(iso);
    const h = String((d.getUTCHours() + 8) % 24).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return `${h}${m}`;
  };
  const reassignmentLines = reassignmentHistory.map(r =>
    `${r.unitCode} ${r.vehicleNumber}: ${r.fromLocationName} → ${r.toLocationName} (${toHHMM(r.reassignedAt)} hrs)${r.reassignedBy ? ` via ${r.reassignedBy}` : ""}`
  );

  res.json({ date, lines: reportLines.map(r => r.line), totalUnits, arrivedCount, summary, reassignmentLines, reassignmentHistory });
});

// ── Location Swap endpoints ────────────────────────────────────────────────────

router.post("/deployments/swap-request", requireCrew, (req, res) => {
  const { fromVehicleId, toVehicleId } = req.body as { fromVehicleId: string; toVehicleId: string };
  if (!fromVehicleId || !toVehicleId) { res.status(400).json({ error: "fromVehicleId and toVehicleId required" }); return; }

  // Helper: materialise a DeploymentEntry from an Assignment (pending crews).
  // Looks up the roster so partner and shift are never left blank.
  const entryFromAssignment = (a: Assignment): DeploymentEntry => {
    const rosterTeam = currentRoster.find(
      t => t.vehicleId === a.vehicleId || t.id === a.vehicleId
    );
    return {
      locationId: a.locationId,
      vehicleId: a.vehicleId,
      vehicleNumber: a.vehicleNumber,
      unitCode: a.unitCode,
      partner: rosterTeam?.partner ?? "",
      shift: rosterTeam?.shift ?? "",
      acceptedAt: a.assignedAt,
      eta: "",
      etaMinutes: 0,
      arrived: false,
      arrivedAt: null,
      weather: null,
      fromRoad: null,
      assignedBy: a.assignedBy ?? null,
    };
  };

  // Find both entries — fall back to pending assignments if no deployed entry yet
  let fromEntry: DeploymentEntry | undefined;
  let toEntry: DeploymentEntry | undefined;
  for (const entry of deploymentEntries.values()) {
    if (entry.vehicleId === fromVehicleId) fromEntry = entry;
    if (entry.vehicleId === toVehicleId) toEntry = entry;
  }
  if (!fromEntry) {
    const a = assignments.get(fromVehicleId);
    if (a) {
      fromEntry = entryFromAssignment(a);
      setEntry(fromEntry);
    }
  }
  if (!toEntry) {
    const a = assignments.get(toVehicleId);
    if (a) {
      toEntry = entryFromAssignment(a);
      setEntry(toEntry);
    }
  }
  if (!fromEntry) { res.status(404).json({ error: "Your deployment entry not found. Accept your assigned location first." }); return; }
  if (!toEntry) { res.status(404).json({ error: "Target vehicle has no location (deployed or assigned)." }); return; }

  // Cancel any existing swap requests from this vehicle
  for (const [id, sr] of swapRequests.entries()) {
    if (sr.fromVehicleId === fromVehicleId) deleteSwapRequest(id);
  }

  const locs = getActiveLocations();
  const fromLoc = locs.find((l) => l.id === fromEntry!.locationId);
  const toLoc = locs.find((l) => l.id === toEntry!.locationId);

  const id = `swap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const sr: SwapRequest = {
    id,
    fromVehicleId: fromEntry.vehicleId,
    fromUnitCode: fromEntry.unitCode,
    fromVehicleNumber: fromEntry.vehicleNumber,
    fromLocationId: fromEntry.locationId,
    fromLocationName: fromLoc?.name ?? fromEntry.locationId,
    toVehicleId: toEntry.vehicleId,
    toUnitCode: toEntry.unitCode,
    toVehicleNumber: toEntry.vehicleNumber,
    toLocationId: toEntry.locationId,
    toLocationName: toLoc?.name ?? toEntry.locationId,
    createdAt: new Date().toISOString(),
  };
  setSwapRequest(sr);
  bumpState();
  res.json({ success: true, swapRequestId: id });
});

router.post("/deployments/swap-accept", requireCrew, (req, res) => {
  const { swapRequestId, vehicleId } = req.body as { swapRequestId: string; vehicleId: string };
  const sr = swapRequests.get(swapRequestId);
  if (!sr) { res.status(404).json({ error: "Swap request not found or already resolved" }); return; }
  if (sr.toVehicleId !== vehicleId) { res.status(403).json({ error: "Not the target of this swap" }); return; }

  // Fetch both current entries (locations may have changed since request was made)
  const fromEntry = getEntry(sr.fromLocationId, sr.fromVehicleId);
  const toEntry   = getEntry(sr.toLocationId,   sr.toVehicleId);
  if (!fromEntry || !toEntry) { deleteSwapRequest(swapRequestId); bumpState(); res.status(409).json({ error: "One or both locations are no longer held — swap cancelled" }); return; }

  // Swap: exchange officer names only — each unit stays at its own location
  // and keeps its own duty type (shift). Only the partner (officer name) moves.
  const fromPartner = fromEntry.partner;
  setEntry({ ...fromEntry, partner: toEntry.partner });
  setEntry({ ...toEntry,   partner: fromPartner });

  // Clean up all swap requests involving either vehicle
  for (const [id, r] of swapRequests.entries()) {
    if (r.fromVehicleId === sr.fromVehicleId || r.toVehicleId === sr.fromVehicleId ||
        r.fromVehicleId === sr.toVehicleId || r.toVehicleId === sr.toVehicleId) {
      deleteSwapRequest(id);
    }
  }

  bumpState();
  res.json({ success: true });
});

router.post("/deployments/swap-decline", requireCrew, (req, res) => {
  const { swapRequestId, vehicleId } = req.body as { swapRequestId: string; vehicleId: string };
  const sr = swapRequests.get(swapRequestId);
  if (!sr) { res.status(404).json({ error: "Swap request not found" }); return; }
  if (sr.toVehicleId !== vehicleId && sr.fromVehicleId !== vehicleId) { res.status(403).json({ error: "Not a participant in this swap" }); return; }
  deleteSwapRequest(swapRequestId);
  bumpState();
  res.json({ success: true });
});

router.post("/deployments/reset", requireManager, (req, res) => {
  deploymentEntries.clear();
  vehiclePositions.clear();
  assignments.clear();
  swapRequests.clear();
  lastPositionTime.clear();
  weatherReminderTimers.forEach(clearInterval);
  weatherReminderTimers.clear();
  reassignmentHistory.length = 0;
  deploymentDate = defaultDeploymentDate();
  bumpState();
  persist(async () => {
    await db.delete(deploymentEntriesTable);
    await db.delete(deploymentVehiclePositionsTable);
    await db.delete(deploymentAssignmentsTable);
    await db.delete(deploymentSwapRequestsTable);
    await db.delete(deploymentReassignmentHistoryTable);
  }, "reset");
  persistSettings();
  res.json({ success: true, message: "Deployment reset" });
});

// Deduplicate entries: keep only the latest acceptedAt per vehicle
router.post("/deployments/deduplicate", requireManager, (req, res) => {
  const latest = new Map<string, { key: string; acceptedAt: string }>();
  for (const [key, entry] of deploymentEntries.entries()) {
    const existing = latest.get(entry.vehicleId);
    if (!existing || entry.acceptedAt > existing.acceptedAt) {
      latest.set(entry.vehicleId, { key, acceptedAt: entry.acceptedAt });
    }
  }
  let removed = 0;
  for (const [key] of deploymentEntries.entries()) {
    const entry = deploymentEntries.get(key)!;
    const keep = latest.get(entry.vehicleId);
    if (!keep || keep.key !== key) {
      deploymentEntries.delete(key);
      persist(
        () => db.delete(deploymentEntriesTable).where(
          and(eq(deploymentEntriesTable.locationId, entry.locationId), eq(deploymentEntriesTable.vehicleId, entry.vehicleId)),
        ),
        `dedupe entry ${key}`,
      );
      removed++;
    }
  }
  res.json({ success: true, removed, remaining: deploymentEntries.size });
});

router.post("/deployments/assign", requireManager, (req, res) => {
  const { vehicleId, locationId, locationName, lat, lng, assignedBy, force } = req.body as {
    vehicleId: string;
    locationId: string;
    locationName: string;
    lat: number;
    lng: number;
    assignedBy?: string | null;
    force?: boolean;
  };

  if (!vehicleId || !locationId || !locationName) {
    res.status(400).json({ error: "bad_request", message: "vehicleId, locationId and locationName are required" });
    return;
  }

  // Conflict check: if destination already has another crew deployed, reject unless force=true
  if (!force) {
    const existingAtDest = [...deploymentEntries.values()].find(
      (e) => e.locationId === locationId && e.vehicleId !== vehicleId
    );
    if (existingAtDest) {
      res.status(409).json({
        error: "location_taken",
        message: `${existingAtDest.unitCode} is already deployed at ${locationName}. Pass force=true to reassign anyway.`,
        occupiedBy: existingAtDest.vehicleId,
        unitCode: existingAtDest.unitCode,
      });
      return;
    }
  }

  const vehicle = vehiclePositions.get(vehicleId);
  const unitCode = vehicle?.unitCode ?? "";
  const vehicleNumber = vehicle?.vehicleNumber ?? vehicleId;

  // If vehicle is already deployed somewhere, capture old location for history before freeing it
  const oldEntry = [...deploymentEntries.values()].find((e) => e.vehicleId === vehicleId);
  const wasDeployed = !!oldEntry;
  if (wasDeployed && oldEntry) {
    const fromLocationName = customLocations.get(oldEntry.locationId)?.name ?? oldEntry.locationId;
    const record: ReassignmentRecord = {
      vehicleId,
      vehicleNumber: oldEntry.vehicleNumber || vehicleNumber,
      unitCode: oldEntry.unitCode || unitCode,
      fromLocationId: oldEntry.locationId,
      fromLocationName,
      toLocationId: locationId,
      toLocationName: locationName,
      reassignedAt: new Date().toISOString(),
      reassignedBy: assignedBy ?? null,
    };
    reassignmentHistory.push(record);
    persist(() => db.insert(deploymentReassignmentHistoryTable).values({ ...record, reassignedAt: new Date(record.reassignedAt) }), "reassignment history");
    removeVehicleEntries(vehicleId);
  }

  if (!customLocations.has(locationId)) {
    const loc: PresetLocation = {
      id: locationId,
      name: locationName,
      address: locationName,
      lat: Number(lat),
      lng: Number(lng),
    };
    customLocations.set(locationId, loc);
    persistLocation(loc);
  }

  const assignment: Assignment = {
    vehicleId,
    vehicleNumber,
    unitCode,
    locationId,
    locationName,
    lat: Number(lat),
    lng: Number(lng),
    assignedAt: new Date().toISOString(),
    status: "pending",
    assignedBy: assignedBy ?? null,
    previousLocationId: wasDeployed && oldEntry ? oldEntry.locationId : null,
    previousLocationName: wasDeployed && oldEntry ? (customLocations.get(oldEntry.locationId)?.name ?? oldEntry.locationId) : null,
  };

  setAssignment(assignment);
  bumpState();
  res.json({ success: true, message: wasDeployed ? "Reassignment sent" : "Assignment sent", wasReassigned: wasDeployed });

  // Notify the crew vehicle — use a distinct title and body for reassignments
  sendToCrewVehicle(vehicleId, {
    title: wasDeployed ? `📍 Reassigned to ${locationName}` : "📍 New Assignment",
    body: wasDeployed
      ? `You have been reassigned to ${locationName}. Your previous location has been freed.`
      : `You have been assigned to ${locationName}. Open the app to accept.`,
    tag: "assignment",
    url: "/",
  }).catch(() => {});
});

// ── Pre-assign a roster team to a location (before GPS check-in) ──────────────
router.post("/deployments/pre-assign", requireManager, (req, res) => {
  const { vehicleId, unitCode, vehicleNumber, locationId, locationName, lat, lng, assignedBy } = req.body as {
    vehicleId: string; unitCode: string; vehicleNumber: string;
    locationId: string; locationName: string; lat: number; lng: number;
    assignedBy?: string | null;
  };
  if (!vehicleId || !unitCode || !locationId || !locationName) {
    res.status(400).json({ error: "bad_request", message: "vehicleId, unitCode, locationId and locationName are required" });
    return;
  }
  const assignment: Assignment = {
    vehicleId,
    vehicleNumber: vehicleNumber || unitCode,
    unitCode,
    locationId,
    locationName,
    lat: Number(lat),
    lng: Number(lng),
    assignedAt: new Date().toISOString(),
    status: "pending",
    assignedBy: assignedBy ?? null,
  };
  setAssignment(assignment);
  bumpState();
  res.json({ success: true, message: "Pre-assignment created" });

  // Notify the crew vehicle
  sendToCrewVehicle(vehicleId, {
    title: "📍 New Assignment",
    body: `You have been assigned to ${locationName}. Open the app to accept.`,
    tag: "assignment",
    url: "/",
  }).catch(() => {});
});

// ── Clear all pending assignments (not deployed entries) ──────────────────────
router.post("/deployments/clear-assignments", requireManager, (req, res) => {
  assignments.clear();
  persist(() => db.delete(deploymentAssignmentsTable), "clear assignments");
  res.json({ success: true });
});

router.post("/deployments/assignments/respond", requireManager, async (req, res) => {
  const { vehicleId, vehicleNumber, unitCode, partner, shift, accepted, eta, etaMinutes, fromRoad } = req.body as {
    vehicleId: string;
    vehicleNumber?: string;
    unitCode?: string;
    partner?: string;
    shift?: string;
    accepted: boolean;
    eta?: string;
    etaMinutes?: number;
    fromRoad?: string | null;
  };

  const assignment = assignments.get(vehicleId);
  if (!assignment) {
    res.status(404).json({ error: "not_found", message: "No pending assignment" });
    return;
  }

  if (accepted) {
    assignment.status = "accepted";
    setAssignment(assignment);
    // One vehicle → one location: remove entries at any OTHER location
    removeVehicleEntries(vehicleId, assignment.locationId);
    // Server-side geocoding fallback: if client didn't supply fromRoad, use tracked position
    let resolvedFromRoad = fromRoad ?? null;
    if (!resolvedFromRoad) {
      const pos = vehiclePositions.get(vehicleId);
      if (pos) {
        resolvedFromRoad = await geocodeRoadName(pos.lat, pos.lng);
      }
    }
    const isReassignment = !!assignment.previousLocationId;
    setEntry({
      locationId: assignment.locationId,
      vehicleId,
      vehicleNumber: vehicleNumber ?? assignment.vehicleNumber,
      unitCode: unitCode ?? assignment.unitCode,
      partner: partner ?? "",
      shift: shift ?? "",
      acceptedAt: new Date().toISOString(),
      eta: eta ?? "—",
      etaMinutes: etaMinutes ?? 0,
      arrived: false,
      arrivedAt: null,
      weather: null,
      fromRoad: resolvedFromRoad,
      assignedBy: assignment.assignedBy ?? null,
      previousLocationId: isReassignment ? assignment.previousLocationId : null,
      previousLocationName: isReassignment ? assignment.previousLocationName : null,
      reassignedAt: isReassignment ? new Date().toISOString() : null,
    });
    setTimeout(() => deleteAssignment(vehicleId), 5000);
  } else {
    assignment.status = "declined";
    setAssignment(assignment);
    setTimeout(() => deleteAssignment(vehicleId), 3000);
  }

  bumpState();
  res.json({ success: true, message: accepted ? "Assignment accepted" : "Assignment declined" });
});

router.get("/deployments/locations", (req, res) => {
  res.json({ locations: getActiveLocations() });
});

router.post("/deployments/locations", requireManager, (req, res) => {
  const { name, address, lat, lng } = req.body as { name: string; address: string; lat: number; lng: number };
  if (!name || lat == null || lng == null) {
    res.status(400).json({ error: "bad_request", message: "name, lat and lng are required" });
    return;
  }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const uniqueId = customLocations.has(id) ? `${id}-${Date.now()}` : id;
  const location: PresetLocation = { id: uniqueId, name, address: address || name, lat: Number(lat), lng: Number(lng) };
  customLocations.set(uniqueId, location);
  bumpState();
  persistLocation(location);
  res.json({ success: true, location });
});

router.put("/deployments/locations/:id", requireManager, (req, res) => {
  const { id } = req.params as { id: string };
  if (!customLocations.has(id)) {
    res.status(404).json({ error: "not_found", message: "Location not found" });
    return;
  }
  const { name, address, lat, lng, region, priority } = req.body as {
    name: string; address: string; lat: number; lng: number;
    region?: string; priority?: number;
  };
  const existing = customLocations.get(id)!;
  const updated: PresetLocation = {
    ...existing,
    name: name ?? existing.name,
    address: address ?? existing.address,
    lat: lat != null ? Number(lat) : existing.lat,
    lng: lng != null ? Number(lng) : existing.lng,
    region: region ?? existing.region,
    priority: priority != null ? Number(priority) : existing.priority,
  };
  customLocations.set(id, updated);
  bumpState();
  persistLocation(updated);
  res.json({ success: true, location: updated });
});

// The old POST /deployments/rain-auto-assign (server-fetched NEA rainfall,
// region/cluster-only matching, ignored crew GPS entirely, and never even
// read its own request body despite the frontend already sending
// locationScores) has been removed — manager.ts's "Rain-Path Assign" button
// now calls /deployments/optimize-assign instead, which already does
// nearest-fresh-GPS-crew matching against the client-projected
// locationScores. .scratch/replit-resync-2026-09-21/issues/16.

router.post("/deployments/auto-assign", requireManager, (req, res) => {
  // Extract alphabetic prefix from unit code → region (e.g. "BU3" → "BU")
  const regionOf = (unitCode: string) =>
    unitCode.match(/^([A-Za-z]+)/)?.[1].toUpperCase() ?? "";

  // Two clusters: BU+PJ+WK and CP+KG
  // Priorities are cluster-wide (lower number = higher priority)
  const CLUSTERS: Record<string, string> = {
    BU: "A", PJ: "A", WK: "A",
    CP: "B", KG: "B",
  };
  const clusterOf = (region: string) => CLUSTERS[region] ?? region;

  // Build set of already-assigned vehicleIds and occupied locationIds
  const assignedVehicleIds = new Set(assignments.keys());
  const occupiedLocationIds = new Set([
    ...Array.from(assignments.values()).map((a) => a.locationId),
    ...Array.from(deploymentEntries.keys()),
  ]);

  const newAssignments: Assignment[] = [];

  // Pool of available teams indexed by region (only active shifts)
  const availableByRegion = new Map<string, RosterTeam[]>();
  for (const team of currentRoster) {
    if (!activeShifts.includes(team.shift)) continue;
    const region = regionOf(team.unitCode);
    if (activeTeams.length > 0 && !activeTeams.includes(region)) continue;
    const vid = `${team.unitCode}-${team.vehicleNumber || "NA"}`;
    if (assignedVehicleIds.has(vid)) continue;
    if (!availableByRegion.has(region)) availableByRegion.set(region, []);
    availableByRegion.get(region)!.push(team);
  }

  // Sort all unassigned locations by cluster then by priority
  const unassignedLocs = Array.from(customLocations.values())
    .filter((l) => !occupiedLocationIds.has(l.id))
    .sort((a, b) => {
      const ca = clusterOf(a.region ?? "");
      const cb = clusterOf(b.region ?? "");
      if (ca !== cb) return ca.localeCompare(cb);
      return (a.priority ?? 999) - (b.priority ?? 999);
    });

  const takeTeam = (region: string): RosterTeam | null => {
    // 1. Exact region match (e.g. BU team → BU location)
    const exact = availableByRegion.get(region);
    if (exact?.length) return exact.shift()!;
    // 2. Same cluster only (e.g. PJ/WK team → BU location, or KG team → CP location)
    const cluster = clusterOf(region);
    for (const [r, teams] of availableByRegion) {
      if (clusterOf(r) === cluster && teams.length) return teams.shift()!;
    }
    // No cross-cluster fallback — clusters are strict
    return null;
  };

  for (const loc of unassignedLocs) {
    const team = takeTeam(loc.region ?? "");
    if (!team) continue;

    const vehicleId = `${team.unitCode}-${team.vehicleNumber || "NA"}`;
    const onlineVehicle = vehiclePositions.get(vehicleId);

    const assignment: Assignment = {
      vehicleId,
      vehicleNumber: team.vehicleNumber || onlineVehicle?.vehicleNumber || team.unitCode,
      unitCode: team.unitCode,
      locationId: loc.id,
      locationName: loc.name,
      lat: loc.lat,
      lng: loc.lng,
      assignedAt: new Date().toISOString(),
      status: "pending",
    };

    setAssignment(assignment);
    occupiedLocationIds.add(loc.id);
    assignedVehicleIds.add(vehicleId);
    newAssignments.push(assignment);
  }

  if (newAssignments.length > 0) bumpState();

  let reason = "";
  if (newAssignments.length === 0) {
    if (currentRoster.length === 0) reason = "no_roster";
    else if (unassignedLocs.length === 0) reason = "all_locations_occupied";
    else reason = "no_available_teams";
  }

  res.json({
    success: true,
    count: newAssignments.length,
    reason,
    rosterSize: currentRoster.length,
    unassignedLocCount: unassignedLocs.length,
    assignments: newAssignments.map((a) => ({
      unitCode: a.unitCode,
      locationName: a.locationName,
    })),
  });
});

// ── Optimize Assign: eligible teams → nearest Tier 1 locations ────────────────
// Distinct from rain-auto-assign/auto-assign above: this is the one route
// requireAdminOrManager gates rather than requireManager (all three roles
// approved for /manager can reach the routes above; this one is admin/manager
// only, matching Replit's own choice and the SSP least-privilege pass — see
// CONTEXT.md). Two modes: "rain" (default) restricts to Tier 1 locations the
// client's rain-radar analysis scored as hit, and only assigns teams that
// have acknowledged the active alert or already accepted an assignment;
// "nearest-selected" is the no-rain fallback — the manager hand-picks Tier 1
// locations and eligible teams with fresh GPS are matched by nearest distance.
router.post("/deployments/optimize-assign", requireAdminOrManager, (req, res) => {
  const { locationScores, mode, selectedLocationIds } = req.body as {
    locationScores?: Array<{ id: string; score: number }>;
    mode?: "rain" | "nearest-selected";
    selectedLocationIds?: string[];
  };

  const regionOf = (unitCode: string) => unitCode.match(/^([A-Za-z]+)/)?.[1].toUpperCase() ?? "";
  const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const scoreByLocation = new Map(
    (Array.isArray(locationScores) ? locationScores : [])
      .filter(s => s && typeof s.id === "string" && Number.isFinite(Number(s.score)))
      .map(s => [s.id, Number(s.score)] as const),
  );
  const rainLocations = Array.from(customLocations.values())
    .filter(location => (location.tier ?? 1) === 1 && (scoreByLocation.get(location.id) ?? 0) > 0.02);

  const maxSelectedLocations = currentRoster.length;
  const occupiedLocationIds = new Set([
    ...Array.from(assignments.values()).map(a => a.locationId),
    ...Array.from(deploymentEntries.values()).map(e => e.locationId),
  ]);
  const occupiedVehicleIds = new Set([
    ...Array.from(assignments.keys()),
    ...Array.from(deploymentEntries.values()).map(e => e.vehicleId),
  ]);

  let targetLocations = rainLocations;
  if (mode === "nearest-selected") {
    if (!Array.isArray(selectedLocationIds)
      || selectedLocationIds.length < 1
      || selectedLocationIds.length > maxSelectedLocations) {
      res.status(400).json({
        success: false,
        reason: "invalid_selected_locations",
        message: maxSelectedLocations > 0
          ? `Choose between 1 and ${maxSelectedLocations} Tier 1 locations, matching the saved roster team count.`
          : "Import and save a roster before selecting locations.",
      });
      return;
    }

    const uniqueIds = new Set(selectedLocationIds);
    if (uniqueIds.size !== selectedLocationIds.length) {
      res.status(400).json({
        success: false,
        reason: "invalid_selected_locations",
        message: "Selected locations must be unique.",
      });
      return;
    }

    const selectedLocations = selectedLocationIds.map(id => customLocations.get(id));
    const invalidIds = selectedLocationIds.filter((_id, index) => {
      const location = selectedLocations[index];
      return !location || (location.tier ?? 1) !== 1;
    });
    if (invalidIds.length > 0) {
      res.status(400).json({
        success: false,
        reason: "invalid_selected_locations",
        locationIds: invalidIds,
        message: "Each selected location must be a current Tier 1 location.",
      });
      return;
    }

    const occupiedSelectedIds = selectedLocationIds.filter(id => occupiedLocationIds.has(id));
    if (occupiedSelectedIds.length > 0) {
      res.status(409).json({
        success: false,
        reason: "selected_locations_unavailable",
        locationIds: occupiedSelectedIds,
        message: "One or more selected locations are already occupied. Refresh and choose available locations.",
      });
      return;
    }

    targetLocations = selectedLocations as PresetLocation[];
  }

  const acknowledgedUnits = new Set(activeAlert?.acknowledgments ?? []);
  const acceptedVehicleIds = new Set(
    Array.from(assignments.values())
      .filter(a => a.status === "accepted")
      .map(a => a.vehicleId),
  );

  const eligibleTeams = currentRoster.filter(team => {
    if (!activeShifts.includes(team.shift)) return false;
    const region = regionOf(team.unitCode);
    if (activeTeams.length > 0 && !activeTeams.includes(region)) return false;
    const vehicleId = `${team.unitCode}-${team.vehicleNumber || "NA"}`;
    const acknowledged = acknowledgedUnits.has(team.unitCode);
    const accepted = acceptedVehicleIds.has(vehicleId);
    // No-rain matching is initiated from the live map, so any active roster
    // team can participate once it has a fresh GPS position, including teams
    // already deployed elsewhere (nearest-selected can reassign them to a
    // closer location) — a pending assignment still makes a team
    // unavailable. Rain mode keeps its existing acknowledgement/acceptance
    // and occupied-vehicle gates. .scratch/replit-resync-2026-09-21/issues/22.
    const eligibleForMode = mode === "nearest-selected" || acknowledged || accepted;
    const unavailableForMode = mode === "nearest-selected"
      ? assignments.has(vehicleId)
      : occupiedVehicleIds.has(vehicleId);
    return eligibleForMode && !unavailableForMode;
  });

  const newAssignments: Assignment[] = [];
  let skippedNoGps = 0;
  const remainingLocations = targetLocations.filter(location => !occupiedLocationIds.has(location.id));

  // Reassignment support (nearest-selected mode only) — reuses the same
  // reassignment-history pattern the manual /deployments/assign route
  // already uses below, so an already-deployed team picked for a closer
  // location gets its old entry cleared and the move recorded, instead of
  // ending up with both an old deployment entry and a new pending
  // assignment at once. .scratch/replit-resync-2026-09-21/issues/22.
  const assignTeam = (
    team: typeof eligibleTeams[number],
    vehicleId: string,
    position: VehiclePosition,
    location: PresetLocation,
  ) => {
    const oldEntry = mode === "nearest-selected"
      ? Array.from(deploymentEntries.values()).find(entry => entry.vehicleId === vehicleId)
      : undefined;
    const previousLocationName = oldEntry
      ? (customLocations.get(oldEntry.locationId)?.name ?? oldEntry.locationId)
      : null;
    if (oldEntry) {
      const record: ReassignmentRecord = {
        vehicleId,
        vehicleNumber: oldEntry.vehicleNumber || team.vehicleNumber || position.vehicleNumber,
        unitCode: oldEntry.unitCode || team.unitCode,
        fromLocationId: oldEntry.locationId,
        fromLocationName: previousLocationName!,
        toLocationId: location.id,
        toLocationName: location.name,
        reassignedAt: new Date().toISOString(),
        reassignedBy: "Optimize Assign",
      };
      reassignmentHistory.push(record);
      persist(
        () => db.insert(deploymentReassignmentHistoryTable).values({ ...record, reassignedAt: new Date(record.reassignedAt) }),
        "reassignment history",
      );
      removeVehicleEntries(vehicleId);
    }
    const assignment: Assignment = {
      vehicleId,
      vehicleNumber: team.vehicleNumber || position.vehicleNumber || team.unitCode,
      unitCode: team.unitCode,
      locationId: location.id,
      locationName: location.name,
      lat: location.lat,
      lng: location.lng,
      assignedAt: new Date().toISOString(),
      status: "pending",
      assignedBy: "Optimize Assign",
      previousLocationId: oldEntry?.locationId ?? null,
      previousLocationName,
    };
    setAssignment(assignment);
    occupiedVehicleIds.add(vehicleId);
    occupiedLocationIds.add(location.id);
    const index = remainingLocations.findIndex(candidate => candidate.id === location.id);
    if (index >= 0) remainingLocations.splice(index, 1);
    newAssignments.push(assignment);
  };

  if (mode === "nearest-selected") {
    const GPS_FRESHNESS_MS = 10 * 60 * 1000;
    const now = Date.now();
    const teamsWithCurrentGps: Array<{
      team: typeof eligibleTeams[number];
      vehicleId: string;
      position: VehiclePosition;
    }> = [];

    for (const team of eligibleTeams) {
      const vehicleId = `${team.unitCode}-${team.vehicleNumber || "NA"}`;
      const position = vehiclePositions.get(vehicleId);
      const updatedAt = position ? Date.parse(position.updatedAt) : Number.NaN;
      const validPosition = position
        && Number.isFinite(position.lat) && Math.abs(position.lat) <= 90
        && Number.isFinite(position.lng) && Math.abs(position.lng) <= 180
        && Number.isFinite(updatedAt) && now - updatedAt >= 0 && now - updatedAt <= GPS_FRESHNESS_MS;
      if (!validPosition || !position) {
        skippedNoGps++;
        continue;
      }
      teamsWithCurrentGps.push({ team, vehicleId, position });
    }

    // Rank every remaining crew/location pair by distance so the closest crew
    // is assigned first, rather than allowing roster order to decide the match.
    const remainingTeams = [...teamsWithCurrentGps];
    while (remainingTeams.length > 0 && remainingLocations.length > 0) {
      let bestPair: {
        team: typeof eligibleTeams[number];
        vehicleId: string;
        position: VehiclePosition;
        location: PresetLocation;
        distance: number;
      } | null = null;

      for (const candidate of remainingTeams) {
        for (const location of remainingLocations) {
          const distance = haversine(candidate.position.lat, candidate.position.lng, location.lat, location.lng);
          if (!bestPair
            || distance < bestPair.distance
            || (distance === bestPair.distance && candidate.team.unitCode.localeCompare(bestPair.team.unitCode) < 0)
            || (distance === bestPair.distance && candidate.team.unitCode === bestPair.team.unitCode
              && location.name.localeCompare(bestPair.location.name) < 0)) {
            bestPair = { ...candidate, location, distance };
          }
        }
      }

      if (!bestPair) break;
      assignTeam(bestPair.team, bestPair.vehicleId, bestPair.position, bestPair.location);
      const teamIndex = remainingTeams.findIndex(candidate => candidate.vehicleId === bestPair!.vehicleId);
      if (teamIndex >= 0) remainingTeams.splice(teamIndex, 1);
    }
  } else {
    // Rain mode preserves its established behavior: each team receives its
    // closest rain-hit Tier 1 location, with rain score as a tie-breaker.
    for (const team of eligibleTeams) {
      const vehicleId = `${team.unitCode}-${team.vehicleNumber || "NA"}`;
      const position = vehiclePositions.get(vehicleId);
      if (!position) {
        skippedNoGps++;
        continue;
      }

      const rankedLocations = remainingLocations
        .map(location => ({
          location,
          distance: haversine(position.lat, position.lng, location.lat, location.lng),
          score: scoreByLocation.get(location.id) ?? 0,
        }))
        .sort((a, b) =>
          a.distance - b.distance
          || b.score - a.score
          || (a.location.priority ?? 999) - (b.location.priority ?? 999)
          || a.location.name.localeCompare(b.location.name),
        );
      const best = rankedLocations[0];
      if (!best) continue;
      assignTeam(team, vehicleId, position, best.location);
    }
  }

  if (newAssignments.length > 0) {
    bumpState();
    for (const assignment of newAssignments) {
      // Distinguish a reassignment from a fresh assignment — matches the
      // wording the manual /deployments/assign route already uses, so a
      // crew already in position isn't told "New Assignment" as if they
      // had nothing before. .scratch/replit-resync-2026-09-21/issues/22.
      const isReassignment = !!assignment.previousLocationId;
      sendToCrewVehicle(assignment.vehicleId, {
        title: isReassignment ? `📍 Reassigned to ${assignment.locationName}` : "📍 Optimized Assignment",
        body: isReassignment
          ? `You have been reassigned to ${assignment.locationName}. Your previous location has been freed.`
          : `You have been assigned to ${assignment.locationName}. Open the app to accept.`,
        tag: "assignment",
        url: "/",
      }).catch(() => {});
    }
  }

  res.json({
    success: true,
    mode: mode === "nearest-selected" ? "nearest-selected" : "rain",
    count: newAssignments.length,
    rainLocationCount: rainLocations.length,
    selectedLocationCount: mode === "nearest-selected" ? targetLocations.length : 0,
    maxSelectedLocationCount: mode === "nearest-selected" ? maxSelectedLocations : 0,
    eligibleTeamCount: eligibleTeams.length,
    skippedNoGps,
    assignments: newAssignments.map(a => ({ unitCode: a.unitCode, locationName: a.locationName })),
    reason: newAssignments.length > 0
      ? ""
      : targetLocations.length === 0
        ? "no_rain_hit_tier_1_locations"
        : eligibleTeams.length === 0
          ? "no_new_acknowledged_teams"
          : "no_available_locations",
  });
});

router.delete("/deployments/locations/:id", requireManager, (req, res) => {
  const { id } = req.params as { id: string };
  if (!customLocations.has(id)) {
    res.status(404).json({ error: "not_found", message: "Location not found" });
    return;
  }
  customLocations.delete(id);
  bumpState();
  deleteLocationRow(id);
  res.json({ success: true, message: "Location deleted" });
});

export default router;
