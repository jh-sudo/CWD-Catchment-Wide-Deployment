# Migration plan: Replit → GitHub + GOV PaaS

Status: **final** — synthesized from the govpaas-migration map's 17 resolved decisions. This document is the plan — it is not itself the execution. Actual code changes and the real cutover are a later effort.

## 1. Scope

**Hosted on GOV PaaS**: `api-server`, `roster-dashboard`, `apa`, `inspector` — all four are wired to live auth and live API routes, confirmed by reading source, not stubs.

**Explicitly out of scope**:
- `mockup-sandbox` — static mockup, zero backend calls in source.
- `deployment-tracker` and `wls-android-forwarder` — mobile clients, not hosted services. (Their own config needs are covered in [§13](#13-mobile-client-config).)

**Database approach**: a proper relational Postgres schema replaces the current flat-JSON/Replit-Object-Storage "database" (`cloudPersistence.ts`). The existing `@workspace/db` (Drizzle) package is unused scaffolding today and becomes the real schema.

**Two persistence gaps get fixed as part of this migration, not just translated as-is**:
- Inspections (`inspections.ts`) — currently an in-memory `Map`, lost on every restart.
- VAPID push keys (`push.ts`) — currently regenerate on every restart, breaking push subscriptions.
- (Discovered later, same treatment): flood-ops live state in `deployments.ts`, PH Hari Raya ballot pool (`ph-hr-ballot.json`), and PH rotation cursor (`ph-rot-state.json`) — see [§3](#3-database-schema).

**Data handling**: existing Replit data is real (34 real officers, a 350KB Excel-sourced duty cycle, live ballot state) and must be migrated, not discarded. The repo and GOV PaaS deployment will be **private**, so real staff PII (names, vehicle plates) and religious-affiliation data (`ALL_MUSLIM_OFFICERS`) can migrate as-is — no scrubbing/anonymization needed. Credential material (VAPID private key, password hashes) currently sitting in git history is a separate, stricter question — see [§7](#7-repo-hygiene).

Full ticket: [Scope decisions](issues/00-scope-decisions.md).

## 2. Platform: GOV PaaS (Northflank-adjacent)

GOV PaaS's own docs aren't crawlable; Northflank's docs serve as the working reference platform (confirmed "Northflank-adjacent," not the old GOV.UK PaaS). Full findings: [`docs/research/northflank-platform-capabilities.md`](../../docs/research/northflank-platform-capabilities.md).

- **Postgres**: managed addon (v12–18), connection details injected via env vars mediated by **secret groups** (alias the addon's auto-generated var to `DATABASE_URL`).
- **Object storage**: managed **MinIO addon** (S3-compatible) — chosen for inspection photos (see [§5](#5-file-storage)). Persistent volumes also exist but weren't chosen.
- **Secrets**: dashboard, CLI, or Git-committed config-as-code templates; secret groups can scope to specific services.
- **Deploys**: container-image builds (Dockerfile or buildpacks) triggered by Git webhook; native CI/CD, or GitHub Actions can drive it instead.
- **Multi-service**: one project holds multiple services, each with its own subdomain or path-routed under one, with auto Let's Encrypt TLS on custom domains.
- **Logging**: stdout/stderr auto-captured; optional sinks to Datadog, Loki, Papertrail, S3, or a generic HTTP endpoint — **no sink taken** for this migration, see [§12](#12-loggingmonitoringalerting).

Full ticket: [GOV PaaS platform capabilities](issues/01-govpaas-platform-capabilities.md).

## 3. Database schema

Four domains, all normalized relational schemas in Postgres via `@workspace/db` (Drizzle). Domain-specific business logic (duty-resolution algorithms, PH rotation rules, weekly cycle templates) stays as **application code reading from Postgres** — not materialized into the database — consistent across every domain.

### Core ops state — 15 tables
Replaces `state.json`, `crms.json`, `wls.json`, `managers.json`, `config.json`. Includes the newly-found `deployments.ts` live flood-ops state (deployment entries, vehicle positions — latest-only, swap requests, active alerts, reassignment history) which was entirely in-memory and never persisted. Alert history expands to keep every broadcast (today only the latest survives) with an added `acknowledged_at` timestamp. Login PINs become a DB settings row, not a secret.
Full ticket: [Schema: core ops state](issues/02-schema-core-ops-state.md).

### Roster & leave — 11 tables
`officers`, `roster_config`, `roster_maintenance_vehicles`, `roster_cycle_meta`, `roster_cycle_duties`, `roster_overrides`, `roster_swaps`, `leave_types`, `roster_leaves`, `leave_requests`, `roster_day_overrides` (+ child table). The **duty-resolution algorithm is 4-tier** — override → committed leave → Excel-cycle lookup → generator fallback (corrected from an initial 3-tier read via `.agents/memory/` notes, see [§7](#7-repo-hygiene)) — and stays as application logic, not DB-materialized. The cycle grid is keyed by `unit_code`, not `officer_id` (crews share a duty). A likely existing bug — the "today's summary" path skipping the Excel-cycle lookup — is bundled as a fix. The hardcoded `DEFAULT_OFFICERS` fallback array is deleted once the DB is seeded. A write-time invariant must be preserved: creating a leave entry must clear any *UploadBrief-managed* override for that officer+date first (not covering overrides), or the override silently masks the leave.
Full ticket: [Schema: roster & leave](issues/03-schema-roster-leave.md).

### PH (public holiday) roster — 6 tables
`ph_roster_ref`, `ph_roster_overrides`, `ph_ballot`, `ph_faq`, `ph_hr_ballot_state`, `ph_rotation_state`. Two more persistence gaps found and included: `ph-hr-ballot.json` (Hari Raya OIL draw pool — uploads but never restores) and `ph-rot-state.json` (fairness rotation cursor — never even uploads), both holding real already-progressing state. Holiday calendar, rotation order, and exclusion rules stay as code constants. `ALL_MUSLIM_OFFICERS` confirmed covered by the private-repo PII decision. Redundant `UNIT_DEFAULTS` gets deleted.
Full ticket: [Schema: PH roster](issues/04-schema-ph-roster.md).

### Inspections & push — 5 tables
`inspections`, `inspection_photos`, `inspection_lines`, `vapid_keys`, `push_subscriptions`. Photos get a child table (individually addressed, carry a pin number for map labeling); line points stay as JSONB (no per-point identity). `push-subscriptions.json` confirmed as a third persistence gap (never cloud-synced at all). No durable inspections data exists to migrate — fresh start.
Full ticket: [Schema: inspections & push](issues/05-schema-inspections-push.md).

## 4. Hosting topology

4 separate Northflank services (api-server, roster-dashboard, apa, inspector), **path-routed under one subdomain** — mirrors the existing Replit topology almost exactly (`artifacts/*/.replit-artifact/artifact.toml`):

| Path | Service |
|---|---|
| `/`, `/api/*`, `/manager/*` | api-server |
| `/roster/` | roster-dashboard |
| `/apa/` | apa |
| `/inspector/` | inspector |

Same-origin throughout — no CORS work needed. Root `/` changes from redirecting to `/crew` (out of scope, deployment-tracker) to redirecting to `/roster/`. Each frontend service needs a minimal static-file server with SPA fallback rewrite baked into its Dockerfile (e.g. `serve -s dist`), matching today's Replit rewrite behavior. Domain/DNS ownership is covered in [§11](#11-domaindnstls).

Full ticket: [Hosting topology](issues/07-hosting-topology.md).

## 5. File storage (inspection photos)

**Northflank's managed MinIO addon** (S3-compatible) — chosen over a persistent volume (access mode fixed at creation, would block future horizontal scaling) and Postgres `bytea` (bloats the DB, poor image fit).

- Upload: multer switches from `diskStorage` to `memoryStorage`; existing validation (image mimetype, 20MB limit) is unchanged; files go to MinIO via `PutObject`. Key scheme: `inspections/{inspectionId}/{photoId}.{ext}`.
- Serving: **proxied through api-server**, not presigned URLs — matches the current (unauthenticated, UUID-obscured) access model exactly rather than silently changing it. Presigned URLs are a possible future optimization, not part of this migration.
- No backfill needed (no durable photo data exists today).
- MinIO credentials join the api-server secret group (see [§6](#6-secrets--config)).

Full ticket: [File storage for photos](issues/09-file-storage-photos.md).

## 6. Secrets & config

One Northflank secret group, scoped to **api-server only** — the three frontend services need none of it.

| Variable | Source |
|---|---|
| `DATABASE_URL` | Aliased from the Postgres addon |
| `SESSION_SECRET` | Manually set; insecure fallback **removed** — fails fast if unset |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | **Carried forward** from the existing key (avoids forcing push re-subscription), not rotated |
| `PORT` | Per-service, per Northflank config |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | Unchanged |
| MinIO endpoint/access key/secret key/bucket | From the MinIO addon (§5) |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | **Removed** — Replit-specific, superseded |

Session cookie `secure` flag becomes `NODE_ENV`-aware (`true` in production) — safe since Northflank auto-provisions TLS. Login PINs are **not** in this secret group — they're mutable app data (a DB settings row per §3), not a deploy-time credential. `cloudPersistence.ts` is confirmed fully deletable once the schema tickets land.

Full ticket: [Secrets & config migration](issues/08-secrets-config-migration.md).

## 7. Repo hygiene

Full drop/keep/port checklist for every Replit-specific artifact, executed as prep before the GitHub push (not yet — the GitHub repo doesn't exist yet).

- **Drop**: `.replit`, `.replitignore`, `replit.nix`, `replit.md`, the `@replit/vite-plugin-*` packages and their conditional-load blocks, `pnpm-workspace.yaml`'s `@replit/*` allowlist entries, `cloudPersistence.ts` in full, `.config/npm/node_global`, `.canvas/`, `.agents/agent_assets_metadata.toml`, plus previously-flagged stale root binaries. `artifacts/*/.replit-artifact/artifact.toml` files drop only *after* the hosting topology (§4) is actually implemented on Northflank, since they're its primary source reference.
- **Keep unchanged**: `scripts/post-merge.sh` (portable; its `pnpm --filter db push` line becomes the deploy pipeline's manual migration job, see §8); `attached_assets/` (actively used via `@assets` alias, but needs pruning to only-referenced files before committing — 217 files/100MB today).
- **Keep, port to this repo's convention**: `.agents/memory/*.md` — Replit's own agent's persistent memory on this codebase, real domain knowledge (it's what surfaced the 4-tier duty-resolution correction in §3). Gets ported into this repo's own `CONTEXT.md`/`docs/adr/` convention (per `docs/agents/domain.md`), then the original `.agents/` directory drops.
- **Major finding**: `artifacts/api-server/data/*.json` is committed to git and includes credential material (VAPID private key, manager password hashes) — a secrets-hygiene problem distinct from the already-accepted PII-in-private-repo decision. **Resolved: git history gets scrubbed** before the GitHub push — see [§14](#14-git-history-credential-scrub).

Full ticket: [Repo hygiene checklist](issues/06-repo-hygiene-replit-surface.md).

## 8. Deploy / CI pipeline

- **Build**: one **Dockerfile per service** (api-server, roster-dashboard, apa, inspector) — not buildpacks, because this is a pnpm workspace monorepo with cross-package deps that buildpack auto-detection doesn't handle well. Each mirrors what its Replit `artifact.toml` build command already does.
- **CI/CD**: **GitHub Actions** builds images and triggers Northflank deploys (rather than Northflank watching the branch directly).
- **Migrations**: `drizzle-kit push` runs as a **manually-triggered** (`workflow_dispatch`) GitHub Actions job, not automatically on every deploy — deliberately reviewed per schema change, given this is a live ops tool. This also resolves the repo-hygiene ticket's `post-merge.sh` follow-up: its `pnpm --filter db push` line becomes this job's payload.
- Secrets injection is entirely Northflank's secret groups (§6) — GitHub Actions doesn't need `DATABASE_URL`/`SESSION_SECRET` itself, only build args like frontend `PORT`/`BASE_PATH`.

Full ticket: [Deploy/CI pipeline](issues/10-deploy-ci-pipeline.md).

## 9. Data backfill & cutover

- **Source data is already in git**: `artifacts/api-server/data/*.json` (every domain's real data) matches the working tree exactly — simplifies building/testing the migration script (no need to fight Replit's sidecar GCS auth during development), but is also *why* the credential-in-git-history problem above exists.
- **Cutover data**: git copies are fine for dry-running the script; the actual cutover run does one final **live pull** from the running Replit app so nothing since the last commit is dropped.
- **Cutover approach**: **soft cutover** — Replit keeps running through migration and validation; traffic switches to GOV PaaS only after validation passes; Replit stays up as a rollback fallback afterward. (This is a live flood-ops tool — no fallback during an active incident would be a real risk.)
- **Migration tool**: idempotent, repeatable (`ON CONFLICT DO UPDATE` per table), one script per schema domain, single entrypoint running them in dependency order (core ops state + roster & leave first, since `managers.officer_id` and inspections/push reference `officers`; then PH roster; then inspections & push, which has no source data — fresh start).
- **Validation**: row counts vs. source, spot checks, plus an explicit orphan-check for `roster-cycle.json`'s fuzzy unit+name → `officers.id` matching.
- **Rollback**: trivial — the script only reads from source and never mutates it; not switching traffic (soft cutover) is the rollback.

Full ticket: [Data backfill & cutover](issues/11-data-backfill-cutover.md).

## 10. Staging environment

**No dedicated staging/pre-production environment on GOV PaaS** — neither for the migration cutover nor as a permanent ongoing environment.

- The migration cutover is already covered by §9's soft-cutover validation window (production stood up and validated — row counts, spot checks, orphan check — before DNS switches, with Replit as fallback). That window is the de facto staging step; no separate environment needed on top of it.
- For ongoing future development: rejected in favor of local dev (pnpm workspace against a local Postgres seeded from a prod dump) plus the existing manual migration gate (§8) — a full second 4-service/Postgres/MinIO mirror was judged disproportionate cost/complexity for a small-scale internal tool maintained by a small team.
- Escape hatch if ever needed: Northflank's git-branch build triggers support ad hoc PR-preview builds on demand, not a standing environment.

Full ticket: [Staging environment](issues/12-staging-environment.md).

## 11. Domain/DNS/TLS

The app has **no custom domain today** — Replit's own default subdomain is in use (`location-tracker-pubpmv9.replit.app`). On GOV PaaS:

- **Domain**: `[project name].[team name].stg.paas.sandbox.gov.sg`, auto-provisioned per-project by the GOV PaaS sandbox platform — not self-registered, no DNS records for the team to manage.
- **Path-based routing compatibility confirmed**: Northflank's generic free default hostnames (`*.code.run`) do **not** support path-based routing — it requires a verified custom domain first, which would have broken §4's same-origin topology. The gov-provisioned domain sidesteps this: confirmed pre-verified and ready for path routing out of the box, no separate "add domain" console step needed.
- **TLS**: assumed auto-provisioned (Let's Encrypt, matching Northflank's general custom-domain behavior) but not independently confirmed for this gov instance — flagged as a post-deploy check, not a blocker.
- **No separate "real" custom domain planned** — the goal is simply to get the app deployed; the sandbox-assigned domain is accepted indefinitely, not as an interim placeholder.
- A separate production tier exists at the platform level (hence "stg" in the hostname), but moving to it is explicitly not this migration's goal — this doesn't reopen §10's no-staging decision.

Full ticket: [Domain/DNS/TLS](issues/13-domain-dns-tls.md).

## 12. Logging/monitoring/alerting

**No log sink, no alerting.**

- Stays on Northflank's native stdout/stderr capture (searchable dashboard viewer, live + historical) — matches today's Replit setup exactly (`logger.ts`: plain pino to stdout, JSON in production, nothing downstream). No code changes needed.
- Alerting (deploy failures, error-rate spikes) deferred entirely to a later effort — nothing like it exists today; adding it would be genuinely new infrastructure, not a migration of existing behavior. Same small-scale reasoning as §10.
- Revisit condition: only if the dashboard's (still-unconfirmed) log retention window proves too short for post-incident review, or an actual incident makes the alerting gap concrete — not on a schedule.
- Scoping note: "flood-ops alert broadcast" (officer-facing push notifications) is a domain feature already covered by §3's alert-history table, not part of this infra-alerting decision.

Full ticket: [Logging/monitoring/alerting](issues/14-logging-monitoring-alerting.md).

## 13. Mobile client config

**All build-time, no api-server involvement.** The API base URL is inherently client-side/build-time regardless of any other decision — a mobile client would need to already know api-server's URL to fetch config from it, which is circular. So an api-server config endpoint could only ever serve secondary values (like the Maps key), and it was decided not to build one — no extension of §6's secret-group scope into services that don't otherwise know these clients exist.

Both clients already work this way — no new engineering needed, only value updates once §11's real domain is live:

- **deployment-tracker**: already uses `process.env.EXPO_PUBLIC_API_URL` throughout, falling back to `https://cwd-dashboard.replit.app` if unset.
- **wls-android-forwarder**: `Config.java`'s `DEFAULT_API_URL` is only a fallback — the app's Settings screen already lets a user edit and persist the API URL at runtime via `SharedPreferences`, no rebuild required for already-installed devices.

Remaining execution-time task (not now): update the `EXPO_PUBLIC_API_URL` build value and the `DEFAULT_API_URL` constant once §11's domain is live. The Google Maps native-build key (`app.json` → `app.config.js` conversion) stays separately deferred and non-blocking, unrelated to this migration.

Full ticket: [Mobile client config](issues/15-mobile-client-config.md).

## 14. Git history credential scrub

`artifacts/api-server/data/vapid.json`'s private VAPID key and `managers.json`'s bcrypt password hashes are committed to git history (§7 found this, but it was left as an open decision until now).

**Resolved: scrub git history** (`git filter-repo` or BFG) before the eventual GitHub push, rather than accepting it under the same reasoning already applied to PII. Credentials are a stricter risk category than names/plate numbers — a private repo can still leak via a future access grant, visibility mistake, or fork, and unlike PII, a leaked credential is directly exploitable. This is sharper given §6's decision to carry the existing VAPID key forward unrotated — if history isn't scrubbed, that key stays permanently exposed even after cutover.

Must happen **before** the GitHub repo is created/pushed — rewriting history after collaborators/CI have cloned would require force-pushes and re-clones everywhere.

Full ticket: [Git history credential scrub](issues/16-git-history-credential-scrub.md).

## Out of scope (ruled out during scoping)

- **mockup-sandbox** — static design mockup, zero backend calls.
- **deployment-tracker** — Expo/React Native app, ships as a packaged mobile build, only relevant as an API client.
- **wls-android-forwarder** — native Android app, same reasoning.
