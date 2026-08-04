/**
 * Singapore tide predictor — uses official MPA data published on weather.gov.sg
 *
 * Strategy:
 *   1. Fetch the monthly tidal table HTML from weather.gov.sg (static page,
 *      no API key required).
 *   2. Parse every tide event (day, time SGT, height m, H/L) from the HTML table.
 *   3. Interpolate between adjacent extremes with a cosine curve to get the
 *      current height, rate, and next high/low.
 *   4. Cache the parsed events for 6 hours so we only hit the page ~4×/day.
 */

import https from "https";

const SGT_OFFSET_MS = 8 * 3_600_000; // UTC+8

// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 (tide-widget/1.0)" } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

// ── Parser ────────────────────────────────────────────────────────────────────
export interface TideEvent {
  timeMs: number;   // UTC milliseconds
  height: number;   // metres above Chart Datum
  type: "H" | "L";
}

/**
 * Parse the embedded HTML tide table from weather.gov.sg.
 *
 * The table looks like:
 *   <td rowspan="4">26</td> … <td>8.45 pm</td><td>2.3 m</td><td>H</td>
 *
 * All times are Singapore Standard Time (UTC+8).
 */
function parseEvents(html: string, year: number, month: number): TideEvent[] {
  const events: TideEvent[] = [];

  // Grab the table body
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return events;
  const tbody = tbodyMatch[1];

  // Each day block starts with <td rowspan="N">DD</td>
  // We walk through <td> elements and track current day.
  const tdRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let currentDay = 0;
  const cells: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = tdRx.exec(tbody)) !== null) {
    cells.push(m[1].trim());
  }

  // State machine: cells arrive as:
  //   [day?, sun_rise?, sun_set?, moon_rise?, moon_set?, fraction?, time, height, type]+
  // We detect day cells (pure integer 1-31) and tide triplets (time, "N.N m", "H"/"L").
  let i = 0;
  while (i < cells.length) {
    const cell = cells[i];

    // Day cell
    if (/^\d{1,2}$/.test(cell)) {
      currentDay = parseInt(cell, 10);
      i++;
      continue;
    }

    // Tide triplet: time like "8.45 pm" or "12.39 am", height "2.3 m", type "H"/"L"
    if (/^\d{1,2}\.\d{2}\s*[ap]m$/i.test(cell)) {
      const timeStr = cell;
      const heightStr = cells[i + 1] ?? "";
      const typeStr = cells[i + 2] ?? "";

      if (/\d+\.\d+\s*m/i.test(heightStr) && /^[HL]$/i.test(typeStr)) {
        const height = parseFloat(heightStr);
        const type = typeStr.toUpperCase() as "H" | "L";

        // Parse time (SGT)
        const timeParts = timeStr.match(/(\d+)\.(\d{2})\s*([ap])m/i)!;
        let hour = parseInt(timeParts[1], 10);
        const min = parseInt(timeParts[2], 10);
        const ampm = timeParts[3].toLowerCase();
        if (ampm === "p" && hour !== 12) hour += 12;
        if (ampm === "a" && hour === 12) hour = 0;

        // Build UTC timestamp: SGT = UTC+8
        const sgtMidnight = Date.UTC(year, month - 1, currentDay) - SGT_OFFSET_MS;
        const timeMs = sgtMidnight + (hour * 3_600_000) + (min * 60_000);

        events.push({ timeMs, height, type });
        i += 3;
        continue;
      }
    }

    i++;
  }

  return events;
}

// ── Cache ─────────────────────────────────────────────────────────────────────
interface Cache {
  events: TideEvent[];
  fetchedAt: number;
  monthKey: string; // "YYYY-MM"
}
let cache: Cache | null = null;
const CACHE_TTL_MS = 6 * 3_600_000; // 6 hours

async function getEvents(): Promise<TideEvent[]> {
  const now = Date.now();
  const sgtDate = new Date(now + SGT_OFFSET_MS);
  const year = sgtDate.getUTCFullYear();
  const month = sgtDate.getUTCMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  if (cache && cache.monthKey === monthKey && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.events;
  }

  try {
    const html = await fetchHtml(
      "https://www.weather.gov.sg/weather-astronomical-and-tidal-information-monthly-data/"
    );
    const events = parseEvents(html, year, month);
    if (events.length > 0) {
      cache = { events, fetchedAt: now, monthKey };
      console.log(`[tide] Loaded ${events.length} tide events for ${monthKey}`);
    } else {
      console.warn("[tide] Parsed 0 events — HTML structure may have changed");
    }
    return events;
  } catch (err) {
    console.error("[tide] Fetch failed:", err);
    return cache?.events ?? [];
  }
}

// ── Interpolation ─────────────────────────────────────────────────────────────
/**
 * Given two adjacent tide extremes, use a cosine curve to estimate height at `t`.
 * h(t) = (h1 + h2)/2 + (h1 - h2)/2 · cos(π · (t - t1) / (t2 - t1))
 * (When t=t1 → h1, when t=t2 → h2)
 */
function cosInterp(
  t: number,
  t1: number, h1: number,
  t2: number, h2: number
): number {
  const ratio = (t - t1) / (t2 - t1);
  return (h1 + h2) / 2 + ((h1 - h2) / 2) * Math.cos(Math.PI * ratio);
}

/** Rate of change (m/hr) via central difference */
function cosRate(
  t: number,
  t1: number, h1: number,
  t2: number, h2: number
): number {
  const dt = 60_000; // 1 min
  return (cosInterp(t + dt, t1, h1, t2, h2) - cosInterp(t - dt, t1, h1, t2, h2))
    / (2 * dt / 3_600_000);
}

// ── Public API ────────────────────────────────────────────────────────────────
function formatLocal(ms: number): string {
  const d = new Date(ms + SGT_OFFSET_MS);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${mm} ${ampm}`;
}

export interface TideInfo {
  height: number;
  rising: boolean;
  ratePerHour: number;
  nextHigh: { iso: string; local: string; height: number; inMs: number } | null;
  nextLow:  { iso: string; local: string; height: number; inMs: number } | null;
  updatedAt: string;
  source: string;
}

export async function getSingaporeTide(): Promise<TideInfo> {
  const now = Date.now();
  const events = await getEvents();

  // Find the two events that bracket `now`
  let prevIdx = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i].timeMs <= now) prevIdx = i;
    else break;
  }

  let height: number;
  let rate: number;

  if (prevIdx < 0) {
    // Before first event — use first event height as placeholder
    height = events[0]?.height ?? 1.5;
    rate = 0;
  } else if (prevIdx >= events.length - 1) {
    // After last event — use last event height
    height = events[events.length - 1].height;
    rate = 0;
  } else {
    const e1 = events[prevIdx];
    const e2 = events[prevIdx + 1];
    height = cosInterp(now, e1.timeMs, e1.height, e2.timeMs, e2.height);
    rate = cosRate(now, e1.timeMs, e1.height, e2.timeMs, e2.height);
  }

  // Next high and next low after now
  const nextHigh = events.find((e) => e.timeMs > now && e.type === "H") ?? null;
  const nextLow  = events.find((e) => e.timeMs > now && e.type === "L") ?? null;

  function fmt(e: TideEvent | null) {
    if (!e) return null;
    return {
      iso: new Date(e.timeMs).toISOString(),
      local: formatLocal(e.timeMs),
      height: e.height,
      inMs: Math.max(0, e.timeMs - now),
    };
  }

  return {
    height: Math.round(height * 100) / 100,
    rising: rate > 0,
    ratePerHour: Math.round(rate * 1000) / 1000,
    nextHigh: fmt(nextHigh),
    nextLow:  fmt(nextLow),
    updatedAt: new Date(now).toISOString(),
    source: "MPA / weather.gov.sg",
  };
}
