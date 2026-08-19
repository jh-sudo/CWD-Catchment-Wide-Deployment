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
- **Continuous live GPS tracking is explicitly given up.** `watchPositionAsync`'s
  background tracking is native-only — mobile browsers suspend background tabs
  (iOS Safari especially). Replaced with **officer-initiated intermittent updates**:
  auto-ping on Accept, auto-ping when the tab regains focus (Page Visibility API,
  e.g. after returning from a nav-app handoff), plus a manual "Update Location"
  button always available. "Keep the page open" was considered and rejected as
  official guidance — it structurally conflicts with the nav handoff (opening
  Google/Apple Maps backgrounds the CWD tab at exactly the moment position is
  changing) and fails silently rather than obviously.
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
