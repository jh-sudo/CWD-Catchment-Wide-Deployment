Type: security
Status: done

> *Triggered by a direct question ahead of the GOV PaaS push: "what information does the
> Replit version pull from — external APIs it calls — that might be business logic/data
> considered confidential, if that data is not allowed [to leave]?" Two parallel background
> agents audited every outbound network call in the Replit mirror (backend: `api-server`;
> frontend: `roster-dashboard`, `deployment-tracker`, `inspector`, `mockup-sandbox`,
> `wls-android-forwarder`), then every finding was individually cross-checked against this
> repo's own `artifacts/` (which only contains `api-server` + `roster-dashboard`) rather than
> assumed to carry over. This ticket is both the audit record and the fix record — most
> findings needed no code change at all once checked against what's actually here.*

## Method

Two `general-purpose` agents, read-only, against the reference mirror at
`C:\Users\jhsto\Documents\CWD-replit-mirror-2026-09-21\CWD-Catchment-Wide-Deployment`. Each
finding was then re-verified against this repo directly (`grep`/`git log`/live API calls) — not
inferred from the mirror's behavior. Several findings changed conclusion once checked this way
(e.g. the Google Maps key, believed hardcoded, was already env-var-based here).

## Findings

### 1. Lightning CAT1/2/3 classification — unofficial third party

**Replit's approach**: `api.andewmole.com/cat1/getWeatherInfo` (GET, no key) — a third party, not
NEA or any `.gov.sg` domain. Response shape: `data.armysectors`, an object keyed by sector, each
carrying `sector.name/latitude/longitude` (one point per sector) and `weather.CAT` (already
computed "1"/"2"/"3") plus `weather.cat_start_on`/`cat_end_on`. This app never computed the
classification itself — it only ever trusted whatever `CAT` value the third party handed back.
Their internal algorithm was always opaque; the `armysectors` key name suggests they're mirroring
or approximating SAF's own protocol, but that's unconfirmed.

**Our exposure**: identical — this repo's `routes/lightning.ts` (`/lightning/sectors`) and
`lightning-monitor.ts` (the CAT1 push-alert monitor) both called the exact same unofficial
endpoint, ported faithfully during the original resync.

**How we tackled it**: confirmed NEA does publish an official Lightning Observation API on
data.gov.sg (`https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning`, no API key
required — `x-api-key` only raises rate limits). Fetched its real OpenAPI spec and live response
and confirmed it returns **raw strike detections only** (`location.latitude/longitude`, `datetime`,
`type` C/G) — no sector or CAT field. So this was never a drop-in swap; it meant computing CAT1
ourselves. User supplied the actual rule (SAF's SafeGuardian protocol): a sector goes CAT1 when a
strike lands within 6km of it, downgrades only after 30 continuous minutes clear. CAT2 was
explicitly descoped — since it was always a third-party black box with no real definition on our
side, and this app's own alerting logic (`lightning-monitor.ts`) already only ever checked
`cat === "1"` (CAT2 never triggered a push), there was no functional loss in dropping it.

**Code changes**: new `lightning-cat.ts` — polls the NEA endpoint every 2 minutes, measures each
raw strike's distance to the *actual* sector polygon boundary (already stored locally in
`data/lightning_features.json` for map rendering — more accurate than the third party's
single-reference-point-per-sector approach), and maintains per-sector CAT1 state (in-memory,
matching this app's existing monitor convention — no DB persistence, same as before).
`routes/lightning.ts` and `lightning-monitor.ts` both now read from this shared module instead of
independently calling the third party. CAT2 map styling stays in the frontend as dead-but-harmless
code (never triggered, since only "1"/"3" are ever emitted) rather than being ripped out — matches
the user's explicit call. Verified against the *live* NEA endpoint during implementation, not just
the spec.

### 2. Deployment/vehicle GPS reverse-geocoding — non-government third party

**Replit's approach**: two independent call sites, both hitting public Nominatim
(`nominatim.openstreetmap.org/reverse`, no key, OpenStreetMap Foundation — not a government
service) — one in the `deployment-tracker` frontend (`context/AppContext.tsx`, fired on every
deployment-accept and position/destination change, alongside the OSRM *public demo* router and a
conditional Google Directions call), one server-side in `api-server/routes/deployments.ts`
(`geocodeRoadName()`, used by `/deployments/accept` and `/deployments/assignments/respond`).

**Our exposure**: the frontend half doesn't apply — `deployment-tracker` isn't part of this repo
at all. The server-side half was real: `deployments.ts`'s `/search/sg/reverse` route and
`geocodeRoadName()` both called Nominatim, sending live deployment/vehicle GPS coordinates to a
non-government third party on every accept/response.

**How we tackled it**: confirmed OneMap Singapore (SLA, official `.gov.sg`) has a reverse-geocode
API, unlike its already-in-use-here Search API it requires a bearer token (email/password exchanged
for a ~3-day token via `/api/auth/post/getToken`) — confirmed via a live 401 test that it's not
keyless. User initially asked whether the 3-day TTL meant manual upkeep; answered no, and built it
to refresh transparently instead.

**Code changes**: new `lib/oneMapAuth.ts` — caches the bearer token in memory, checks expiry before
every use, and silently re-authenticates via `ONEMAP_EMAIL`/`ONEMAP_PASSWORD` env vars whenever it's
missing or close to expiring; concurrent callers during a refresh collapse into one request.
`deployments.ts`'s `/search/sg/reverse` and `geocodeRoadName()` both switched to OneMap's
`/api/public/revgeocode`. **Verified end-to-end against real, user-supplied OneMap credentials** —
not just the documented spec — which caught a real bug: OneMap uses the literal string `"NIL"` as
its no-value sentinel across `BUILDINGNAME`/`BLOCK`/`ROAD`/`POSTALCODE`; the first implementation
only filtered it for `BUILDINGNAME` (copying the existing `/search/sg` forward-search route's own
`!== "NIL"` pattern), which would have shown literal "NIL NIL, Singapore NIL" for any point with no
nearby road. Fixed by centralizing the filter in `reverseGeocodeOneMap()` itself so every caller
gets it for free. Confirmed fixed against 3 live test points (a no-road nature-reserve coordinate,
Raffles Place, Orchard Road) before shipping.

### 3. Blitzortung.org "nearby strikes" WebSocket — removed, not replaced

**History, not what you'd guess**: this genuinely *was* ported from Replit's own code
(`d1ddad2`, their original implementation) during this project's earlier Phase A
(Replit-parity work, 2026-08-26, commit `7653c44`) — a live-strike overlay showing lightning from
Malaysia/Indonesia within 30km of Singapore's border, explicitly UI-labeled as "not an official
Singapore CAT status." Pull-only (browser connects directly to
`wss://ws{1,7,8}.blitzortung.org/`), no data sent out. Replit's own team removed it entirely in a
later refactor (`1cfa8f7`, 2026-09-12, terse machine-generated commit message, no stated reason) —
so by the time this audit ran, it existed only on our side, not the current Replit mirror.

**Decision**: given it was pull-only (lowest risk of anything in this whole audit) but Replit's own
team had walked away from it for an unknown reason, and it's a crowdsourced volunteer network (not
government, not the primary CAT1 alerting mechanism), the user chose to remove it rather than keep
maintaining a dependency Replit itself abandoned.

**Code changes**: removed entirely from `routes/lightning.ts` (CSS, HTML status div, all
`regionalLightning*`/`decodeRegionalLightningFrame`/`addNearbyExternalStrike` JS, including the
now-dead `clamp`/`haversineKm` helpers) and `app.ts`'s CSP (`connect-src`'s
`wss://*.blitzortung.org` entry).

### 4. Google Maps API key — already fine here, not hardcoded

**Replit's approach**: literal hardcoded key in `manager.ts` (`const MAPS_KEY = "AIzaSy..."`),
served in plaintext in every `/manager` page's HTML `<script>` tag, and duplicated in
`deployment-tracker/app.json` for the native Maps SDK (used on both the crew map and the external
Partner Portal map).

**Our exposure**: none — confirmed `manager.ts:13` here already reads
`process.env.GOOGLE_MAPS_API_KEY`, never a literal. `git grep` for the literal key string across
this whole repo found nothing; no `.env` ever committed; `.gitignore` covers it.
`deployment-tracker` isn't part of this repo, so the duplication doesn't apply either.

**Decision**: user confirmed no rotation needed — both this repo's and the mirror's `/manager`
route are gated behind `requireManager` (verified), so the key was never *publicly* exposed, only
visible to authenticated manager sessions' browsers. Since Replit's own git history isn't public,
user judged the exposure acceptable. One correction made to that reasoning during discussion: the
exposure isn't purely a git-history question — every manager who's used the live Replit `/manager`
page has had the key in their browser's page source/network tab, a real (if bounded) population
beyond just repo access. No code change needed either way; this repo was already clean.

### 5. OSM tile hotlinking — already using CARTO here

**Replit's approach**: raw `tile.openstreetmap.org` hotlinking in `inspector` (server-side, for
composited inspection-report maps) and client-side on `/lightning`/`/manager`'s map. OSM's own
policy discourages hotlinking at production volume.

**Our exposure**: `inspector` isn't in this repo. `lightning.ts`/`crew.ts` here already use CARTO
basemap tiles (`basemaps.cartocdn.com`), not raw OSM — a deliberate call made earlier in this same
resync (ticket 24), before this audit even started. No action needed.

### 6. Data storage — already on real Postgres here

**Replit's approach**: all persisted data (managers, officers, CRMS cases, IMS users — ~30 files)
lives in Replit's own managed Object Storage bucket (`cloudPersistence.ts`), credentials brokered
through a local Replit sidecar (`audience: "replit"`) — not infrastructure PUB controls.

**Our exposure**: none — confirmed no `cloudPersistence.ts` equivalent exists here; this repo
persists everything to real Postgres via `lib/db`, already established well before this audit.

### 7. WLS ingestion — already authenticated here; the risky half doesn't exist in this repo

**Replit's approach**: `wls-android-forwarder` (a standalone Android app, out of this migration's
scope from the start) posts raw water-level-sensor SMS content — sensor ID, readings, named
drainage-infrastructure locations — to a hardcoded default `https://location-tracker-pubpmv9.replit.app/api/wls/ingest`,
**with no authentication at all**.

**Our exposure**: the forwarder app itself isn't part of this repo. This repo's own
`/wls/ingest` route (`routes/wls.ts`) already requires `requireManager` — there is no
unauthenticated device-to-server ingestion path here at all; WLS data entry is manual/paste-based
through the app, not an automated SMS relay. No action needed in this repo, though worth a
separate operational check (outside this repo's scope) on whether any real physical device is
still configured to hit that unauthenticated Replit URL in production.

### 8. Not applicable — apps that don't exist in this repo

WhatsApp click-to-chat with named-staff numbers (`mockup-sandbox/Warehouses.tsx`), the native
Google Maps SDK key duplication and Partner Portal map (`deployment-tracker`), AI Flood Scan
(`aiFloodScan.ts` — scans public social/news sources for flood images, sends nothing of ours out,
but declined for porting earlier in this resync on cost/ToS grounds, unrelated to this audit),
`partnerReports.ts`, `imsUsers.ts`, `electoralBoundary.ts` — all confirmed absent from
`artifacts/` here (`ls artifacts/` only shows `api-server` and `roster-dashboard`).

### 9. Accepted as low-risk, no action taken

OneMap Singapore's *search* API (already unauthenticated, official `.gov.sg`, used for deployment
location search and CRMS complainant-address geocoding — complainant name/contact stay internal,
only the address string goes out); NEA rain radar and MPA tide feeds (pull-only, official,
unchanged); Web Push notification payloads that include manager/officer names (`meetings.ts`) —
inherently safe since Web Push (RFC 8291) end-to-end encrypts the payload before it leaves this
server, so the push relay (Google FCM/Mozilla/Apple) only ever sees ciphertext.

## Verification

All three code-changed items: `typecheck:libs` + `api-server` + `roster-dashboard` clean,
production builds (`node ./build.mjs`, `vite build`) clean. Items 1 and 2 additionally verified
against **live** external APIs (real NEA lightning data pulled during implementation; real OneMap
credentials tested end-to-end across 3 coordinates, catching and fixing the "NIL" sentinel bug
before shipping) — not just documentation.

Committed as `5a0a149` on `github-init`.
