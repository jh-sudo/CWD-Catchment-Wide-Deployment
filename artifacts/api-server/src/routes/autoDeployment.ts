import { Router } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, autoDeploymentSettingsTable } from "@workspace/db";
import { requireAdminOrManager } from "./auth.js";
import { getRosterSummary } from "./rosterPlan.js";
import { clearRoster, importRosterText, setActiveShiftsFiltered, broadcastAlertText } from "./deployments.js";
import { logger } from "../lib/logger.js";

// Auto-triggers a roster refresh + alert broadcast when a Heavy Rain Warning
// is detected in text pasted through the manager dashboard's WLS ingestion
// flow (wls.ts's POST /wls/ingest — this repo has no unattended SMS-relay
// path, since wls-android-forwarder is out of scope for this migration; a
// manager still pastes the warning text in, same as today, but the system
// then handles the roster-refresh/alert steps automatically instead of the
// manager doing them by hand). Defaults OFF; both admin and manager can
// toggle it (user's explicit condition for approving this feature).
//
// Deliberately stops after the alert broadcast rather than also
// auto-assigning vehicles to locations: real per-location rain-severity
// scores only ever get computed client-side (the map's canvas-based
// rain-radar pixel analysis), so a server-side auto-assign step would have
// nothing real to act on. Reference's own auto-deployment.ts called its
// assign endpoint with an empty score list — a pre-existing no-op there, not
// something this port reproduces. A manager still does the one-click
// "Optimize Assign" themselves, using real rain data.
// .scratch/replit-resync-2026-09-21/issues/32.
export const autoDeploymentRouter = Router();

interface RecentEventKey {
  key: string;
  receivedAt: string;
}

interface LastRun {
  status: "accepted" | "ignored" | "running" | "completed" | "failed";
  receivedAt: string;
  completedAt?: string;
  message?: string;
  error?: string;
}

interface AutoDeploymentState {
  enabled: boolean;
  recentEventKeys: RecentEventKey[];
  lastRun: LastRun | null;
}

const EVENT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

async function loadState(): Promise<AutoDeploymentState> {
  const [row] = await db.select().from(autoDeploymentSettingsTable).where(eq(autoDeploymentSettingsTable.id, 1));
  return {
    enabled: row?.enabled ?? false,
    recentEventKeys: (row?.recentEventKeys as RecentEventKey[] | undefined) ?? [],
    lastRun: (row?.lastRun as LastRun | null | undefined) ?? null,
  };
}

async function saveState(state: AutoDeploymentState): Promise<void> {
  await db
    .insert(autoDeploymentSettingsTable)
    .values({ id: 1, enabled: state.enabled, recentEventKeys: state.recentEventKeys, lastRun: state.lastRun })
    .onConflictDoUpdate({
      target: autoDeploymentSettingsTable.id,
      set: { enabled: state.enabled, recentEventKeys: state.recentEventKeys, lastRun: state.lastRun },
    });
}

/** Matches Replit's own detection pattern verbatim — the two phrasings the
 *  actual MSS/NEA Heavy Rain Warning text has been observed to use. */
export function isHeavyRainWarning(text: string): boolean {
  return /heavy\s+rain\s+warning/i.test(text) || /\bHRW\s+Issued\s+by\s+MSS\b/i.test(text);
}

function eventKeyFor(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function pruneEventKeys(keys: RecentEventKey[], nowMs: number): RecentEventKey[] {
  return keys.filter((k) => nowMs - new Date(k.receivedAt).getTime() < EVENT_DEDUP_WINDOW_MS);
}

// Singapore is a fixed UTC+8 with no DST, so this needs no timezone library.
function singaporeHour(date: Date): number {
  return (date.getUTCHours() + 8) % 24;
}

function todayDateStrSGT(date: Date): string {
  const sgt = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().slice(0, 10);
}

/** PD-only in the early-morning run-up, PD+DAY through the working day —
 *  outside 06:00-19:00 SGT this isn't a sensible window to auto-refresh the
 *  roster in, so the whole run is skipped (not just the shift-set step). */
function shiftSelectionForNow(date: Date): string[] | null {
  const hour = singaporeHour(date);
  if (hour >= 6 && hour < 10) return ["PD"];
  if (hour >= 10 && hour < 19) return ["PD", "DAY"];
  return null;
}

let activeRun = false;

async function runAutoDeployment(receivedAt: string): Promise<void> {
  try {
    const summary = await getRosterSummary(todayDateStrSGT(new Date()));
    clearRoster();
    const imported = importRosterText(summary);
    if ("error" in imported) throw new Error(imported.message);

    const shifts = shiftSelectionForNow(new Date());
    if (shifts) setActiveShiftsFiltered(shifts);

    broadcastAlertText(
      "Heavy Rain Warning issued by MSS. Today's roster has been refreshed and active shifts updated automatically — use Optimize Assign on the map to deploy vehicles.",
    );

    const state = await loadState();
    state.lastRun = { status: "completed", receivedAt, completedAt: new Date().toISOString() };
    await saveState(state);
  } catch (err) {
    logger.error({ err }, "[auto-deployment] run failed");
    const state = await loadState();
    state.lastRun = {
      status: "failed",
      receivedAt,
      error: err instanceof Error ? err.message : String(err),
    };
    await saveState(state);
  } finally {
    activeRun = false;
  }
}

/** Called from wls.ts's ingest handler whenever isHeavyRainWarning() matches.
 *  Kicks the pipeline off in the background (not awaited by the caller) —
 *  the manager's paste-in request returns immediately either way. */
export async function handleHeavyRainWarning(text: string): Promise<{ status: string; message?: string }> {
  const state = await loadState();
  if (!state.enabled) return { status: "ignored", message: "Auto-deployment is disabled" };
  if (activeRun) return { status: "ignored", message: "A run is already in progress" };

  const now = new Date();
  const pruned = pruneEventKeys(state.recentEventKeys, now.getTime());
  const key = eventKeyFor(text);
  if (pruned.some((k) => k.key === key)) {
    await saveState({ ...state, recentEventKeys: pruned });
    return { status: "ignored", message: "Duplicate warning within the last 24h" };
  }
  if (!shiftSelectionForNow(now)) {
    await saveState({ ...state, recentEventKeys: pruned });
    return { status: "ignored", message: "Outside the 06:00-19:00 SGT auto-deploy window" };
  }

  const receivedAt = now.toISOString();
  await saveState({
    enabled: state.enabled,
    recentEventKeys: [...pruned, { key, receivedAt }],
    lastRun: { status: "accepted", receivedAt },
  });

  activeRun = true;
  void runAutoDeployment(receivedAt);
  return { status: "accepted" };
}

autoDeploymentRouter.get("/auto-deployment/status", requireAdminOrManager, async (_req, res) => {
  const state = await loadState();
  res.json({ enabled: state.enabled, running: activeRun, lastRun: state.lastRun });
});

autoDeploymentRouter.post("/auto-deployment/enabled", requireAdminOrManager, async (req, res) => {
  const { enabled } = req.body as { enabled?: unknown };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  const state = await loadState();
  state.enabled = enabled;
  await saveState(state);
  res.json({ enabled: state.enabled, running: activeRun, lastRun: state.lastRun });
});
