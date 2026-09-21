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
13. **`optimize-assign` reassignment enhancement** — letting the no-rain "nearest selected" mode
    reassign already-deployed teams to a closer location, not just fill unassigned ones. Smaller
    than the others; could be folded into ticket
    [16](issues/16-manager-rain-assign-noise-gate.md)'s pass if wanted.
14. **`MasterView.tsx`** — a small crew-role-only read-only wrapper around the existing
    Master/Excel grid editor. Low priority; worth checking if crew currently has *any* read
    access to that grid, but not a high-value item on its own.

## Confirmed bug/fix tickets (ready to implement, no scope decision needed)

See `issues/` — 21 tickets, numbered roughly by severity/theme:

| # | Ticket | Severity |
|---|---|---|
| 01 | [Roster-plan leave endpoint has no auth guard](issues/01-security-roster-leave-endpoint-missing-auth.md) | High (security) |
| 02 | [2027 Hari Raya dates wrong](issues/02-ph-2027-dates-wrong.md) | High |
| 03 | [Leave/cover validation gaps](issues/03-leave-cover-validation-gaps.md) | High |
| 04 | [Leave `appliedBy`/`appliedAt` never persisted](issues/04-leave-applied-by-fields-not-persisted.md) | Low |
| 05 | [Vehicle plate not wired to Vehicle Arrangement](issues/05-vehicle-plate-not-wired-to-arrangement.md) | Medium-high |
| 06 | [PH-day not authoritative outside PHHoliday.tsx](issues/06-ph-day-authority-gaps.md) | High |
| 07 | [PH roster generation missing fairness guardrails](issues/07-ph-roster-generation-guardrails.md) | Medium |
| 08 | [PH Actual Panel unit order wrong (WK4 missing)](issues/08-ph-actual-panel-unit-order-wrong.md) | Medium |
| 09 | [Historical PH data spot-check](issues/09-historical-ph-data-spot-check.md) | Low (verification) |
| 10 | [FIRB summary double-lists officer / no REST-vs-OFF split](issues/10-firb-summary-double-listing-and-off-rest.md) | Medium |
| 11 | [RosterListView covering/cross-post bugs](issues/11-rosterlistview-covering-crosspost-bugs.md) | Medium-high |
| 12 | [Roster views: stale-response race condition](issues/12-roster-views-stale-response-race.md) | Medium |
| 13 | [Clipboard copy fails silently](issues/13-clipboard-copy-silent-failure.md) | Low |
| 14 | [CrewSchedule/MySchedule duty display + partner bugs](issues/14-crew-schedule-duty-display-and-partner-bugs.md) | Medium-high |
| 15 | [Deployments: roster-import and state-integrity bugs](issues/15-deployments-roster-import-and-state-bugs.md) | Medium-high |
| 16 | [Manager rain-assign not gated on movement noise](issues/16-manager-rain-assign-noise-gate.md) | Medium |
| 17 | [Lightning CAT1 alert raw timestamp / first-sector-only](issues/17-lightning-cat1-alert-timestamp-and-sectors.md) | Low-medium |
| 18 | [Push notifications: manager role never subscribed](issues/18-push-notifications-manager-role-not-subscribed.md) | Medium |
| 19 | [ApplicationsManage: unsafe self-service wipe-all button](issues/19-applications-manage-unsafe-wipe-button.md) | High |
| 20 | [UploadBrief grid bugs](issues/20-uploadbrief-grid-bugs.md) | Medium |
| 21 | [Register page should use officer-names endpoint](issues/21-register-page-officer-names-endpoint.md) | Low |

All 21 are behavior differences confirmed still present in this repo's current code (not
already fixed by an earlier QA pass) — findings that duplicate already-known/already-fixed
issues (e.g. the PHHoliday.tsx date-filter bug, the mass-deactivate bug) are noted as
informational only and don't get their own ticket here.
