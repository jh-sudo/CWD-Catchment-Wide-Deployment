# CWD Fleet Coordination App

Singapore flood-ops fleet coordination system — pnpm monorepo with a React web dashboard and Expo mobile app.

## Structure

```
artifacts/
  api-server/          — Express API (deployment state, CRMS, alerts, roster)
  roster-dashboard/    — React + Vite web dashboard (manager view)
  deployment-tracker/  — Expo React Native mobile app (crew view)
lib/
  api-spec/            — OpenAPI 3.1 spec
  api-client-react/    — React Query hooks (auto-generated)
  api-zod/             — Zod validation schemas (auto-generated)
  db/                  — Shared DB helpers
scripts/               — Utility scripts
```

## Prerequisites

- Node.js 18+
- pnpm 9+ (`npm install -g pnpm`)
- Expo CLI (`pnpm add -g expo-cli`) — for mobile app only

## Setup

```bash
# Install all dependencies
pnpm install

# Run codegen (generates React Query hooks + Zod schemas from OpenAPI spec)
pnpm --filter @workspace/api-spec run codegen
```

## Running locally

Open three terminals:

```bash
# 1. API server (port 8080)
pnpm --filter @workspace/api-server run dev

# 2. Roster dashboard (port varies)
pnpm --filter @workspace/roster-dashboard run dev

# 3. Mobile app
pnpm --filter @workspace/deployment-tracker run dev
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Random secret for manager session cookies |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps API key (native maps in mobile app) |
| `EXPO_PUBLIC_DOMAIN` | Your deployed domain (e.g. `myapp.com`) |

## Manager admin account

On first run the API server seeds an admin account:
- **Username:** `admin`
- **Password:** `Admin@1234`

Change this immediately after first login via the Users tab.

## Deployment

The API server (`artifacts/api-server`) is a standard Node.js Express app — deploy to any Node.js host (Railway, Render, Fly.io, etc.).

The roster dashboard (`artifacts/roster-dashboard`) builds to a static site:
```bash
pnpm --filter @workspace/roster-dashboard run build
# Output: artifacts/roster-dashboard/dist/
```

The mobile app (`artifacts/deployment-tracker`) is an Expo app — follow [Expo's deployment guide](https://docs.expo.dev/distribution/introduction/) for iOS/Android, or build the web version with `pnpm --filter @workspace/deployment-tracker run build:web`.

## Codegen

If you modify the OpenAPI spec (`lib/api-spec/`), regenerate client code:
```bash
pnpm --filter @workspace/api-spec run codegen
```
