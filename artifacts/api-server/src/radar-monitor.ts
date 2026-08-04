import { PNG } from "pngjs";
import { broadcastToCrew, sendToManagers } from "./routes/push.js";
import { logger } from "./lib/logger.js";

const NEA_UA = "Mozilla/5.0 (compatible; SG-FloodTracker/1.0)";
const INTERVAL_MS = 15 * 60 * 1000;

// Thresholds (pixels in the 217×120 = 26,040-pixel image)
const HEAVY_THRESHOLD    = 30;   // ≥30 red/purple pixels → heavy rain alert
const MODERATE_THRESHOLD = 150;  // ≥150 orange pixels → moderate alert

export interface RadarStatus {
  lastCheckedAt:    string | null; // SGT YYYYMMDDHHMM
  lastNotifiedAt:   string | null;
  lastLevel:        "none" | "light" | "moderate" | "heavy";
  heavyPixels:      number;
  moderatePixels:   number;
  nextCheckIn:      number;        // ms until next scheduled check
  checkedLabel:     string | null; // human-readable
}

let lastCheckedAt:   string | null = null;
let lastNotifiedAt:  string | null = null;
let lastLevel:       RadarStatus["lastLevel"] = "none";
let lastHeavy       = 0;
let lastModerate    = 0;
let nextCheckAt     = 0;

function sgtNow(offsetSlots = 0): { at: string; label: string } {
  const t = new Date(Date.now() - offsetSlots * 5 * 60_000 + 8 * 3600_000);
  const y  = t.getUTCFullYear();
  const mo = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(t.getUTCDate()).padStart(2, "0");
  const h  = String(t.getUTCHours()).padStart(2, "0");
  const m  = String(Math.floor(t.getUTCMinutes() / 5) * 5).padStart(2, "0");
  const at = `${y}${mo}${d}${h}${m}`;
  return { at, label: `${d}/${mo} ${h}:${m} SGT` };
}

async function fetchLatestRadar(): Promise<{ buf: Buffer; at: string; label: string } | null> {
  for (let i = 0; i <= 12; i++) {
    const { at, label } = sgtNow(i);
    const url = `https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_${at}0000dBR.dpsri.png`;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": NEA_UA },
        signal: AbortSignal.timeout(12_000),
      });
      if (!r.ok || !r.headers.get("content-type")?.startsWith("image")) continue;
      const ab = await r.arrayBuffer();
      return { buf: Buffer.from(ab), at, label };
    } catch { continue; }
  }
  return null;
}

function analyzePixels(data: Buffer): { heavy: number; moderate: number } {
  // data is RGBA flat array (from pngjs .data)
  let heavy = 0;
  let moderate = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    if (a < 20) continue; // fully transparent/background — skip
    // Heavy: red (R>180, G<80, B<80) or purple/magenta (R>130, B>120, G<80)
    if ((r > 180 && g < 80 && b < 80) || (r > 130 && b > 120 && g < 80)) {
      heavy++;
    } else if (r > 180 && g > 70 && b < 100) {
      // Moderate: orange-yellow
      moderate++;
    }
  }
  return { heavy, moderate };
}

export async function checkRadarAndNotify(): Promise<void> {
  try {
    const result = await fetchLatestRadar();
    if (!result) {
      logger.warn("Radar monitor: could not fetch latest radar frame");
      return;
    }
    const { buf, at, label } = result;

    if (at === lastCheckedAt) return; // same frame as last check, nothing new
    lastCheckedAt = at;

    const png = PNG.sync.read(buf);
    const { heavy, moderate } = analyzePixels(png.data as unknown as Buffer);

    lastHeavy    = heavy;
    lastModerate = moderate;

    let level: RadarStatus["lastLevel"] = "none";
    if (heavy >= HEAVY_THRESHOLD)         level = "heavy";
    else if (moderate >= MODERATE_THRESHOLD) level = "moderate";
    else if (moderate > 0 || heavy > 0)   level = "light";

    lastLevel = level;
    logger.info({ at, heavy, moderate, level }, "Radar monitor: analysis complete");

    // Only push if heavy rain and this frame hasn't triggered a notification yet
    if (level === "heavy" && at !== lastNotifiedAt) {
      lastNotifiedAt = at;
      const payload = {
        title: "⛈️ Heavy Rain Near Singapore",
        body: `Heavy rain detected on radar at ${label}. Check the radar overlay.`,
        tag: "rain-alert",
        url: "/crew",
      };
      await Promise.all([broadcastToCrew(payload), sendToManagers(payload)]);
      logger.info({ at, heavy }, "Radar monitor: heavy rain push sent");
    } else if (level === "moderate" && at !== lastNotifiedAt) {
      lastNotifiedAt = at;
      const payload = {
        title: "🌧️ Moderate Rain Near Singapore",
        body: `Moderate rain detected on radar at ${label}.`,
        tag: "rain-alert",
        url: "/crew",
      };
      await Promise.all([broadcastToCrew(payload), sendToManagers(payload)]);
      logger.info({ at, moderate }, "Radar monitor: moderate rain push sent");
    }
  } catch (err) {
    logger.error({ err }, "Radar monitor: check failed");
  }
}

export function getRadarStatus(): RadarStatus {
  const checkedLabel = lastCheckedAt
    ? `${lastCheckedAt.slice(6, 8)}/${lastCheckedAt.slice(4, 6)} ${lastCheckedAt.slice(8, 10)}:${lastCheckedAt.slice(10, 12)} SGT`
    : null;
  return {
    lastCheckedAt,
    lastNotifiedAt,
    lastLevel,
    heavyPixels:   lastHeavy,
    moderatePixels: lastModerate,
    nextCheckIn:   Math.max(0, nextCheckAt - Date.now()),
    checkedLabel,
  };
}

export function startRadarMonitor(): void {
  const run = async () => {
    nextCheckAt = Date.now() + INTERVAL_MS;
    await checkRadarAndNotify();
  };

  // First check 90 seconds after startup (let server settle)
  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS);
  }, 90_000);

  logger.info({ intervalMin: INTERVAL_MS / 60_000 }, "Radar monitor: scheduled");
}
