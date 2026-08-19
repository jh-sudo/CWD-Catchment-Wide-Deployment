# CWD — Catchment-Wide Deployment

Government-adjacent flood-ops fleet coordination system for Singapore — coordinates vehicle
deployments, crew rosters, and field inspections across catchments. pnpm monorepo: four hosted
web services sharing one Express backend. No native mobile client — see
[Crew and manager dashboards](#crew-and-manager-dashboards) below for why.

## Structure

```
artifacts/
  api-server/          — Express API (shared backend for all 4 hosted services)
  roster-dashboard/     — React + Vite web dashboard (crew roster, leave, PH rotation)
  apa/                   — React + Vite web app (FRA & coverage map)
  inspector/             — React + Vite web app (field inspection reports + photos)
  mockup-sandbox/        — Static "Warehouse IMS" design mockup — prototype only, not hosted, no backend
lib/
  db/                    — Drizzle ORM schema + Postgres client (source of truth for all tables)
  api-spec/               — OpenAPI 3.1 spec
  api-client-react/       — React Query hooks (auto-generated from the spec)
  api-zod/                — Zod validation schemas (auto-generated from the spec)
scripts/
  backfill/               — One-time migration scripts, old JSON data → Postgres
```

## Tech stack

**Backend** (`api-server`): Node.js 20 + TypeScript (ESM), Express 5, Drizzle ORM + `pg` →
PostgreSQL, `bcryptjs`, `@aws-sdk/client-s3` (MinIO-compatible object storage for inspection
photos), `web-push` (VAPID), `docx`/`exceljs` (report generation), `sharp` (image processing),
`pino` (logging). Bundled with esbuild into a single `dist/index.mjs`.

**Web frontends** (`roster-dashboard`, `apa`, `inspector`): React 19 + TypeScript, Vite 7,
Tailwind CSS 4, `wouter` (routing), TanStack Query, Zod (shared schemas from `lib/api-zod`).

**Crew and manager dashboards** (`/crew`, `/manager`): server-rendered HTML/JS directly from
`api-server` — no separate frontend build, no app to install. See below for why.

**Infra**: pnpm workspaces monorepo, one Docker image per hosted service (`node:20-slim`),
pushed to GHCR, deployed on GOV PaaS with path-based routing under one subdomain. PostgreSQL and
MinIO run as private-network-only GOV PaaS addons.

## Migrating from Replit — what changed and why

This app originally ran entirely on Replit. Moving to GitHub + GOV PaaS changed more than just
where the code lives:

| | Replit | Now |
|---|---|---|
| **Data persistence** | Flat JSON files (`artifacts/api-server/data/*.json`), synced to Replit Object Storage | Real PostgreSQL schema (`lib/db/`, Drizzle ORM) — JSON files were backfilled in once, then retired |
| **Inspection photos** | In-memory only — never actually persisted, would vanish on restart | MinIO (S3-compatible), via `@aws-sdk/client-s3` |
| **Routing 4 services under 1 origin** | Replit's built-in path-based artifact router (`router = "path"` in each `.replit-artifact/artifact.toml`) | GOV PaaS/Northflank's native path-based routing — same shape, different platform |
| **Build & deploy** | Automatic — Replit built and deployed on every change | Manual: `docker build` per service → push to GHCR → manual redeploy on GOV PaaS (no CI; the deploy step is a manual "pull this image" action regardless, so CI would only automate half the pipeline — not worth it yet) |
| **Domain** | `your-dashboard.replit.app` | One GOV PaaS-issued sandbox subdomain, intranet-only |
| **Secrets** | Replit's built-in Secrets panel | Environment variables set per-service in the GOV PaaS console |
| **Mobile clients** | Pointed at their Replit domains via a build-time env var / fallback constant | Same mechanism, just repointed at the new subdomain — no architecture change |

**One app was deliberately not carried over to GOV PaaS**, not by oversight:
- **`mockup-sandbox`** ("Warehouse IMS") — a static design mockup with zero backend calls
  (`kind = "design"` in its own Replit metadata). Left as-is, under development.

Still exists on the old Replit deployment today; once Replit is decommissioned, that surface
simply stops being reachable — expected, not a regression.

## Crew and manager dashboards

`deployment-tracker` (Expo/React Native — crew-facing: accept locations, weather report, swap
requests, navigate) and `wls-android-forwarder` (native Android SMS forwarder) both used to live
in this repo. Neither was ever distributed to a real device. Both were removed, not just left
unfinished — see `.scratch/flood-commander-web/` for the full reasoning, in short:

- Singapore GovTech's Vibe Coding Playbook forces **any** native/locally-run app into the
  heaviest governance tier (required SSP, VAPT, CISO/CIO/IDSC approval), regardless of actual
  data sensitivity or deployment scope — just for being a native app.
- `deployment-tracker`'s functionality was rebuilt as plain server-rendered web pages instead —
  `/crew` (new) for officers, `/manager` (already existed, confirmed already covering the rest —
  live map, location/roster assignment, alerts, WLS, CRMS) for commanders. One real functional
  trade-off: continuous background GPS tracking isn't possible from a browser tab, so crew now
  send **intermittent, officer-initiated** location updates (auto-pinged on accept and whenever
  the tab regains focus, plus a manual button) instead of a constantly-live dot. The manager map
  shows a staleness indicator per vehicle to make that visible rather than implying a live feed
  that no longer exists.
- `wls-android-forwarder`'s one job (background SMS interception) can't become a web page —
  removed outright since it was never deployed and its target feature (WLS alerts) already has a
  working manual-paste ingestion path with no dependency on it.

## Prerequisites

- Node.js 20+
- pnpm 10+ (`corepack enable && corepack prepare pnpm@10 --activate`)
- Docker (for local Postgres/MinIO, and for building deploy images)

## Setup

```bash
# Install all dependencies
pnpm install

# Run codegen (generates React Query hooks + Zod schemas from the OpenAPI spec)
pnpm --filter @workspace/api-spec run codegen
```

## Local Postgres & MinIO (for local development)

```bash
docker run -d --name cwd-local-postgres \
  -e POSTGRES_USER=cwd -e POSTGRES_PASSWORD=cwd_local_dev -e POSTGRES_DB=cwd \
  -p 5433:5432 postgres:16-alpine

docker run -d --name cwd-local-minio \
  -e MINIO_ROOT_USER=cwdminio -e MINIO_ROOT_PASSWORD=cwd_local_dev \
  -p 55900:9000 -p 55901:9001 minio/minio server /data --console-address ":9001"

# Push the schema to the fresh local Postgres
DATABASE_URL="postgresql://cwd:cwd_local_dev@localhost:5433/cwd" \
  pnpm --filter @workspace/db run push-force
```

On a genuinely fresh/empty database, the server auto-seeds a fallback admin
account on first boot — see **Manager login** below.

## Running locally

```bash
# 1. API server (port 8080) — point at the local Postgres/MinIO above
pnpm --filter @workspace/api-server run dev

# 2. Web frontends (each on its own Vite dev port)
pnpm --filter @workspace/roster-dashboard run dev
pnpm --filter @workspace/apa run dev
pnpm --filter @workspace/inspector run dev
```

The crew (`/crew`) and manager (`/manager`) dashboards are served directly by the API server —
no separate dev server, just open them once step 1 is running.

## Environment variables

**`artifacts/api-server/.env`** (copy from `.env.example` and fill in):

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Random secret for manager session cookies — no fallback, server fails fast if unset |
| `MINIO_ENDPOINT` | MinIO/S3 endpoint URL |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO credentials |
| `MINIO_BUCKET` | Bucket name for inspection photos (e.g. `cwd-inspections`) |
| `PORT` | Port the API server listens on |

`roster-dashboard`, `apa`, and `inspector` need no env vars of their own — they call the API
same-origin via relative paths. Same for `/crew` and `/manager` — served directly by
`api-server`, no separate config.

## Manager login

The API server auto-seeds a fallback admin account **only if the `managers` table has zero admin
rows** (fresh/empty database):

- Username: `admin`
- Password: `Admin@1234`

This is a first-run bootstrap default, not a fixed credential — once real manager accounts exist
(via normal signup/approval, or a data migration), this fallback never fires and won't work.
Change the seeded password immediately on a genuinely fresh deploy.

## Crew login

Historically crew "auth" was a single PIN shared by the whole crew
(`POST /api/crew-pin/check`) with no individual identity — still present for backward
compat but superseded, see
[`.scratch/flood-commander-web/issues/01-crew-officer-auth.md`](.scratch/flood-commander-web/issues/01-crew-officer-auth.md).

Each officer now gets their own PIN instead, tied to their roster record:

```bash
# Admin sets/replaces a specific officer's crew PIN (auto-approved)
PUT /manager/auth/officers/:officerId/crew-pin   { "pin": "1234" }   # requires admin session

# Officer logs in with their own PIN — issues a real session, not a bare pass/fail
POST /api/crew/auth/login   { "officerId": "...", "pin": "..." }
```

All credential-check endpoints (manager login, manager PIN, crew PIN, per-officer crew
login) are rate-limited independently — 10 attempts per 15 minutes per IP, per endpoint.

## Deployment

Each hosted service (`api-server`, `roster-dashboard`, `apa`, `inspector`) has its own
`Dockerfile` at `artifacts/<service>/Dockerfile`, built from the repo root:

```bash
docker build -f artifacts/api-server/Dockerfile -t ghcr.io/jh-sudo/cwd-api-server:latest .
docker push ghcr.io/jh-sudo/cwd-api-server:latest
```

GOV PaaS deploys by pulling these images from GHCR directly (not a git-connected build) — after
pushing a new image, trigger a redeploy manually from the GOV PaaS console.

All 4 services sit under one GOV PaaS subdomain via path-based routing:

| Path | Service |
|---|---|
| `/`, `/api/*`, `/manager/*`, `/crew/*`, `/lightning/*` | api-server |
| `/roster/*` | roster-dashboard |
| `/apa/*` | apa |
| `/inspector/*` | inspector |

The PostgreSQL and MinIO addons are **private-network-only** — not reachable from outside GOV
PaaS. One-off admin tasks (applying schema, creating a bucket) are run from a live service pod's
own Shell tab in the GOV PaaS console, not from a local machine.

## Codegen

If you modify the OpenAPI spec (`lib/api-spec/`), regenerate client code:
```bash
pnpm --filter @workspace/api-spec run codegen
```
