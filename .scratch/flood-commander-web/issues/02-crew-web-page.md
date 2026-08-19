# 02 — Crew web page

Status: in-progress — built and locally tested, not yet deployed
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
- **Location update mechanism** (replaces continuous `watchPositionAsync`):
  - Auto-ping on Accept
  - Auto-ping when the tab regains focus (Page Visibility API) — catches the
    "just got back from nav handoff" moment for free
  - Manual "Update Location" button, always available
  - No "keep the page open" guidance — rejected, see spec.md

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
