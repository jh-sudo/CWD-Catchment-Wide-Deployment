import { broadcastToCrew, sendLightningToCrew, sendToManagers } from "./routes/push.js";
import { logger } from "./lib/logger.js";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface LightningSector {
  name: string;
  lat: number;
  lng: number;
  cat: string;
  catStartOn: string | null;
  catEndOn: string | null;
}

const SECTOR_NAMES: Record<string, string> = {
  "1N":  "Tuas / Pioneer",
  "1S":  "Tuas",
  "L1":  "Tengah Reservoir / Pasir Laba",
  "L2":  "Poyan Reservoir",
  "L3":  "Murai Reservoir",
  "L4":  "Sarimbun / Lim Chu Kang",
  "02":  "Jurong West / Tengah",
  "3S":  "Choa Chu Kang",
  "3N":  "Kranji / Lim Chu Kang",
  "04":  "Sungei Buloh / Woodlands West",
  "05":  "Bukit Panjang",
  "06":  "Mandai / Woodlands",
  "07":  "Bukit Timah / Dairy Farm",
  "8N":  "Jurong Lake / Jurong East",
  "8S":  "Jurong Island / Tuas South",
  "09":  "Southern Islands / Sentosa",
  "10N": "Woodlands / Mandai North",
  "10S": "Upper Seletar / Mandai",
  "11W": "Sembawang / Woodlands East",
  "11E": "Yishun / Sembawang",
  "12":  "Bishan / Upper Thomson",
  "13N": "Bukit Panjang East / Zhenghua",
  "13S": "Buona Vista / Holland",
  "14":  "Queenstown / Redhill",
  "15":  "Tampines / Bedok",
  "16N": "Sengkang / Punggol",
  "16S": "Serangoon / Hougang",
  "17":  "Punggol North Coast",
  "18W": "Pasir Ris / Tampines East",
  "18E": "Pasir Ris / Changi Village",
  "19N": "Pulau Ubin / NE Waters",
  "19S": "Changi / Ubin South",
};

function sectorDisplayName(code: string): string {
  return SECTOR_NAMES[code] ?? code;
}

// e.g. "4 Aug 2026 until 1200hrs" — previously the push body embedded the raw
// ISO timestamp verbatim (e.g. "until 2026-08-04T12:00:00.000Z").
// .scratch/replit-resync-2026-09-21/issues/17.
function formatCat1End(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
  const hhmm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).replace(":", "");
  return `${day} until ${hhmm}hrs`;
}

const MAX_CAT1_ALERTS = 3;

let lastNotifiedCatStartOn: string | null = null;
let cat1Active = false;
let cat1AlertCount = 0; // how many pushes sent for the current CAT 1 event

async function fetchSectors(): Promise<LightningSector[]> {
  const r = await fetch("https://api.andewmole.com/cat1/getWeatherInfo", {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "FleetCoordinator/1.0" },
  });
  if (!r.ok) throw new Error(`Upstream returned ${r.status}`);
  const data = await r.json() as any;
  const armysectors = data?.data?.armysectors ?? {};
  return Object.values(armysectors).map((s: any) => ({
    name: (s.sector?.name ?? "Unknown").replace(/^Sector /, ""),
    lat: s.sector?.latitude as number,
    lng: s.sector?.longitude as number,
    cat: String(s.weather?.CAT ?? "3"),
    catStartOn: s.weather?.cat_start_on ?? null,
    catEndOn: s.weather?.cat_end_on ?? null,
  }));
}

export async function checkLightningAndNotify(): Promise<void> {
  try {
    const sectors = await fetchSectors();
    const cat1Sectors = sectors.filter(s => s.cat === "1");

    if (cat1Sectors.length === 0) {
      // CAT 1 just lifted — send all-clear to everyone
      if (cat1Active) {
        const allClear = {
          title: "✅ Lightning CAT 1 Lifted",
          body: "All sectors are now CAT 2 or lower. Normal activities may resume.",
          tag: "lightning-cat1",
          url: "/lightning",
        };
        await Promise.all([
          broadcastToCrew(allClear),
          sendToManagers(allClear),
        ]);
        logger.info("Lightning monitor: CAT 1 lifted — all-clear push sent");
      }
      cat1Active = false;
      lastNotifiedCatStartOn = null;
      return;
    }

    // Use the earliest catStartOn as a unique key for this CAT 1 event
    const eventKey = cat1Sectors
      .map(s => s.catStartOn ?? "")
      .sort()[0] ?? "unknown";

    const isNewEvent = eventKey !== lastNotifiedCatStartOn;
    if (!cat1Active) cat1Active = true;
    if (isNewEvent) {
      lastNotifiedCatStartOn = eventKey;
      cat1AlertCount = 0; // reset counter for each new CAT 1 event
    }

    // Cap at MAX_CAT1_ALERTS per event so officers aren't bombarded
    if (cat1AlertCount >= MAX_CAT1_ALERTS) {
      logger.info(
        { sectors: cat1Sectors.map(s => s.name).join(", "), eventKey, alertCount: cat1AlertCount },
        `Lightning monitor: CAT 1 active but alert limit (${MAX_CAT1_ALERTS}) reached — skipping push`
      );
      return;
    }

    cat1AlertCount += 1;

    // Each sector's own end time, not the first sector's reused for all —
    // .scratch/replit-resync-2026-09-21/issues/17.
    const formatSectorList = (sectors: LightningSector[]) => sectors.map(s => {
      const label = sectorDisplayName(s.name);
      const end = formatCat1End(s.catEndOn);
      return end ? `${label} (${end})` : label;
    }).join(", ");

    const names = formatSectorList(cat1Sectors);
    const activeSectorCodes = cat1Sectors.map(s => s.name.toUpperCase());
    const cat1ByCode = new Map(cat1Sectors.map(s => [s.name.toUpperCase(), s]));

    const managerAlert = {
      title: `⚡ Lightning CAT 1 Alert (${cat1AlertCount}/${MAX_CAT1_ALERTS})`,
      body: `CAT 1 active in: ${names}. Seek shelter immediately.`,
      tag: "lightning-cat1",
      url: "/lightning",
    };

    await Promise.all([
      // Crew with a saved per-sector preference only get notified — and only
      // see — the sectors they actually selected; managers always see every
      // active sector. .scratch/replit-resync-2026-09-21/issues/24.
      sendLightningToCrew(activeSectorCodes, matchingCodes => ({
        title: `⚡ Lightning CAT 1 Alert (${cat1AlertCount}/${MAX_CAT1_ALERTS})`,
        body: `CAT 1 active in: ${formatSectorList(matchingCodes.map(code => cat1ByCode.get(code)!).filter(Boolean))}. Seek shelter immediately.`,
        tag: "lightning-cat1",
        url: "/lightning",
      })),
      sendToManagers(managerAlert),
    ]);
    logger.info({ sectors: names, isNewEvent, eventKey, alertCount: cat1AlertCount }, "Lightning monitor: CAT 1 push sent to crew + managers");
  } catch (err) {
    logger.error({ err }, "Lightning monitor: check failed");
  }
}

export function startLightningMonitor(): void {
  const run = async () => { await checkLightningAndNotify(); };

  // First check 2 minutes after startup
  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS);
  }, 2 * 60_000);

  logger.info({ intervalMin: INTERVAL_MS / 60_000 }, "Lightning monitor: scheduled (5-min CAT 1 watch)");
}
