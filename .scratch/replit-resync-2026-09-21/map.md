# Replit resync — 2026-09-21

Catching this repo up on ~7 weeks of independent Replit development (fork point ~commit
`b74f331`, 2026-08-04, on Replit's own git history; 521 commits since, ~22,500 inserted lines
across the 4 in-scope surfaces). See `docs/agents/issue-tracker.md` for ticket conventions and
`.scratch/govpaas-migration/HANDOVER.md` §6 for the triage process this followed. Mirror repo
(full Replit git history) at `C:\Users\jhsto\Documents\CWD-replit-mirror-2026-09-21\`.

Scope: `/lightning`, `/roster` (api-server route + roster-dashboard SPA), `/crew`, `/manager`
only. `apa`, `inspector`, `deployment-tracker`, `mockup-sandbox`, `wls-android-forwarder` stay
excluded per the original migration decision.

## Decisions so far

- **`managerV2.ts` ("Mission Control") — not porting this round.** User confirmed it's still
  incomplete on Replit's own side.
- **`inspections.ts`, `imsUsers.ts`, `electoralBoundary.ts` — not porting.** Confirmed leaked
  scope from the excluded `inspector`/`mockup-sandbox`/`deployment-tracker` apps, not genuine
  `/manager` business logic. User also confirmed nobody actually uses `/inspector` at all.
- `hrBallot.ts` / `activityLog.ts` — already fully reconciled (Postgres rewrite covers Replit's
  behavior); `NoteIndicator.tsx` already at parity. No action.
- `strength.ts` / `phStrength.ts` / `phUnitOrder.ts` / `clipboard.ts` — not a separate feature,
  just plumbing the in-scope pages below now depend on. Ported alongside those tickets rather
  than as its own decision.
- **Auto-deployment on Heavy Rain Warning — approved, with a condition: must default OFF, admin
  AND manager can toggle.** User's call: port it, but the enable toggle (already present in
  Replit's own version — `/auto-deployment/status`, `/auto-deployment/enabled`, surfaced in
  `manager.ts`'s UI) must default to disabled; admin/manager can turn it on explicitly.
  **Verified**: Replit's own `auto-deployment.ts` already defaults `enabled: false` (line 26), so
  no override needed there — just port as-is. **One real gap to fix while porting**: Replit gates
  `POST /auto-deployment/enabled` with `requireAdmin` only — widen to `requireAdminOrManager` (or
  equivalent) to match the user's explicit ask that manager can toggle it too, not just admin.
- **AI Flood Scan — declined, not porting.** User's call after hearing the cost-tracking
  implication (implies a metered/paid call per scan) and the social-media-scraping ToS question —
  held back rather than approved.
- **Partner reports / PUB Tier 3 — deprioritized, not a hard no.** Its whole purpose is external
  (LTA/NParks) access, and this repo isn't internet-facing yet, so it'd be unreachable by its
  intended users if built now. Its auth model (one shared 6-digit PIN per agency, no MFA) is also
  a real step down from the MFA-mandatory model everywhere else here, so unlike most items on
  this list it isn't a straightforward "port the code" job — it needs its own security-hardening
  pass first. Revisit once internet-facing clearance is closer. See
  `.scratch/replit-resync-2026-09-21/HANDOVER-PHASE2.md`-adjacent memory note for the
  `deployment-tracker`/Expo-web deep-dive this came out of.

## Not yet specified — new-capability scope decisions (need your call, not silently ported)

Each of these is a genuinely new feature on Replit's side, not a fix to something that already
exists here. Flagging per HANDOVER §6 point 4 ("new feature — separate scope decision, not a
silent drop-in"), roughly in the order I'd guess they matter:

1. **Partner reports / PUB Tier 3** (`partnerReports.ts`) — external LTA/NParks incident-reporting
   portal, PIN-based login. Different trust boundary than internal manager auth (externally
   reachable once this repo gets internet-facing clearance) — this one especially deserves a
   security-scoped decision, not just "port it."
2. **AI Flood Scan** (`aiFloodScan.ts`) — scans public/social sources for flood photos, does
   image-reuse/AI-edit forensics. Outbound network calls + `sharp` image processing; already
   wired into the existing `/manager` map UI on Replit's side.
3. **Auto-deployment on Heavy Rain Warning** (`auto-deployment.ts`) — auto-triggers a full roster
   deployment when a Heavy Rain Warning SMS is detected. Hooks into `wls.ts`, which already
   exists here. Has both an API side and an admin toggle in `manager.ts`'s UI.
4. **Meetings scheduler** — propose/vote on meeting slots, calendar, reminders, push. Lives
   inside the roster-dashboard SPA at client routes `/manager` + `/manager/calendar` (5
   interdependent files: `meetings.ts`, `useMeetings.ts`, `Meetings.tsx`, `ManagerDashboard.tsx`,
   `ManagerCalendar.tsx`).
5. **PH Builder** — a configurable/preset-driven auto-generation layer for the PH roster
   (`PHBuilder.tsx` + `phRoster.ts`'s `builder-config`/`builder-presets`/`builder-run`),
   alongside the existing manual PH roster editor.
6. **Strength/minimum-manning overhaul** — per-shift weekday/weekend/PH minimum bands, 3-tier
   (not 2-tier) coloring, named date exceptions, config-driven instead of hardcoded. Current
   in-scope tickets below only fix the *display wiring*, not this underlying model gap — see
   [08](issues/08-ph-actual-panel-unit-order-wrong.md) note and ticket
   [11](issues/11-rosterlistview-covering-crosspost-bugs.md)'s cross-reference.
7. **Real-time cross-client staleness fix** — Replit polls a cheap "has anything changed"
   endpoint every 10s; ours only refreshes on window focus. Needs a Postgres-appropriate
   revision signal (Replit's mtime/size-hash trick won't translate) — small and self-contained
   (`RosterVersionContext.tsx`, 49 lines) if picked up.
8. **`requireRosterEditor` role** — a new auth role distinct from manager/admin, used to gate
   leave edits and config changes on Replit's side. Needs a decision on who counts as one and
   how it's granted.
9. **Bulk multi-date Excel import** (`UploadBrief.tsx`) — horizontal and vertical multi-date
   parsers, revert-import button, per-cell comments, full-year export. Current ticket
   [20](issues/20-uploadbrief-grid-bugs.md) only covers bug fixes to the existing single-date
   importer, not this larger feature.
10. **Leave "chain of cover" auto-reassignment** (`leaveRequests.ts`) — when an officer who is
    themselves covering someone else applies for leave, automatically requires/wires in a
    replacement rather than leaving the original post uncovered again. Ticket
    [03](issues/03-leave-cover-validation-gaps.md) covers the validation-only piece; this
    automation is a step further.
11. **Per-sector CAT1 lightning subscription + map/UX changes** — tap zones on the public
    `/lightning` page to only be alerted for those sectors, OSM tiles instead of CARTO, lightning
    auto-enabled instead of a manual toggle.
12. **Deployments auto-sync + reverse geocoding** — `syncDeploymentRosterFromCentralSource()`
    (auto-pull today's roster into live deployments instead of manual paste-import) and a
    `/search/sg/reverse` endpoint.
13. ~~**`optimize-assign` reassignment enhancement**~~ — **Done, see
    [22](issues/22-optimize-assign-reassignment.md).** User approved porting the rest of the list
    2026-09-21.
14. ~~**`MasterView.tsx`**~~ — **Done, see [23](issues/23-master-view-crew-readonly.md).**

## Bug/fix tickets — all 21 done

See `issues/` for full detail on each. Status noted where a ticket's outcome diverged from its
original triage (several original findings didn't hold up on inspection — this repo's actual
architecture in a few areas is already ahead of what the triage assumed from Replit's side; see
each ticket's own Comments section):

| # | Ticket | Severity | Outcome |
|---|---|---|---|
| 01 | [Roster-plan leave endpoint has no auth guard](issues/01-security-roster-leave-endpoint-missing-auth.md) | High (security) | Fixed |
| 02 | [2027 Hari Raya dates wrong](issues/02-ph-2027-dates-wrong.md) | High | Fixed (verified vs MOM gazette); DB migration check still open, needs prod access |
| 03 | [Leave/cover validation gaps](issues/03-leave-cover-validation-gaps.md) | High | Fixed |
| 04 | [Leave `appliedBy`/`appliedAt` never persisted](issues/04-leave-applied-by-fields-not-persisted.md) | Low | Fixed |
| 05 | [Vehicle plate not wired to Vehicle Arrangement](issues/05-vehicle-plate-not-wired-to-arrangement.md) | Medium-high | Fixed |
| 06 | [PH-day not authoritative outside PHHoliday.tsx](issues/06-ph-day-authority-gaps.md) | High | 3 of 4 sub-items were already handled by this repo's architecture; the 1 real gap fixed |
| 07 | [PH roster generation missing fairness guardrails](issues/07-ph-roster-generation-guardrails.md) | Medium | Fixed |
| 08 | [PH Actual Panel unit order wrong (WK4 missing)](issues/08-ph-actual-panel-unit-order-wrong.md) | Medium | "WK4" claim didn't hold up (not a real unit here); the real ordering-inconsistency bug fixed |
| 09 | [Historical PH data spot-check](issues/09-historical-ph-data-spot-check.md) | Low (verification) | Left open — needs DB access this session didn't have |
| 10 | [FIRB summary double-lists officer / no REST-vs-OFF split](issues/10-firb-summary-double-listing-and-off-rest.md) | Medium | Fixed |
| 11 | [RosterListView covering/cross-post bugs](issues/11-rosterlistview-covering-crosspost-bugs.md) | Medium-high | Items 1-2 fixed; item 3 (new display states) left for a future pass, not concrete enough to implement safely |
| 12 | [Roster views: stale-response race condition](issues/12-roster-views-stale-response-race.md) | Medium | Already fixed on this side — original triage was wrong |
| 13 | [Clipboard copy fails silently](issues/13-clipboard-copy-silent-failure.md) | Low | Fixed |
| 14 | [CrewSchedule/MySchedule duty display + partner bugs](issues/14-crew-schedule-duty-display-and-partner-bugs.md) | Medium-high | Fixed; Layout.tsx "Crew Today" widget claim didn't hold up (no such widget exists) |
| 15 | [Deployments: roster-import and state-integrity bugs](issues/15-deployments-roster-import-and-state-bugs.md) | Medium-high | Fixed all 4 |
| 16 | [Manager rain-assign not gated on movement noise](issues/16-manager-rain-assign-noise-gate.md) | Medium | Fixed — found an existing, already-correct endpoint (`optimize-assign`) the frontend just wasn't calling, so switched to it instead of rewriting from scratch |
| 17 | [Lightning CAT1 alert raw timestamp / first-sector-only](issues/17-lightning-cat1-alert-timestamp-and-sectors.md) | Low-medium | Fixed |
| 18 | [Push notifications: manager role never subscribed](issues/18-push-notifications-manager-role-not-subscribed.md) | Medium | Fixed |
| 19 | [ApplicationsManage: unsafe self-service wipe-all button](issues/19-applications-manage-unsafe-wipe-button.md) | High | Removed entirely, per user decision |
| 20 | [UploadBrief grid bugs](issues/20-uploadbrief-grid-bugs.md) | Medium | Fixed all 5 |
| 21 | [Register page should use officer-names endpoint](issues/21-register-page-officer-names-endpoint.md) | Low | Fixed, with an `activeOnly` param added to avoid a filtering regression |

Every fix passed `pnpm typecheck` (`api-server` + `roster-dashboard`) before being committed —
21 commits total on `github-init`, one per ticket (ticket 03+04 shared a commit, same insert
statement). The pre-existing, unrelated `scripts` package typecheck failures were present before
this work started and were left alone (out of scope).
