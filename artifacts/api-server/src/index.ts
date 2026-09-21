import { logger } from "./lib/logger";
import { startRadarMonitor } from "./radar-monitor.js";
import { startLightningMonitor } from "./lightning-monitor.js";
import { startMeetingReminderMonitor } from "./meeting-reminders.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  // Catch up the GOV PaaS Postgres addon's schema before anything else
  // touches it — see startupMigration.ts for why this exists and runs
  // here rather than as a one-off `drizzle-kit push`.
  const { pool, runStartupMigration } = await import("@workspace/db");
  await runStartupMigration(pool);

  const { default: app } = await import("./app");
  const { deploymentsReady } = await import("./routes");

  // Wait for boot-time state hydration to finish before accepting traffic —
  // otherwise a request can arrive in the gap after module load but before
  // Postgres-backed state has loaded, and see an empty roster/assignments.
  await deploymentsReady;

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    startRadarMonitor();
    startLightningMonitor();
    startMeetingReminderMonitor();
  });
}

main().catch((err) => {
  logger.error({ err }, "Startup failed");
  process.exit(1);
});
