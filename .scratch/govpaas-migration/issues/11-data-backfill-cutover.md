Type: grilling
Status: resolved
Blocked by: 02, 03, 04, 05

## Question

Design the migration/backfill strategy for moving real existing data out of Replit Object Storage's JSON files into the new relational schema decided in [core ops state schema](02-schema-core-ops-state.md), [roster & leave schema](03-schema-roster-leave.md), [PH roster schema](04-schema-ph-roster.md), and [inspections & push schema](05-schema-inspections-push.md).

Cover with the user: a one-off script vs. a repeatable/idempotent migration tool, how to pull the current files out of Replit's Object Storage (the existing `restoreFromCloud()` code path can likely be reused/adapted for a one-time export before the Replit environment goes away), validation strategy (how do we know the migration preserved everything correctly — row counts, spot checks, a dry-run/diff step), rollback plan if the new schema turns out wrong post-migration, and cutover sequencing (does the old Replit deployment stay live as a fallback during validation, or is this a hard cutover).

## Answer

### Finding that reshapes this ticket

`artifacts/api-server/data/*.json` — the real data behind every domain (officers, managers, PH ballot/rotation state, everything) — is **already committed to git**, not gitignored, and matches the working tree exactly (verified via `git log`/`git status` on each file). This isn't locked away in Replit's GCS bucket only; it's directly available in the repo right now.

**This simplifies the mechanics significantly**: the migration script doesn't need to fight Replit's sidecar GCS auth (`cloudPersistence.ts`'s `REPLIT_SIDECAR_ENDPOINT` token exchange) to build and test against — it can read the git-committed JSON directly during development.

**It also surfaces a secrets-hygiene problem, out of scope for this ticket but flagged for the others**: `vapid.json`'s private VAPID key and `managers.json`'s bcrypt password hashes are committed to git history. Private repo or not, credential material shouldn't live in version control. Relevant to [repo hygiene](06-repo-hygiene-replit-surface.md) (git-history scrubbing) and [secrets & config migration](08-secrets-config-migration.md) (VAPID key provisioning).

### Decisions made

- **Cutover data source**: git copies are fine for developing/dry-running the migration script, but the actual cutover run does **one final live pull** from the running Replit app/GCS bucket (reusing `restoreFromCloud()`'s logic) so nothing changed since the last commit is silently dropped.
- **Cutover approach**: **soft cutover**. The Replit deployment keeps running untouched throughout migration and validation; traffic/DNS switches to the new GOV PaaS deployment only after validation passes; Replit stays available (not deleted) for a rollback window afterward. Chosen because this is a live flood-ops tool, not just a dev prototype — no live fallback during an active incident would be a real risk.
- **Migration tool shape**: a repeatable, idempotent script (not strictly one-off) — safe to re-run via upsert/`ON CONFLICT DO UPDATE` per table, so a partial failure or the need to re-validate doesn't require manual cleanup before retrying.
- **Validation strategy**: row counts per table vs. source array/object lengths; spot-check a sample of records per domain against the JSON; for `roster-cycle.json` specifically, an explicit reconciliation report confirming every unit+name entry found a matching `officers.id` (the name/unit → officer_id matching decided in the [roster & leave schema](03-schema-roster-leave.md) ticket is fuzzy enough to warrant checking for orphans, not just row counts). A dry-run mode reports what would be inserted without committing, so mismatches surface before the real cutover run.
- **Rollback plan**: since the script only reads from JSON/GCS and never mutates the source, and the target is a fresh Postgres database, rollback is simply not switching traffic over (soft cutover) plus dropping/re-running against Postgres if needed — no destructive step to undo on the Replit side.

### Addendum, 2026-09-22: manager/crew PINs are NOT migrated, unlike everything else in this ticket

Found during the external-API confidentiality audit
(`.scratch/replit-resync-2026-09-21/issues/37-external-api-confidentiality-audit.md`): Replit's
live `config.json` PINs are still the same default (`123456`/`1234`) already documented as
compromised in the earlier security review — any account that never manually changed it is still
on that exact, publicly-known value today. The original version of `02-core-ops-state.ts` copied
`config.managerPin`/`config.crewPin` straight into the new `app_config` row, same as every other
domain here — which would have started GOV PaaS production on an already-known credential. This
is a different situation from the VAPID key decision above (a considered tradeoff to avoid forcing
device re-subscription) — nobody had actually weighed in on the PINs specifically until now.

**Decision: reset, don't carry forward.** `02-core-ops-state.ts` no longer touches `app_config` at
all — it leaves no row behind, so `seedAdmin()` (`artifacts/api-server/src/routes/auth.ts`), which
already generates a fresh random manager/crew PIN pair whenever no `app_config` row exists, handles
it exactly the way a brand-new install would. No duplicate generation logic added; the script just
gets out of the way of code that already does this correctly. The new PIN values will be in that
deployment's first-boot logs — retrieve them from there once cutover happens, the same way a fresh
install's admin password is already retrieved today.

### Structure

One migration script per schema domain (matching the four schema tickets), orchestrated by a single entrypoint that runs them in dependency order: core ops state and roster & leave first (since `managers.officer_id` and inspections/push both reference `officers`), then PH roster, then inspections & push (fresh start, no source data to migrate per that ticket's finding).
