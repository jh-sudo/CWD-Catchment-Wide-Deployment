import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "./lib/logger.js";

// Replaces the unofficial api.andewmole.com/cat1/getWeatherInfo sector feed
// with our own CAT1 computation over NEA's official Lightning Observation
// API (data.gov.sg) — no API key required, x-api-key only raises rate
// limits. CAT1 rule is SAF's SafeGuardian definition: a sector goes CAT1
// when a strike lands within 6km of it, and downgrades only after 30
// continuous minutes with no further qualifying strike.
//
// CAT2/CAT3 were never actually computed by this app before — the third
// party's own classification logic was always opaque, so there was never
// a real rule to port. Per the user's own call (post-completion external-API
// audit, 2026-09-22): everything that isn't CAT1 is CAT3. CAT2's map
// styling/banner stays in the frontend as dead-but-harmless code — this
// module simply never emits "2".
//
// Distance is measured to each sector's actual polygon boundary (already
// stored locally in data/lightning_features.json for map rendering), not a
// single reference point the way the third party did — more accurate, and
// removes the one thing we relied on the third party for besides the CAT
// computation itself.

const NEA_LIGHTNING_URL = "https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning";
const CAT1_RADIUS_KM = 6;
const CAT1_COOLDOWN_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 2 * 60 * 1000; // matches NEA's own ~2-min update cadence

// Singapore's latitude range is ~1.15–1.48°, so cos(lat) barely moves
// across the whole country — one fixed reference keeps every distance
// computation on a consistent flat projection.
const REF_LAT = 1.35;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.320 * Math.cos((REF_LAT * Math.PI) / 180);

interface SectorFeature {
  name: string;
  polygons: number[][][][]; // polygon[] -> ring[] -> point[] -> [lat, lng]
}

export interface SectorStatus {
  name: string;
  lat: number;
  lng: number;
  cat: "1" | "3";
  catStartOn: string | null;
  catEndOn: string | null;
}

interface NeaReading {
  location: { latitude: string; longitude: string };
  datetime: string;
}

interface SectorState {
  active: boolean;
  catStartOn: string | null;
  lastQualifyingStrikeAt: number | null; // epoch ms
}

let featuresCache: SectorFeature[] | null = null;
function loadFeatures(): SectorFeature[] {
  if (!featuresCache) {
    const p = join(__dirname, "../data/lightning_features.json");
    featuresCache = JSON.parse(readFileSync(p, "utf8"));
  }
  return featuresCache!;
}

function toXY(lat: number, lng: number): { x: number; y: number } {
  return { x: lng * KM_PER_DEG_LNG, y: lat * KM_PER_DEG_LAT };
}

function pointToSegmentKm(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function isPointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// 0 when the point is inside any of the sector's polygons; otherwise the
// shortest distance in km to the nearest polygon edge.
function distanceToSectorKm(lat: number, lng: number, feature: SectorFeature): number {
  const p = toXY(lat, lng);
  let minKm = Infinity;
  for (const polygon of feature.polygons) {
    for (const ring of polygon) {
      if (isPointInRing(lat, lng, ring)) return 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const ap = toXY(a[0], a[1]);
        const bp = toXY(b[0], b[1]);
        const km = pointToSegmentKm(p.x, p.y, ap.x, ap.y, bp.x, bp.y);
        if (km < minKm) minKm = km;
      }
    }
  }
  return minKm;
}

function polygonCentroid(feature: SectorFeature): { lat: number; lng: number } {
  const ring = feature.polygons[0]?.[0] ?? [];
  if (ring.length === 0) return { lat: REF_LAT, lng: 103.8198 };
  let sumLat = 0;
  let sumLng = 0;
  for (const [lat, lng] of ring) {
    sumLat += lat;
    sumLng += lng;
  }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length };
}

async function fetchLatestStrikes(): Promise<NeaReading[]> {
  const r = await fetch(NEA_LIGHTNING_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "CWDFloodOps/1.0 (flood-ops-sg)" },
  });
  if (!r.ok) throw new Error(`NEA lightning API returned ${r.status}`);
  const body = (await r.json()) as any;
  if (body?.code !== 0) throw new Error(`NEA lightning API error: ${body?.errorMsg}`);
  const records = body?.data?.records ?? [];
  const readings: NeaReading[] = [];
  for (const record of records) {
    for (const reading of record?.item?.readings ?? []) {
      readings.push(reading);
    }
  }
  return readings;
}

const sectorState = new Map<string, SectorState>();
// De-dupes strikes across polls (NEA's "latest" snapshot can overlap with
// the previous poll). Keyed by datetime+coords, pruned on a rolling window
// slightly wider than the cooldown so it never grows unbounded.
const seenReadings = new Map<string, number>();

function pruneSeen(nowMs: number): void {
  const cutoff = nowMs - CAT1_COOLDOWN_MS - 10 * 60 * 1000;
  for (const [key, seenAt] of seenReadings) {
    if (seenAt < cutoff) seenReadings.delete(key);
  }
}

async function pollAndUpdate(): Promise<void> {
  const nowMs = Date.now();
  let readings: NeaReading[];
  try {
    readings = await fetchLatestStrikes();
  } catch (err) {
    // Keep whatever state we already have rather than flapping a sector
    // back to CAT3 just because one poll failed.
    logger.error({ err }, "Lightning CAT monitor: NEA fetch failed");
    return;
  }

  const features = loadFeatures();
  pruneSeen(nowMs);

  for (const reading of readings) {
    const lat = parseFloat(reading.location?.latitude);
    const lng = parseFloat(reading.location?.longitude);
    const readingMs = Date.parse(reading.datetime);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(readingMs)) continue;
    // A stale/backfilled record shouldn't start or extend a CAT1 event as
    // if it just happened.
    if (nowMs - readingMs > CAT1_COOLDOWN_MS) continue;

    const key = `${reading.datetime}|${reading.location.latitude}|${reading.location.longitude}`;
    if (seenReadings.has(key)) continue;
    seenReadings.set(key, nowMs);

    for (const feature of features) {
      if (distanceToSectorKm(lat, lng, feature) > CAT1_RADIUS_KM) continue;
      let state = sectorState.get(feature.name);
      if (!state) {
        state = { active: false, catStartOn: null, lastQualifyingStrikeAt: null };
        sectorState.set(feature.name, state);
      }
      if (!state.active) {
        state.active = true;
        state.catStartOn = reading.datetime;
      }
      if (state.lastQualifyingStrikeAt === null || readingMs > state.lastQualifyingStrikeAt) {
        state.lastQualifyingStrikeAt = readingMs;
      }
    }
  }

  for (const state of sectorState.values()) {
    if (state.active && state.lastQualifyingStrikeAt !== null && nowMs - state.lastQualifyingStrikeAt >= CAT1_COOLDOWN_MS) {
      state.active = false;
      state.catStartOn = null;
      state.lastQualifyingStrikeAt = null;
    }
  }
}

export function getLightningSectorStatus(): SectorStatus[] {
  const features = loadFeatures();
  return features.map((feature) => {
    const state = sectorState.get(feature.name);
    const active = state?.active ?? false;
    const centroid = polygonCentroid(feature);
    return {
      name: feature.name,
      lat: centroid.lat,
      lng: centroid.lng,
      cat: active ? "1" : "3",
      catStartOn: active ? state!.catStartOn : null,
      catEndOn:
        active && state!.lastQualifyingStrikeAt !== null
          ? new Date(state!.lastQualifyingStrikeAt + CAT1_COOLDOWN_MS).toISOString()
          : null,
    };
  });
}

export function startLightningCatMonitor(): void {
  const run = async () => { await pollAndUpdate(); };
  void run();
  setInterval(() => { void run(); }, POLL_INTERVAL_MS);
  logger.info(
    { intervalSec: POLL_INTERVAL_MS / 1000, radiusKm: CAT1_RADIUS_KM, cooldownMin: CAT1_COOLDOWN_MS / 60_000 },
    "Lightning CAT1 monitor: scheduled (self-computed from NEA official lightning data)",
  );
}
