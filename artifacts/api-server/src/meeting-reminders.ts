import { scanMeetingReminders } from "./routes/meetings.js";
import { logger } from "./lib/logger.js";

const INTERVAL_MS = 60_000; // 1 minute — cheap "is anything due yet" tick;
                             // the actual per-attendee re-notify cadence is
                             // meetings.ts's own 2-hour REMINDER_INTERVAL_MS.

/**
 * Unlike lightning-monitor.ts (first check 2 minutes after boot), this runs
 * once immediately at startup as well as on the recurring interval — a
 * restart shouldn't add extra delay before catching up any reminder that
 * fell due while the API was unavailable.
 * .scratch/replit-resync-2026-09-21/issues/33.
 */
export function startMeetingReminderMonitor(): void {
  const run = async () => { await scanMeetingReminders(); };
  void run();
  setInterval(() => { void run(); }, INTERVAL_MS);
  logger.info({ intervalSec: INTERVAL_MS / 1000 }, "Meeting reminder monitor: scheduled");
}
