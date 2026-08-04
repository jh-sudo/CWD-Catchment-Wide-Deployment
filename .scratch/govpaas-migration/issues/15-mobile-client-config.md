Type: grilling
Status: resolved

## Question

deployment-tracker and wls-android-forwarder are out of scope for hosting (per [scope decisions](00-scope-decisions.md)) but are API *clients* of api-server. Do they need any configuration answer from this migration — e.g. the blank Google Maps API keys, or an updated API base URL once api-server moves off its Replit domain? Decide whether api-server should serve this config (extending [secrets & config migration](08-secrets-config-migration.md)'s scope) or whether it's handled entirely client-side, out of this map's scope.

## Answer

### Why "api-server serves the base URL" doesn't work

The API base URL is inherently client-side/build-time no matter what: a mobile client would need to already know api-server's URL to fetch config *from* api-server, which is circular. So an api-server config endpoint could only ever serve secondary values (like the Maps key) fetched after the client already knows where api-server is — never the base URL itself.

### Decision

**All build-time, no api-server involvement.** Both the API base URL and the Maps key stay as plain client-side config in each mobile client's own build — no new api-server endpoint, no extension of [ticket 08](08-secrets-config-migration.md)'s secret-group scope into services that don't otherwise know these clients exist.

### Confirmed both clients already work this way — no new engineering needed

- **deployment-tracker**: already uses `process.env.EXPO_PUBLIC_API_URL` (build-time env var) throughout (`app/index.tsx`, `context/AppContext.tsx`, `app/(tabs)/{report,manager,map,navigate}.tsx`), falling back to `https://cwd-dashboard.replit.app` if unset. Already exactly the Option B pattern.
- **wls-android-forwarder**: `Config.java`'s `DEFAULT_API_URL` constant is only a *fallback* — the app has a working Settings screen (`MainActivity.java`, backed by `SharedPreferences`) letting a user edit and persist the API URL at runtime, no rebuild required. Already-installed devices don't need a new build at all to point at the new domain.

### What this ticket actually leaves as a future execution-time task

Once [ticket 13](13-domain-dns-tls.md)'s real domain is live: update `EXPO_PUBLIC_API_URL`'s build-time value for deployment-tracker, and update `wls-android-forwarder`'s `DEFAULT_API_URL` constant (for future fresh installs — existing installs can just have their Settings-screen URL updated). No code/architecture change, only value updates at cutover time.

### Side note (not part of this decision, flagged for later)

deployment-tracker's fallback (`cwd-dashboard.replit.app`) and wls-android-forwarder's fallback (`location-tracker-pubpmv9.replit.app`) are two *different* Replit domains — worth a sanity check separately, not blocking this ticket.

### Maps key

Stays exactly as described in the Notes below — deferred, non-blocking, unrelated to api-server or this migration's hosting/domain work.

## Notes (found during manual local testing, 2026-08-03)

- Confirmed there are actually **two separate Maps API keys** in deployment-tracker, not one:
  - `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — runtime JS env var, used only for the Directions API call in `context/AppContext.tsx`. Now has a real value in a local, gitignored `.env` (see `artifacts/deployment-tracker/.env.example`).
  - `app.json`'s `ios.config.googleMapsApiKey` / `android.config.googleMaps.apiKey` — native, **build-time** key baked into `AndroidManifest.xml`/`Info.plist` by Expo's prebuild step. Still a blank string, unwired. A plain `app.json` can't read `process.env` at all — this needs `app.json` converted to `app.config.js` (Expo dynamic config) before it can reference the same `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` value. One Google Cloud key can legitimately back both (Maps SDK Android+iOS + Directions API all enabled on it) — no security downgrade, Maps keys are meant to ship client-side, restricted by package name/bundle ID/SHA-1 in Google Cloud Console.
  - Not blocking today's testing — Expo Go ignores `app.json`'s native map config entirely (uses Expo's own bundled key). Only matters once a real native build happens (`eas build` / `expo run:android`). Deferred, not yet done.
- Northflank side confirmed to have no special mobile-config feature — if api-server ends up serving config (Option A), the Maps key/API URL would just be additional entries in the same secret group already decided in [ticket 08](08-secrets-config-migration.md). Northflank has no involvement with deployment-tracker itself since it isn't hosted there.
- Still undecided: Option A (api-server serves a small config endpoint) vs. Option B (stays as build-time `EXPO_PUBLIC_*` env vars). Leaning Option A (reuses existing secret-group infra) but not committed to.
