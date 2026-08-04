# CWD — Catchment-Wide Deployment

Government-adjacent flood-ops fleet coordination system for Singapore — coordinates vehicle
deployments, crew rosters, and field inspections across catchments. pnpm monorepo: four hosted
web services sharing one Express backend, plus two standalone mobile clients.

## Structure

```
artifacts/
  api-server/          — Express API (shared backend for all 4 hosted services)
  roster-dashboard/     — React + Vite web dashboard (crew roster, leave, PH rotation)
  apa/                   — React + Vite web app (FRA & coverage map)
  inspector/             — React + Vite web app (field inspection reports + photos)
  deployment-tracker/   — Expo React Native mobile app (crew-facing: accept locations, navigate)
  wls-android-forwarder/ — Native Android app (SMS forwarder for water-level-sensor readings)
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

**Mobile** (`deployment-tracker`): Expo (~54) + React Native 0.81 + React 19, Expo Router,
`react-native-maps`, `expo-location`, TanStack Query. Distributed via EAS Build.

**Mobile** (`wls-android-forwarder`): native Android (Java), separate from the Expo app.

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
| **Domain** | `your-dashboard.replit.app` (and a *second*, different Replit domain for `wls-android-forwarder` — never reconciled until now) | One GOV PaaS-issued sandbox subdomain, intranet-only |
| **Secrets** | Replit's built-in Secrets panel | Environment variables set per-service in the GOV PaaS console |
| **Mobile clients** | Pointed at their Replit domains via a build-time env var / fallback constant | Same mechanism, just repointed at the new subdomain — no architecture change |

**Two apps were deliberately *not* carried over to GOV PaaS**, not by oversight:
- **`mockup-sandbox`** ("Warehouse IMS") — a static design mockup with zero backend calls
  (`kind = "design"` in its own Replit metadata). Left as-is, under development.
- **`deployment-tracker`'s web-preview mode** ("Flood Commander Dashboard", Replit's `/crew`
  path) — Expo's browser-preview convenience feature, not the app's real distribution target.
  The actual app is meant to run natively on phones, not as a hosted website.

Both still exist on the old Replit deployment today; once Replit is decommissioned, those two
specific surfaces simply stop being reachable — expected, not a regression.

## Prerequisites

- Node.js 20+
- pnpm 10+ (`corepack enable && corepack prepare pnpm@10 --activate`)
- Docker (for local Postgres/MinIO, and for building deploy images)
- Expo CLI — for the mobile app only

## Setup

```bash
# Install all dependencies
pnpm install

# Run codegen (generates React Query hooks + Zod schemas from the OpenAPI spec)
pnpm --filter @workspace/api-spec run codegen
```

## Running locally

```bash
# 1. API server (port 8080) — needs a local Postgres, see Environment variables below
pnpm --filter @workspace/api-server run dev

# 2. Web frontends (each on its own Vite dev port)
pnpm --filter @workspace/roster-dashboard run dev
pnpm --filter @workspace/apa run dev
pnpm --filter @workspace/inspector run dev

# 3. Mobile app — scan the printed QR code with Expo Go
pnpm --filter @workspace/deployment-tracker run dev
```

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

**`artifacts/deployment-tracker/.env`** (copy from `.env.example`):

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL — inlined into the client JS bundle at build time |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps key, used only for the Directions API call — **not** a server secret, but still don't commit real values (`.env` is gitignored) |

`roster-dashboard`, `apa`, and `inspector` need no env vars of their own — they call the API
same-origin via relative paths.

## Manager login

The API server auto-seeds a fallback admin account **only if the `managers` table has zero admin
rows** (fresh/empty database):

- Username: `admin`
- Password: `Admin@1234`

This is a first-run bootstrap default, not a fixed credential — once real manager accounts exist
(via normal signup/approval, or a data migration), this fallback never fires and won't work.
Change the seeded password immediately on a genuinely fresh deploy.

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
| `/`, `/api/*`, `/manager/*`, `/lightning/*` | api-server |
| `/roster/*` | roster-dashboard |
| `/apa/*` | apa |
| `/inspector/*` | inspector |

The PostgreSQL and MinIO addons are **private-network-only** — not reachable from outside GOV
PaaS. One-off admin tasks (applying schema, creating a bucket) are run from a live service pod's
own Shell tab in the GOV PaaS console, not from a local machine.

`deployment-tracker` and `wls-android-forwarder` aren't hosted anywhere — they're distributed as
native mobile builds (EAS Build for Expo; a standard APK build for the Android app) and just need
their API URL pointed at the deployed backend.

## Codegen

If you modify the OpenAPI spec (`lib/api-spec/`), regenerate client code:
```bash
pnpm --filter @workspace/api-spec run codegen
```
