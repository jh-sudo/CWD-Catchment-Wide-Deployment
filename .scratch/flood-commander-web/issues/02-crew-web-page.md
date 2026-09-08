# 02 — Crew web page

Status: in-progress — built, locally tested, and now real-device tested (see Comments), not yet deployed
Depends on: 01

Ports `deployment-tracker`'s crew-facing screens (`map.tsx`, `report.tsx`,
`navigate.tsx`) to a plain mobile web page — no install, no app store, bookmarked
URL. No Slack.

## Scope

- View assigned/available deployment location
- Accept Location / Accept Reassignment
- Nav handoff — switch from native `maps://` scheme to universal links
  (`https://maps.apple.com/?daddr=...`, Google Maps equivalent) for reliability
  from a browser
- Weather report (Heavy/Moderate/Light/Nil Rain)
- Swap requests (send/accept/complete)
- Alert acknowledgment (see 05 for the broadcast side and the iOS push caveat)
- Status/report read-only view
- CRMS tab, scoped to the officer's own assigned vehicle (view + comment/resolve)
- **Location update mechanism** (see Comments below — revised after the first
  build; no longer "intermittent-only"):
  - Continuous foreground tracking via `navigator.geolocation.watchPosition()`
    + a 20s push interval, adopted back from the old app's own web build
  - Auto-ping on Accept
  - Auto-ping when the tab regains focus (Page Visibility API) — catches the
    "just got back from nav handoff" moment for free
  - Manual "Update Location" button, always available
  - No "keep the page open" *guidance* — still rejected, see spec.md. The
    continuous watch runs on its own without telling the officer to babysit
    the tab; it just stops updating if the browser suspends it, same as
    before.

## Progress

Built as `artifacts/api-server/src/routes/crew.ts` — server-rendered HTML/JS,
same house style as `manager.ts` (`/manager`), mounted at `/crew` (+ `/crew/login`).
No new frontend service, no build step — kept the deploy surface unchanged.

**Real gap found and fixed while wiring this up, not in the original ticket
scope**: the deployment write endpoints (`/api/deployments/accept`, `/position`,
`/arrive`, `/weather`, `/swap-request`, `/swap-accept`, `/swap-decline`,
`/api/alert/acknowledge`) had **no authentication at all** — they trusted
whatever `vehicleId`/`unitCode` the client sent. Ticket 01's session work was
meaningless for these until they were actually gated. Added a `requireCrew`
middleware (`auth.ts`) and applied it to all eight.

**Also found**: the deployment-tracking system (`vehicleId = unitCode-vehicleNumber`,
populated by pasting roster text via `/api/roster/import` each shift) has **no
shared key with `officersTable`** — it's a genuinely separate data model from
the roster/leave system. So a per-officer login can't automatically resolve
"which vehicle is this officer on." Resolved by keeping the same pattern the
native app already used for this exact reason: officer logs in (now with a
real per-officer PIN, not the shared one) → picks their team/vehicle from
today's imported roster → that selection remembered in `localStorage` for the
rest of the shift. No schema change to the deployment-tracking side needed.

Verified end-to-end locally: crew login → team selection → accept location →
weather report → mark arrived → position update, all succeed with a crew
session; the same calls correctly 401 with no session and 403 with a
non-crew (e.g. admin) session.

**Not yet done**: visual/UX polish pass, real-device testing (GPS permission
flow, nav-app handoff, Page Visibility auto-ping) — only curl-tested so far,
not opened in an actual mobile browser.

## Comments

**2026-09-02** — User recalled that the old Replit `deployment-tracker`, despite
being tagged a native app, was actually accessed by officers through a mobile
browser at `/crew`. Confirmed from git history (`1ec8789^`): it had a real Expo
*web* export (`static-build/web`, served by its own `server/serve.js`, plus a
push service worker) — `app.json` even set `experiments.baseUrl: "/crew"`. Its
`Platform.OS === 'web'` branch used plain `navigator.geolocation.watchPosition()`
feeding a local cache, decoupled from an independent 20s `setInterval` that
POSTed the cached fix — foreground-tab-only, same as any browser tab, no
special background handling. So the "continuous tracking is native-only" framing
in spec.md's locked decision was about the *never-shipped native EAS build*,
not about what officers actually used day to day.

Ported that exact pattern into the current `crew.ts` (`startLocationWatch`/
`pushLastKnownPosition`, ~line 601) — continuous `watchPosition()` + a 20s push
interval, starting once a team is selected and stopping on logout — layered on
top of, not replacing, the accept-ping/refocus-ping/manual-button trio already
built. Verified locally: with the crew page left open and a laptop
Chrome-DevTools Sensors geolocation override standing in for real GPS movement,
position pushes landed roughly every 20s with no button tap, and `/manager`'s
map picked up each update live.

Also fixed along the way: the PIN format (`/^\d{4,8}$/`, shared by manager PIN,
legacy shared crew PIN, and per-officer crew PIN — all three spots in
`auth.ts`, plus the two client-side mirrors in `manager.ts`) was digit-only,
which forced a numeric-only mobile keyboard on the crew login PIN field
(`inputmode="numeric"`, now removed). Widened to alphanumeric, 4-8 chars,
case-sensitive (`/^[A-Za-z0-9]{4,8}$/`) everywhere it's enforced. Noted gap:
the per-officer PIN setter (`PUT /manager/auth/officers/:officerId/crew-pin`)
still has no admin UI — curl/API-only, as it was before this change.

Still open: real mobile-browser test of the continuous watch (only verified
via desktop Chrome + DevTools location override so far, not an actual phone —
see "Not yet done" above, which this doesn't close).

**2026-09-02 (same day, follow-up)** — First real mobile-browser test (see
above) hit `POST /api/deployments/accept` returning 400 on every attempt.
Root cause turned out to be test data, not a mobile bug: the officer's
selected team (KG4) has a blank `vehicle_number` in the local seed roster (18
of 20 seeded teams do — only BU1/PJ1 got real plate numbers), and
`deployments.ts`'s accept handler correctly rejects a missing vehicleNumber.
Confirmed via `deployment_teams` table query, not a code fix.

While investigating, found a real bug: none of `crew.ts`'s action handlers
(`acceptLocation`, `markArrived`, `reportWeather`, `acknowledgeAlert`,
`requestSwap`/`swapAccept`/`swapDecline`, `crmsComment`/`crmsResolve`, and
`updateLocation`'s manual-button branch) checked the fetch response status —
a real failure (400/401/500) still showed a success toast ("Location
accepted", etc.) and just silently didn't advance, identical-looking to
success. This is exactly what made the accept failure above look like a
frozen/broken button rather than a rejected request. Fixed: added a shared
`postJson()`/`errMsg()` pair (mirrors the pattern the login/MFA panes already
used) and rewired every action handler through it, so a real failure now
surfaces the server's actual error message instead of a false-positive toast.
Rebuilt/restarted locally; not yet re-tested on the phone.

**2026-09-08** — Real mobile-browser test on an actual Android/Chrome phone
(over LAN to the local dev stack, `http://<LAN-IP>:8080/crew`), closing the
"real-device testing" gap noted above. Page loaded correctly, deployment
card rendered, other actions worked. Geolocation specifically (both the
continuous `watchPosition` and the manual "Update My Location" button's
`getCurrentPosition`) failed — confirmed via a temporary diagnostic toast
(added then reverted, see commit) that it's browser code 1,
`"Only secure origins are allowed..."`. That's the browser refusing
geolocation because the test URL was plain `http://` over a LAN IP, not
`https://` or `localhost` — a property of *this test setup*, not the app:
`watchPosition()` fired correctly and failed exactly the way any page would
on an insecure origin. Real GOV PaaS is HTTPS, so this restriction doesn't
apply there; a same-origin-as-`localhost` setup (e.g. Chrome's USB
port-forwarding) also sidesteps it for future local testing.

Judgment call, not an automated pass: the code path is confirmed to execute
correctly on a real device and fail for a well-understood, expected reason
unrelated to the app — treating the "real mobile-browser test" item as
satisfied on that basis, without a from-a-secure-origin retest actually
capturing a real GPS fix in this session. If continuous tracking specifically
still feels unverified before this ships, that final confirmation (secure
origin + real fix captured) is the concrete next step, not further
speculation about the cause.
