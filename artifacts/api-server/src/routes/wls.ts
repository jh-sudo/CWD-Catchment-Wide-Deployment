import { Router } from "express";
import { eq, and, lt } from "drizzle-orm";
import { db, wlsReadingsTable } from "@workspace/db";
import { sendToManagers } from "./push";
import { requireManager } from "./auth";
import { isHeavyRainWarning, handleHeavyRainWarning } from "./autoDeployment.js";

const router = Router();

// ── Types ──────────────────────────────────────────────────────────────────────
export interface WLSReading {
  stationId: string;
  rawLevel: string;
  alertLevel: "CRITICAL" | "FULL" | "HIGH" | "MEDIUM" | "NORMAL";
  direction: "RISE" | "FALL" | "STABLE";
  waterLevelM: number | null;
  copeM: number | null;
  criticalM: number | null;
  locationName: string;   // clean station name for WLS_ALERT; full content block for TIDE_GATE
  timestamp: string;
  receivedAt: string;
  senderName?: string;
  messageType: "WLS_ALERT" | "TIDE_GATE";
}

function toApiReading(row: typeof wlsReadingsTable.$inferSelect): WLSReading {
  return {
    stationId: row.stationId,
    rawLevel: row.rawLevel,
    alertLevel: row.alertLevel as WLSReading["alertLevel"],
    direction: row.direction as WLSReading["direction"],
    waterLevelM: row.waterLevelM,
    copeM: row.copeM,
    criticalM: row.criticalM,
    locationName: row.locationName,
    timestamp: row.timestamp.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    senderName: row.senderName ?? undefined,
    messageType: row.messageType as WLSReading["messageType"],
  };
}

// The header/line timestamp embedded in WLS SMS text is free-form and not
// guaranteed parseable — fall back to the (always-valid) receivedAt time
// rather than writing an invalid date into a NOT NULL TIMESTAMPTZ column.
function parseTimestamp(raw: string, fallback: Date): Date {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? fallback : d;
}

function toInsertRow(r: WLSReading): typeof wlsReadingsTable.$inferInsert {
  const receivedAt = new Date(r.receivedAt);
  return {
    stationId: r.stationId,
    rawLevel: r.rawLevel,
    alertLevel: r.alertLevel,
    direction: r.direction,
    waterLevelM: r.waterLevelM,
    copeM: r.copeM,
    criticalM: r.criticalM,
    locationName: r.locationName,
    timestamp: parseTimestamp(r.timestamp, receivedAt),
    receivedAt,
    senderName: r.senderName ?? null,
    messageType: r.messageType,
  };
}

// Replace-snapshot semantics for a batch of parsed WLS_ALERT readings —
// mirrors the old readings.set()-after-clear Map behavior.
async function replaceWlsAlerts(parsed: WLSReading[]) {
  await db.transaction(async (tx) => {
    await tx.delete(wlsReadingsTable).where(eq(wlsReadingsTable.messageType, "WLS_ALERT"));
    for (const r of parsed) {
      await tx
        .insert(wlsReadingsTable)
        .values(toInsertRow(r))
        .onConflictDoUpdate({ target: wlsReadingsTable.stationId, set: toInsertRow(r) });
    }
  });
}

async function upsertReadings(parsed: WLSReading[]) {
  for (const r of parsed) {
    await db
      .insert(wlsReadingsTable)
      .values(toInsertRow(r))
      .onConflictDoUpdate({ target: wlsReadingsTable.stationId, set: toInsertRow(r) });
  }
}

// ── Parsers ────────────────────────────────────────────────────────────────────

function parseAlertLevel(rawLevel: string): WLSReading["alertLevel"] {
  const l = rawLevel.toLowerCase().trim();
  if (l.includes("critical")) return "CRITICAL";
  if (l.includes("100") || l.includes("full")) return "FULL";
  if (l.includes("90")) return "HIGH";
  if (l.includes("75")) return "MEDIUM";
  return "NORMAL";
}

function parseMetres(line: string): number | null {
  const m = line.match(/\((\d+\.\d+)m\)/);
  if (m) return parseFloat(m[1]);
  const m2 = line.match(/(\d+\.\d+)\s*m/i);
  return m2 ? parseFloat(m2[1]) : null;
}

function slugify(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "station";
}

/** Detect CWOS Lite format: first line contains "CWOSLite" or any early line is a separator. */
function isCWOSLite(lines: string[]): boolean {
  if (lines[0] && /cwos\s*lite/i.test(lines[0])) return true;
  return lines.slice(0, 8).some((l) => /^[─\-]{4,}$/.test(l));
}

/** True if the content lines after the CWOS Lite separator contain WLS level headers. */
function isWLSAlertContent(contentLines: string[]): boolean {
  return contentLines.some((l) =>
    /^.{0,4}(CRITICAL|FULL|HIGH|MEDIUM)[^:]*:/i.test(l)
  );
}

/** Parse CWOS Lite WLS Alert → individual station readings (one per station). */
function parseCWOSLiteAlert(
  lines: string[],
  senderName: string | undefined,
  receivedAt: string,
): WLSReading[] {
  const headerTs = lines[1] ?? "";
  const sepIdx = lines.findIndex((l) => /^[─\-]{4,}$/.test(l));
  const contentLines = sepIdx >= 0 ? lines.slice(sepIdx + 1) : lines.slice(2);

  const results: WLSReading[] = [];
  let currentLevel: WLSReading["alertLevel"] = "NORMAL";
  let currentRaw = "";

  for (const line of contentLines) {
    if (!line.trim()) continue;

    // Level header line
    const levelMatch = line.match(/^.{0,4}(CRITICAL|FULL|HIGH|MEDIUM|NORMAL)[^:]*/i);
    if (levelMatch && line.trimEnd().endsWith(":")) {
      currentRaw = line;
      currentLevel = parseAlertLevel(line);
      continue;
    }

    // Station line — any line inside a level group, or starting with direction emoji
    if (currentLevel !== "NORMAL" || /^[⬆⬇↑↓⬆️⇩🔺🔻▲▼]/u.test(line)) {
      const dirChar = line.match(/^([⬆⬇↑↓⬆️⇩🔺🔻▲▼]+)/u)?.[0] ?? "";
      const direction: WLSReading["direction"] =
        /⬆|↑|▲|🔺/.test(dirChar) ? "RISE"
        : /⬇|↓|▼|🔻/.test(dirChar) ? "FALL"
        : "STABLE";

      const locationName = line
        .replace(/^[\s⬆⬇↑↓⬆️⇩🔺🔻▲▼\u{2B00}-\u{2BFF}\u{2600}-\u{27FF}\u{1F300}-\u{1FFFF}]+/u, "")
        .trim() || line.trim();
      const stationId = "CWOS_" + slugify(locationName);

      results.push({
        stationId,
        rawLevel: currentRaw || currentLevel,
        alertLevel: currentLevel,
        direction,
        waterLevelM: null,
        copeM: null,
        criticalM: null,
        locationName,
        timestamp: headerTs,
        receivedAt,
        senderName,
        messageType: "WLS_ALERT",
      });
    }
  }

  return results;
}

/** Parse CWOS Lite Tide Gate / operational status → single reading keyed by sender. */
function parseTideGate(
  lines: string[],
  senderName: string | undefined,
  receivedAt: string,
): WLSReading {
  const headerTs = lines[1] ?? "";
  const sepIdx = lines.findIndex((l) => /^[─\-]{4,}$/.test(l));
  const contentLines = sepIdx >= 0 ? lines.slice(sepIdx + 1) : lines.slice(2);
  const content = contentLines.filter((l) => l.trim()).join("\n");
  const key = senderName
    ? "TGATE_" + senderName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)
    : "TGATE";

  return {
    stationId: key,
    rawLevel: "STATUS",
    alertLevel: "NORMAL",
    direction: "STABLE",
    waterLevelM: null,
    copeM: null,
    criticalM: null,
    locationName: content,
    timestamp: headerTs,
    receivedAt,
    senderName,
    messageType: "TIDE_GATE",
  };
}

/** Standard single-station WLS SMS. */
export function parseSMS(smsText: string, senderName?: string): WLSReading | null {
  const lines = smsText.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 4) return null;

  const stationId = lines[0].replace(/[^\w\d]/g, "") || lines[0];
  const rawLevel = lines[1];
  const dir = lines[2].toUpperCase();
  const direction: WLSReading["direction"] = dir.startsWith("RISE") ? "RISE"
    : dir.startsWith("FALL") ? "FALL" : "STABLE";
  const timestamp = lines[3];

  let waterLevelM: number | null = null;
  let copeM: number | null = null;
  let criticalM: number | null = null;
  const locationLines: string[] = [];

  for (let i = 4; i < lines.length; i++) {
    const l = lines[i];
    const ll = l.toLowerCase();
    if (ll.startsWith("water level")) waterLevelM = parseMetres(l);
    else if (ll.startsWith("cope")) copeM = parseMetres(l);
    else if (ll.startsWith("critical")) criticalM = parseMetres(l);
    else locationLines.push(l);
  }

  const locationName = locationLines.filter((l) => l.length > 0).join(" / ") || stationId;
  const alertLevel = parseAlertLevel(rawLevel);

  return {
    stationId,
    rawLevel,
    alertLevel,
    direction,
    waterLevelM,
    copeM,
    criticalM,
    locationName,
    timestamp,
    receivedAt: new Date().toISOString(),
    senderName,
    messageType: "WLS_ALERT",
  };
}

/** Top-level dispatcher — returns array of readings and message type. */
export function parseAny(
  smsText: string,
  senderName?: string,
): { readings: WLSReading[]; messageType: "WLS_ALERT" | "TIDE_GATE" } {
  const lines = smsText.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const now = new Date().toISOString();

  if (isCWOSLite(lines)) {
    const sepIdx = lines.findIndex((l) => /^[─\-]{4,}$/.test(l));
    const contentLines = sepIdx >= 0 ? lines.slice(sepIdx + 1) : lines.slice(2);

    if (isWLSAlertContent(contentLines)) {
      const parsed = parseCWOSLiteAlert(lines, senderName, now);
      return { readings: parsed.length ? parsed : [], messageType: "WLS_ALERT" };
    } else {
      return { readings: [parseTideGate(lines, senderName, now)], messageType: "TIDE_GATE" };
    }
  }

  const single = parseSMS(smsText, senderName);
  return { readings: single ? [single] : [], messageType: "WLS_ALERT" };
}

// ── Expiry ─────────────────────────────────────────────────────────────────────
const WLS_ALERT_TTL_MS = 60 * 60 * 1000; // 1 hour

async function expireOldWlsAlerts(): Promise<void> {
  const cutoff = new Date(Date.now() - WLS_ALERT_TTL_MS);
  await db
    .delete(wlsReadingsTable)
    .where(and(eq(wlsReadingsTable.messageType, "WLS_ALERT"), lt(wlsReadingsTable.receivedAt, cutoff)));
}

// ── Sorted helpers ─────────────────────────────────────────────────────────────
function sortedAlerts(all: WLSReading[]) {
  const order: Record<WLSReading["alertLevel"], number> = {
    CRITICAL: 0, FULL: 1, HIGH: 2, MEDIUM: 3, NORMAL: 4,
  };
  return all
    .filter((r) => r.messageType === "WLS_ALERT")
    .sort((a, b) => order[a.alertLevel] - order[b.alertLevel]);
}

function getGrouped(all: WLSReading[]) {
  const levels: WLSReading["alertLevel"][] = ["CRITICAL", "FULL", "HIGH", "MEDIUM", "NORMAL"];
  const grouped: Record<string, WLSReading[]> = {};
  for (const lvl of levels) grouped[lvl] = all.filter((r) => r.alertLevel === lvl);
  return grouped;
}

function tideGateReadings(all: WLSReading[]) {
  return all
    .filter((r) => r.messageType === "TIDE_GATE")
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// POST /api/wls/ingest — manual-paste ingestion from the manager dashboard's
// WLS panel (see README's "manual-paste ingestion" note); same auth level as
// the analogous /api/crms/ingest paste flow.
router.post("/wls/ingest", requireManager, async (req, res) => {
  const body = req.body as {
    smsText?: string; senderName?: string;
    text?: string; sender?: string;
    html?: string; timestamp?: string;
  };

  const smsText: string | undefined = body.smsText ?? body.text;
  const senderName: string | undefined = body.senderName ?? body.sender;

  if (!smsText || typeof smsText !== "string") {
    res.status(400).json({ error: "smsText (or text) is required" });
    return;
  }

  // Heavy Rain Warning text isn't a WLS reading — hand it to the
  // auto-deployment pipeline (a no-op unless a manager/admin has enabled it)
  // instead of falling through to the WLS parser.
  // .scratch/replit-resync-2026-09-21/issues/32.
  if (isHeavyRainWarning(smsText)) {
    const automation = await handleHeavyRainWarning(smsText);
    res.json({ ok: true, messageType: "HEAVY_RAIN_WARNING", automation });
    return;
  }

  const { readings: parsed, messageType } = parseAny(smsText, senderName);
  if (!parsed.length) {
    res.status(422).json({ error: "Could not parse SMS — check format" });
    return;
  }

  if (messageType === "WLS_ALERT") {
    await replaceWlsAlerts(parsed);
  } else {
    await upsertReadings(parsed);
  }

  // Fire Web Push notification to all manager subscribers
  if (messageType === "TIDE_GATE") {
    const tg = parsed[0];
    const shortText = (tg.locationName ?? "").split("\n").slice(0, 2).join(" | ").slice(0, 120);
    sendToManagers({
      title: "🚪 Tide Gate Alert",
      body: shortText || `New tide gate status from ${tg.senderName ?? "CWOS"}`,
      tag: "tide-gate",
      url: "/manager",
    }).catch(() => {});
  } else if (messageType === "WLS_ALERT") {
    const critCount = parsed.filter(r => r.alertLevel === "CRITICAL" || r.alertLevel === "FULL").length;
    if (critCount > 0) {
      sendToManagers({
        title: `⚠️ WLS Alert — ${critCount} critical station${critCount > 1 ? "s" : ""}`,
        body: parsed.filter(r => r.alertLevel === "CRITICAL" || r.alertLevel === "FULL")
          .map(r => r.locationName).join(", ").slice(0, 120),
        tag: "wls-alert",
        url: "/manager",
      }).catch(() => {});
    }
  }

  res.json({ ok: true, count: parsed.length, messageType, readings: parsed });
});

// POST /api/wls/ingest-batch
router.post("/wls/ingest-batch", requireManager, async (req, res) => {
  const { messages, senderName } = req.body as { messages?: string[]; senderName?: string };
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages array required" });
    return;
  }
  const parsed: WLSReading[] = [];
  const failed: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const { readings: results, messageType } = parseAny(messages[i], senderName);
    if (results.length) {
      if (messageType === "WLS_ALERT") await replaceWlsAlerts(results);
      else await upsertReadings(results);
      parsed.push(...results);
    } else {
      failed.push(i);
    }
  }

  res.json({ ok: true, parsed: parsed.length, failed });
});

// DELETE /api/wls/:stationId
router.delete("/wls/:stationId", requireManager, async (req, res) => {
  const { stationId } = req.params as { stationId: string };
  await db.delete(wlsReadingsTable).where(eq(wlsReadingsTable.stationId, stationId));
  res.json({ ok: true });
});

// DELETE /api/wls — clear WLS alerts only (keep tide gate)
router.delete("/wls", requireManager, async (req, res) => {
  const clearAll = (req.query.all === "1");
  if (clearAll) {
    await db.delete(wlsReadingsTable);
  } else {
    await db.delete(wlsReadingsTable).where(eq(wlsReadingsTable.messageType, "WLS_ALERT"));
  }
  res.json({ ok: true });
});

// GET /api/wls
router.get("/wls", async (_req, res) => {
  // Auto-expire stale WLS alerts
  await expireOldWlsAlerts();

  const rows = await db.select().from(wlsReadingsTable);
  const all = rows.map(toApiReading);

  const alerts = sortedAlerts(all);
  const tideGate = tideGateReadings(all);
  const lastUpdated = alerts.length
    ? alerts.reduce((l, r) => (r.receivedAt > l ? r.receivedAt : l), "")
    : null;

  res.json({
    readings: alerts,
    grouped: getGrouped(alerts),
    count: alerts.length,
    lastUpdated,
    tideGate,
  });
});

export default router;
