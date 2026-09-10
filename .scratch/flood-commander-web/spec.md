# Flood Commander Dashboard — web migration

## Why

`deployment-tracker` (Expo/React Native, native app for both crew and commander roles)
has never been distributed to a real device. Under GovTech's Vibe Coding Playbook
(`context/Vibe Coding Playbook v1.docx`), any native/locally-run app is forced into
**Archetype 4** (WOG/Public tier — required SSP, VAPT, CISO+CIO+IDSC approval)
regardless of data classification or actual deployment scope. Rebuilding its
functionality as a web app keeps CWD eligible for the much lighter **Archetype 3**
(Agency Use — everything recommended, not required), assuming data classification
holds at OC/Non-Sensitive.

## Locked decisions

- **Target: Archetype 3.** Assumed data classification: OC/Non-Sensitive (provisional
  — not yet confirmed by anyone with actual classification authority).
- **`/inspector/` (photo+GPS inspection reports) deliberately excluded from this round**
  — its infrastructure-GPS data was the main thing that could've pushed classification
  to Sensitive-Normal. Excluding it makes the OC/Non-Sensitive assumption more
  defensible, not just convenient.
- **`wls-android-forwarder` removed entirely** (see git history, Aug 2026) — never
  deployed on the real Replit account, no `.replit-artifact/artifact.toml`, and its
  only function (background SMS forwarding) can't become a web page anyway. The WLS
  *feature* (backend parsing, schema, manager-page panel, manual-paste ingestion)
  is untouched and stays exactly as it is.
- **No Slack.** Originally explored to dodge the native-app archetype trigger and the
  WhatsApp-clutter reporting habit. Dropped because: (a) Slack has no geolocation API,
  so it doesn't remove the web-page hop, just adds one in front of it; (b) it's a
  third-party SaaS that would need its own IDSC tool-risk-acceptance, reopening the
  exact kind of hop this whole effort exists to avoid; (c) with the reduced scope
  (no weather/swap/report flows moving anywhere), Slack's main advantage evaporated.
- **Background/backgrounded-tab GPS tracking is still given up — continuous
  foreground tracking is not.** (Revised 2026-09-02, see issue 02's Comments.)
  Originally this bullet gave up *all* continuous tracking, reasoning that
  `watchPositionAsync`'s background tracking is native-only and mobile browsers
  suspend background tabs (iOS Safari especially). That conflated two different
  things: the never-shipped native EAS build, and what officers actually used —
  the old app's own Expo *web* export at `/crew` (`server/serve.js`,
  `static-build/web`), which ran in a plain mobile browser tab and got
  continuous position updates via ordinary `navigator.geolocation.watchPosition()`
  the whole time that tab stayed foregrounded, same as any web page. That part
  wasn't native-only and works the same way in the current build.
  Current mechanism: continuous `watchPosition()` + a 20s push interval while
  the tab is open (ported from that old web build), *plus* auto-ping on Accept,
  auto-ping when the tab regains focus (Page Visibility API, e.g. after
  returning from a nav-app handoff), plus a manual "Update Location" button
  always available — the three-trigger fallback is what covers a
  backgrounded/suspended tab, since that part of the original reasoning still
  holds. "Keep the page open" is still not official guidance — the continuous
  watch doesn't depend on the officer being told to babysit the tab, it just
  stops updating on its own if the browser suspends it, same failure mode as
  before.
- **Full manager toolkit ported, not just the map.** `manager.tsx` (3,358 lines) is
  the bulk of the app's real functionality — MAP, LIST, LOCATIONS, ROSTER (crew
  assignment), ALERT (broadcast to crew), WLS, and full CRMS case management, not a
  thin map wrapper. All of it stays in scope. WLS needs zero new work — it already
  exists as a working web feature in `api-server`'s `/manager` page.
- **`manager.tsx`/`navigate.tsx` (reassignment, CRMS) survive** as web screens for
  commander/admin — confirmed still needed by whoever tracks officer deployment
  from a desk.
- **Domain naming, Business Owner naming, IDSC tool-stack risk-acceptance** — pushed
  back deliberately, tracked as org-level asks, not blocking this build.
- **SSP / central registration / Passing Gates review** — recommended-not-required
  at Archetype 3, deferred as "paperwork," not started.

## Known technical gotchas going in

- `react-native-maps` (MAP mode, location pickers) has to be rebuilt in Leaflet —
  `apa` already has the plumbing, the actual map logic doesn't port 1:1.
- No web equivalent for `expo-haptics` — drop, cosmetic only.
- `Share.share()` → Web Share API is unreliable on desktop browsers — needs a
  copy-to-clipboard fallback.
- iOS Safari only delivers web push to a page added to the home screen — plain
  browser tabs won't get push notifications. Affects ALERT broadcast reliability
  for crew on iPhones; needs either a home-screen-add nudge or a fallback (surface
  missed alerts prominently next time the page opens).
- Nav handoff should move from the native `maps://` custom scheme to universal
  links (`https://maps.apple.com/?daddr=...`) for reliability from a web page.

## Build sequence

See `issues/` — numbered in build order. 01 (auth) blocks 02 and 08 conceptually
(location updates need real attribution before they're worth building on).

**Corrected after 02 was built**: tickets originally numbered 03–07 (manager
map/locations/roster/alert/CRMS/WLS) assumed none of `manager.tsx`'s (native,
never-deployed) functionality existed on web. Wrong — `/manager`
(`artifacts/api-server/src/routes/manager.ts`) already implements essentially
all of it, live, confirmed deployed on GOV PaaS. Folded into a single ticket
03 (verify + add a staleness indicator for intermittent crew positions) —
see `issues/03-manager-dashboard-verify.md`.
