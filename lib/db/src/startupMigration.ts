import pg from "pg";

// One-time catch-up for the GOV PaaS Postgres addon, which was never
// migrated past its original ~2026-08-04 provisioning — every schema
// change since (mandatory MFA's later columns, Phase B/C's new tables,
// the SSP remediation batch) only ever landed on local dev Postgres via
// `drizzle-kit push`, never on the real addon (`drizzle-kit push` can't
// reach it directly — private-network-only, same reason the original
// backfill went through a pg_dump + Import Backup instead). First
// symptom: `managers.must_change_password` missing, crash-looping
// `seedAdmin()`/`refreshManagersCache()` on every boot. Real incident,
// 2026-09-01 — see the commit this file shipped in.
//
// Runs once, automatically, at the very top of api-server's boot — not
// interactively via drizzle-kit — because the crash-looping container
// only gave a Shell tab a few seconds before each restart, too unreliable
// to run anything by hand in. Every statement is IF NOT EXISTS / additive
// and independently try/caught: a failure here logs loudly but never
// throws, so this can only leave the app exactly as broken as it already
// was, never worse. Safe to leave in permanently — every statement is a
// no-op once applied. Once GOV PaaS is confirmed healthy on all of this,
// consider removing it in favour of going back to a real `drizzle-kit
// push` pass (via the pod-shell technique, run while NOT crash-looping)
// for anything added after this file was written.
//
// Needs an owner/admin role, not the app's regular DATABASE_URL — first
// real attempt at this (same incident) failed with "must be owner of
// table managers": the original provisioning loaded schema+data through
// GOV PaaS's Import Backup feature, which runs as a different, more
// privileged role than whatever DATABASE_URL grants api-server day to
// day (DML only, apparently, not DDL/ownership). DATABASE_ADMIN_URL is
// that separate admin/root credential, added to api-server's env
// specifically for this. Falls back to the app pool when it's unset
// (local dev, where one role owns everything) so this stays a no-op
// change for every environment except real GOV PaaS.
export async function runStartupMigration(pool: pg.Pool): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const adminPool = adminUrl
    ? new pg.Pool({
        connectionString: adminUrl,
        ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined,
      })
    : undefined;
  const target = adminPool ?? pool;

  const run = async (label: string, sql: string) => {
    try {
      await target.query(sql);
      console.log(`[startup-migration] ok: ${label}`);
    } catch (err) {
      console.error(`[startup-migration] FAILED: ${label}`, err);
    }
  };

  // --- Critical path: managers — this is what's been crash-looping boot ---
  await run(
    "managers.mfa_secret / mfa_enabled (defensive — expected already present)",
    `ALTER TABLE managers
       ADD COLUMN IF NOT EXISTS mfa_secret text,
       ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false`,
  );
  await run(
    "managers.must_change_password / failed_login_count / last_login_at",
    `ALTER TABLE managers
       ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
       ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
       ADD COLUMN IF NOT EXISTS last_login_at timestamptz`,
  );

  // --- Phase A additive schema — missed in the first pass (2026-09-01):
  // caused 500s on roster_config/roster_leaves reads post-boot-fix, not
  // caught by the local smoke test since local Postgres already had these ---
  await run(
    "roster_config.weekend_pd / weekend_day / weekday_min_strength",
    `ALTER TABLE roster_config
       ADD COLUMN IF NOT EXISTS weekend_pd smallint,
       ADD COLUMN IF NOT EXISTS weekend_day smallint,
       ADD COLUMN IF NOT EXISTS weekday_min_strength smallint`,
  );
  await run(
    "roster_leaves.applied_by / applied_at",
    `ALTER TABLE roster_leaves
       ADD COLUMN IF NOT EXISTS applied_by text,
       ADD COLUMN IF NOT EXISTS applied_at timestamptz`,
  );
  await run(
    "roster_requirements table",
    `CREATE TABLE IF NOT EXISTS roster_requirements (
       id integer PRIMARY KEY DEFAULT 1,
       text text NOT NULL
     )`,
  );

  // --- Phase B/C additive schema — needed for those features, not boot ---
  await run(
    "roster_overrides.comment",
    `ALTER TABLE roster_overrides ADD COLUMN IF NOT EXISTS comment text`,
  );

  await run(
    "activity_log table",
    `CREATE TABLE IF NOT EXISTS activity_log (
       id text PRIMARY KEY,
       type text NOT NULL,
       title text NOT NULL,
       body text NOT NULL,
       created_at timestamptz NOT NULL,
       pattern_name text,
       implement_date text,
       implementer_name text,
       officer_id text,
       officer_name text,
       leave_date text,
       leave_type text,
       applied_by_name text
     )`,
  );

  await run(
    "roster_patterns table",
    `CREATE TABLE IF NOT EXISTS roster_patterns (
       id text PRIMARY KEY,
       name text NOT NULL,
       team_count smallint NOT NULL,
       created_at date NOT NULL,
       is_built_in boolean NOT NULL DEFAULT false,
       data jsonb NOT NULL
     )`,
  );

  await run(
    "roster_vehicle_defaults table",
    `CREATE TABLE IF NOT EXISTS roster_vehicle_defaults (
       plate text PRIMARY KEY,
       location text NOT NULL
     )`,
  );

  await run(
    "roster_vehicle_arrangements table",
    `CREATE TABLE IF NOT EXISTS roster_vehicle_arrangements (
       date date NOT NULL,
       plate text NOT NULL,
       location text NOT NULL,
       PRIMARY KEY (date, plate)
     )`,
  );

  // --- ph_hr_ballot_state: pool/initialized -> pools jsonb. Not a boot
  // blocker; best-effort. Old pool/initialized data is disposable — the
  // app always re-derives pools live from the scheduled PH roster (see
  // lib/db/src/schema/phHrBallotState.ts's header comment), this table is
  // just a cache of the last auto-allocate run, nothing trusts it blindly.
  await run(
    "ph_hr_ballot_state.pools",
    `ALTER TABLE ph_hr_ballot_state ADD COLUMN IF NOT EXISTS pools jsonb;
     UPDATE ph_hr_ballot_state SET pools = '{}'::jsonb WHERE pools IS NULL;
     ALTER TABLE ph_hr_ballot_state ALTER COLUMN pools SET NOT NULL;
     ALTER TABLE ph_hr_ballot_state DROP COLUMN IF EXISTS pool;
     ALTER TABLE ph_hr_ballot_state DROP COLUMN IF EXISTS initialized;`,
  );

  // --- New-capability additive schema (2026-09-21 Replit resync, approved
  // new-capability items) ---
  await run(
    "push_subscriptions.lightning_sectors",
    `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS lightning_sectors text[]`,
  );
  await run(
    "leave_requests.replacement_for_officer_id",
    `ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS replacement_for_officer_id text REFERENCES officers(id)`,
  );
  await run(
    "roster_config.strength",
    `ALTER TABLE roster_config ADD COLUMN IF NOT EXISTS strength jsonb`,
  );
  await run(
    "ph_builder_config table",
    `CREATE TABLE IF NOT EXISTS ph_builder_config (
       id integer PRIMARY KEY DEFAULT 1,
       pattern text[] NOT NULL,
       consecutive_ph boolean NOT NULL DEFAULT true,
       same_holiday_previous_year boolean NOT NULL DEFAULT true,
       excluded_officers text[] NOT NULL,
       start_year smallint NOT NULL DEFAULT 2027
     )`,
  );
  await run(
    "ph_builder_presets table",
    `CREATE TABLE IF NOT EXISTS ph_builder_presets (
       id text PRIMARY KEY,
       name text NOT NULL,
       config jsonb NOT NULL,
       updated_at text NOT NULL
     )`,
  );
  await run(
    "auto_deployment_settings table",
    `CREATE TABLE IF NOT EXISTS auto_deployment_settings (
       id integer PRIMARY KEY DEFAULT 1,
       enabled boolean NOT NULL DEFAULT false,
       recent_event_keys jsonb NOT NULL DEFAULT '[]',
       last_run jsonb
     )`,
  );
  await run(
    "managers.meeting_groups",
    `ALTER TABLE managers ADD COLUMN IF NOT EXISTS meeting_groups text[]`,
  );
  await run(
    "push_subscriptions.account_id",
    `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS account_id text REFERENCES managers(id)`,
  );
  await run(
    "meetings table",
    `CREATE TABLE IF NOT EXISTS meetings (
       id text PRIMARY KEY,
       title text NOT NULL,
       location text NOT NULL,
       organizer_id text NOT NULL REFERENCES managers(id),
       organizer_name text NOT NULL,
       required_attendee_ids text[] NOT NULL,
       optional_attendee_ids text[] NOT NULL,
       proposed_slots jsonb NOT NULL,
       responses jsonb NOT NULL,
       status text NOT NULL,
       confirmed_slot_id text,
       confirmed_at text,
       ready_notified_at text,
       created_at text NOT NULL,
       updated_at text NOT NULL,
       reminder_state jsonb NOT NULL,
       last_response_progress jsonb,
       last_update_notice jsonb
     )`,
  );
  await run(
    "meeting_groups table",
    `CREATE TABLE IF NOT EXISTS meeting_groups (
       id text PRIMARY KEY,
       name text NOT NULL,
       owner_id text NOT NULL REFERENCES managers(id),
       member_ids text[] NOT NULL,
       created_at text NOT NULL,
       updated_at text NOT NULL
     )`,
  );
  await run(
    "manager_calendar_events table",
    `CREATE TABLE IF NOT EXISTS manager_calendar_events (
       id text PRIMARY KEY,
       owner_id text NOT NULL REFERENCES managers(id),
       type text NOT NULL,
       start_date text NOT NULL,
       end_date text NOT NULL,
       note text,
       created_at text NOT NULL,
       updated_at text NOT NULL
     )`,
  );

  // --- Constraints (CHECK/FK/PK) deliberately NOT included here ---
  // These are data-integrity backstops, not required for any query to
  // succeed, so they don't belong in an emergency unblock-the-boot pass.
  // Follow up separately once the site is stable and there's time to add
  // them without time pressure: managers_mfa_enabled_requires_secret_check,
  // leaveRequests.icAccountId's FK to managers, and the composite PK on
  // roster_day_override_applications (dayOverrideId, officerId).

  if (adminPool) {
    await adminPool.end();
  }
}
