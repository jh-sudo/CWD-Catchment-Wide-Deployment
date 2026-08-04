Type: grilling
Status: resolved
Blocked by: 01

## Question

How should the four in-scope apps (api-server, roster-dashboard, apa, inspector) actually be deployed on GOV PaaS? Using the platform facts from [GOV PaaS platform capabilities](01-govpaas-platform-capabilities.md), decide with the user:

- Separate GOV PaaS apps/services (one per artifact, each with its own route) vs. bundling the three frontends' static builds into api-server to serve (mirroring what Replit's current single-router `[deployment]` config effectively does).
- If separate: how do the frontends reach api-server (same domain + path routing, or CORS across separate domains)? Note `app.use(cors())` is currently wide open — revisit once the real topology is known.
- Routing/URL structure for each app, and whether a shared custom domain is expected or out of reach for this effort (see map's Not yet specified: domain/DNS ownership).

## Answer

**Topology mirrors the current Replit shape almost exactly**, found via Replit's own router config (`artifacts/*/.replit-artifact/artifact.toml`), which every in-scope artifact already had:

| Path | Service | Today | On Northflank |
|---|---|---|---|
| `/`, `/api/*`, `/manager/*` | api-server | port 8080 | one service |
| `/roster/` | roster-dashboard | static SPA, `BASE_PATH=/roster/` | one service |
| `/apa/` | apa | static SPA, `BASE_PATH=/apa/` | one service |
| `/inspector/` | inspector | static SPA, `BASE_PATH=/inspector/` | one service |

- **4 separate Northflank services, path-routed under one subdomain** (not collapsed into api-server). Matches the existing build/deploy separation exactly — each frontend already builds independently in the pnpm workspace with its own `BASE_PATH`. Northflank's path-based routing supports this natively (paths on one subdomain → different services), same shape as Replit's `router = "path"` artifacts.
- **Same-origin throughout** — no CORS/cross-origin cookie work needed for these frontends, since path routing keeps everything under one origin, same as today. `app.use(cors())` being wide open is a separate hardening item, not a functional blocker for this topology.
- **Root path** (`/`): today redirects to `/crew` (deployment-tracker's web preview), which isn't hosted on GOV PaaS. Changes to `res.redirect(302, "/roster/")` — roster-dashboard becomes the default landing page.
- **Implementation note for the execution phase** (not a decision needed now): Northflank deploys everything as a container/build, not bare static file hosting — so each frontend service needs a minimal static-file server with SPA fallback rewrite (`/* → /index.html`, matching today's `[[services.production.rewrites]]` behavior) baked into its Dockerfile/build, e.g. via `serve -s dist` or a tiny nginx config.
- **Custom domain / DNS ownership**: still open, tracked in the map's Not yet specified — this ticket only settles the *routing shape*, not who owns/provisions the domain.
