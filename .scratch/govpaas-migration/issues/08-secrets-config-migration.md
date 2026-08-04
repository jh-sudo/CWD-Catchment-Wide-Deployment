Type: grilling
Status: resolved
Blocked by: 01

## Question

Map every secret/config value api-server currently depends on to how it will be supplied on GOV PaaS, using the platform facts from [GOV PaaS platform capabilities](01-govpaas-platform-capabilities.md).

Known env vars today: `PORT`, `NODE_ENV`, `LOG_LEVEL`, `SESSION_SECRET` (currently falls back to an insecure hardcoded default — decide whether that fallback should be removed for production), `DEFAULT_OBJECT_STORAGE_BUCKET_ID` (Replit-specific, goes away once storage migrates), plus whatever `DATABASE_URL` the new Postgres schema tickets settle on. Also decide what happens to the Replit sidecar-based GCS auth in `cloudPersistence.ts` — it should be deletable entirely once the DB migration lands, confirm nothing else depends on it.

Also cover: VAPID keys (currently self-generated to a local file — see [inspections & push schema](05-schema-inspections-push.md) for where they're stored; this ticket covers how the *values* get provisioned/rotated) and the `secure: false` session cookie flag in `app.ts`, which should likely become environment-aware once real HTTPS hosting exists.

**New from [data backfill & cutover](11-data-backfill-cutover.md)**: the *current* VAPID private key and manager password hashes are already committed to git history (`artifacts/api-server/data/vapid.json`, `managers.json`). Decide whether to carry the existing VAPID key forward (simplest — no push subscription re-registration needed) or rotate to a fresh one as part of moving off Replit (cleaner given it's been sitting in git history) — this is a provisioning decision this ticket owns, separate from [repo hygiene](06-repo-hygiene-replit-surface.md)'s question of whether to scrub the git history itself.

## Answer

### Decisions made

- **VAPID key: carry forward the existing one**, not rotated. Avoids forcing every manager/crew member to re-subscribe to push notifications post-cutover. Accepted on the same reasoning already applied to other PII/credential material in this migration (private repo/deployment).
- **`SESSION_SECRET` insecure fallback removed** — the new deployment fails fast on startup if it's not set, same pattern already used for `PORT`/`DATABASE_URL` elsewhere in the codebase (`throw new Error(...)`). No more risk of silently running with the known default `"dev-secret-change-in-prod"`.
- **Session cookie `secure` flag becomes environment-aware**: `secure: process.env.NODE_ENV === "production"` (currently hardcoded `false`). Safe to force `true` in production because Northflank auto-provisions TLS via Let's Encrypt on every custom domain (confirmed in the [platform capabilities research](01-govpaas-platform-capabilities.md)) — HTTPS is guaranteed, not optional, once deployed.
- **`cloudPersistence.ts` confirmed fully deletable** — every call site (`rosterPlan.ts`, `leaveRequests.ts`, `phRoster.ts`, `deployments.ts`, `crms.ts`) is superseded by the schema tickets (02–05); nothing else references the Replit sidecar GCS auth.

### Secret group structure (Northflank)

One secret group, scoped to the `api-server` service only (per the research: secret groups can be restricted to specific services) — the three frontend services don't need any of these values.

| Variable | Source | Notes |
|---|---|---|
| `DATABASE_URL` | Aliased from the Postgres addon's auto-generated connection variable | Per the platform research — addon vars are auto-named (e.g. `NF_...`), aliased to the name the app expects |
| `SESSION_SECRET` | Manually set, random value | No fallback — fails fast if unset (see above) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Carried forward from the existing `vapid.json` (see decision above) | Currently self-generated on first boot into a DB row per the [inspections & push schema](05-schema-inspections-push.md) — with a fixed value now provisioned via secrets, `push.ts`'s generate-if-missing logic becomes a true fallback (first-ever boot with no value in either place), not the primary path |
| `PORT` | Set per-service to match Northflank's configured internal port for that service | Already required (`throw` if unset) — no code change, just needs setting per the [hosting topology](07-hosting-topology.md) service definitions |
| `NODE_ENV` | `production` | Unchanged |
| `LOG_LEVEL` | Unchanged | No platform-specific translation needed |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | **Removed entirely** | Replit-specific, superseded by the DB migration. **Resolved by [file storage for photos](09-file-storage-photos.md)**: MinIO addon chosen — its endpoint/access key/secret key/bucket name join this same secret group |

### Login PINs

`config.json`'s manager/crew PINs are **not** part of this secret group — already decided in the [core ops state schema](02-schema-core-ops-state.md) ticket to become a DB settings row (mutable app data, not a deploy-time credential), so no action needed here.
