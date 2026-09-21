Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 3), with conditions the user set up front: must
> default OFF, and both admin AND manager (not admin-only) must be able to toggle it. Two further
> decisions came up mid-implementation and were put to the user rather than resolved unilaterally
> — see below.*

## What this is

Auto-triggers a roster refresh + alert broadcast when a Heavy Rain Warning is detected in text
submitted through the manager dashboard's WLS ingestion panel — skipping several manual steps a
manager would otherwise do by hand after seeing the warning. Off by default; admin/manager can
turn it on via a header button on `/manager`.

## Two decisions surfaced during implementation

**1. This repo has no automated SMS relay to hook into.** Reference's `auto-deployment.ts` is
triggered by an unattended SMS-forwarding pipeline. That pipeline (`wls-android-forwarder`) is one
of the apps explicitly excluded from this whole migration from the start. This repo's
`POST /wls/ingest` is documented as "manual-paste ingestion from the manager dashboard's WLS
panel" — a manager pastes warning text in, authenticated. So "auto-deployment" here concretely
means: once a manager pastes a Heavy Rain Warning message into the existing WLS panel (same as
today), the system automatically does the roster-refresh/alert-broadcast steps instead of the
manager doing them by hand — not a fully unattended, SMS-to-deployment pipeline. This wasn't a
decision point requiring the user's input (the exclusion of the SMS-relay app was already
established), just worth documenting clearly since it changes what "auto" means in practice.

**2. Reference's auto-assign step doesn't actually work — asked the user how to handle it, rather
than silently porting a no-op or silently inventing a replacement.** Reference's pipeline ends by
calling a rain-based vehicle auto-assign endpoint. That endpoint needs per-location rain-severity
scores, and those are only ever computed **client-side** (`manager.ts`'s `runRainAnalysis()` reads
pixel data from the rain-radar image via HTML canvas — not something a server-side background
process can do). Reference's own `auto-deployment.ts` calls its assign endpoint with an empty
body, so in Replit's own version this step silently assigns nothing — a pre-existing gap in the
source being ported, not something this port would introduce. **Asked the user directly**: user
confirmed **stop the pipeline after the alert broadcast** — a manager still does one click
("🎯 Optimize Assign", already working, uses real rain-radar data) to actually deploy vehicles.

## What changed

**Backend**:
- New `artifacts/api-server/src/routes/autoDeployment.ts` (as a `routes/` file, matching this
  repo's own file-organization convention — reference kept it at `src/auto-deployment.ts`, one
  level up, which this repo doesn't otherwise do for anything with its own router).
  - `isHeavyRainWarning(text)` — same detection regex as reference, verbatim.
  - `handleHeavyRainWarning(text)` — checks `enabled`, a single in-flight run guard, a 24h
    SHA-256-based dedup (so re-pasting the same warning doesn't re-trigger), and a 06:00–19:00 SGT
    window (PD-only 06:00-10:00, PD+DAY 10:00-19:00, otherwise ignored) — same logic as reference.
  - `runAutoDeployment()` — pulls today's authoritative roster text (`getRosterSummary`, already
    exported from `rosterPlan.ts` per ticket 27), clears and re-imports the roster, sets active
    shifts, broadcasts an alert. **Stops there** (see decision 2 above) — no auto-assign call.
  - `GET /auto-deployment/status`, `POST /auto-deployment/enabled` — both `requireAdminOrManager`
    (reference gated both `requireAdmin`-only; widened per the user's approval condition).
- **Architecture change from reference, not a literal port**: reference's `runAutoDeployment` made
  unauthenticated internal HTTP self-calls (`fetch("http://127.0.0.1:.../api/roster/import")` etc.)
  — those calls would 401 against this repo's actual `requireManager`-gated equivalents, since
  reference's own endpoints apparently aren't auth-gated the same way there. This repo's own
  established pattern for "a background process needs to trigger a route file's side effects" is
  a direct in-process function call (`lightning-monitor.ts` already does this, importing
  `sendToManagers`/`broadcastToCrew` straight from `push.ts` rather than calling its own HTTP API).
  Followed that precedent: factored `clearRoster()`, `importRosterText()`,
  `setActiveShiftsFiltered()`, and `broadcastAlertText()` out of their existing route handlers in
  `deployments.ts` into exported functions (each handler is now a thin wrapper around its own
  function), and `autoDeployment.ts` calls those directly — no new auth mechanism needed, no HTTP
  round-trip, and the existing routes' behavior is unchanged (verified via typecheck + reading
  the diff, not just assumed).
- New singleton table `auto_deployment_settings` (`enabled`, `recentEventKeys` jsonb, `lastRun`
  jsonb) — additive migration, matches the `deploymentSettingsTable`/`appConfig` singleton-row
  precedent already in this schema.
- Hooked into `wls.ts`'s existing `POST /wls/ingest` handler: right after the `smsText` presence
  check, before `parseAny()` runs — if the text matches `isHeavyRainWarning`, hands off to
  `handleHeavyRainWarning` and returns early (bypassing the normal WLS-reading parse path
  entirely, since a rain warning isn't a water-level reading).

**Frontend (`manager.ts`)**: a header button (`🌧️ Auto Deploy: ON/OFF`), visible to admin and
manager roles (server-side role check at render time, matching this file's existing pattern for
role-gated header elements), toggling via the two new endpoints. No settings panel — reference
didn't have one either, just the header button.

## Worth knowing

- `runAutoDeployment` runs fire-and-forget (`void runAutoDeployment(...)`, not awaited) — the
  manager's paste-in request returns immediately either way, matching reference's async-kickoff
  design.
- The 24h dedup key is a SHA-256 hash of the normalized (trimmed, whitespace-collapsed,
  lowercased) warning text, pruned against `recentEventKeys` on every check — same approach as
  reference, just Postgres-persisted instead of file-persisted.
- If this is ever revisited to build real server-side auto-assign, the actual missing piece is
  rain-severity scoring outside the browser (fetch the radar image server-side and replicate
  `runRainAnalysis()`'s pixel-sampling algorithm in Node, or find/adopt a real rain-intensity data
  source) — a separate, larger task, not a follow-up to this ticket.
