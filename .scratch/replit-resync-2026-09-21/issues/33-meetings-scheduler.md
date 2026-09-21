Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 4) — the last remaining item in this whole
> resync effort, deliberately saved for last as the biggest lift. Covers a genuinely new
> Postgres-backed feature: propose/vote-on meeting slots, reusable attendee groups, personal
> out-of-office calendars, reminders, and push notifications, restricted to the `manager` role.*

## What this is

A meeting scheduler living in its own workspace inside the roster-dashboard SPA
(`/manager`, `/manager/meetings`, `/manager/calendar`), separate from the existing Crew Roster
views. A manager proposes a meeting with 2+ candidate AM/PM slots and required/optional
attendees; invited managers vote on which slots they can attend; once every *required* attendee
has responded the poll becomes "ready" and the organizer manually picks the final slot; the
meeting is then "confirmed" and stays in history indefinitely. Reusable named attendee groups,
personal leave/out-of-office calendars (merged with the existing leave-request system, shown as
non-blocking conflict warnings to organizers), a 2-hour-cadence reminder nudge for attendees who
haven't voted, and push + in-app notifications throughout. Admin gets read/delete-only access;
`ic` and crew have none.

## Backend — Postgres design deliberately simpler than a full normalization

Reference stores each `Meeting` as one JSON blob (proposed slots, per-attendee responses, and
per-attendee reminder state all nested inside it) and always reads/writes the *entire* meetings
array for any mutation — a pattern that only existed to work around flat-JSON-file storage having
no per-row API. A fully-normalized Postgres translation (separate `meeting_slots`,
`meeting_attendees`, `meeting_responses`/`meeting_availability` join table, `meeting_reminders`
tables) was considered and explicitly **not** used — instead, one `meetings` table with
`proposed_slots`/`responses`/`reminder_state` as jsonb columns, matching this codebase's own
established convention for "read/written as one unit" nested data (`roster_patterns.data`,
`ph_hr_ballot_state.pools`, `ph_builder_presets.config` — see each of those schema files' own
comments making the identical argument). No UI or query pattern here needs to look across
meetings at the slot/response level, so normalizing would have added real surface area (rewriting
every array/object mutation as SQL joins/inserts across 5+ tables) for no practical benefit.
Mutations became targeted single-row `db.insert/update/delete` calls (one per meeting, or a
caller's own groups/events) instead of reference's whole-array rewrite — a genuine improvement
Postgres makes easy that flat-JSON couldn't.

New tables: `meetings`, `meeting_groups` (an organizer's own reusable named attendee lists),
`manager_calendar_events` (personal leave/OOS ranges). New columns: `managers.meeting_groups`
(a manager's self-tagged org groups, from a fixed enum — unrelated to `meeting_groups` the table,
which is per-organizer reusable *attendee* lists) and `push_subscriptions.account_id`.

## Backend — auth and push additions

`meetings.ts` needed two capabilities `auth.ts`/`push.ts` didn't have yet:
- `getApprovedAccountSummaries()` / `setManagerMeetingGroups()` — added to `auth.ts` alongside the
  existing `getManager()` synchronous in-memory-cache pattern (the same cache every other
  `requireManager`-gated route already depends on, refreshed after every mutation).
- `sendToAccount(accountId, payload)` — added to `push.ts`. Required first adding
  `push_subscriptions.account_id`, set only from the caller's own session at subscribe time
  (`type === "manager" ? req.session.managerId : null`) — never a client-supplied value, so one
  account can never subscribe on another's behalf. Every meeting notification (invitation,
  reminder, ready-to-confirm, response progress, confirmed) targets one specific manager; none of
  it is a role-wide broadcast.

## Backend — reminder monitor: new file, not embedded in the routes module

Reference's 2-hour-cadence attendee reminder scan is a `setInterval` started as a side effect of
importing `meetings.ts` itself. Split out into a new `artifacts/api-server/src/meeting-reminders.ts`
exporting `startMeetingReminderMonitor()`, called from `index.ts` only after `app.listen()`
succeeds — matching the existing `lightning-monitor.ts`/`radar-monitor.ts` convention for
"periodic background check" modules in this codebase, rather than reference's own less
explicit/harder-to-reason-about pattern. One deliberate difference from `lightning-monitor.ts`:
this one runs its **first check immediately** at boot rather than delaying 2 minutes — the
whole point of the durability rule it's implementing (persist each attendee's next-due time
*before* sending their push, so a restart can't duplicate a reminder) is that a restart shouldn't
add extra delay before catching up any reminder that fell due while the API was down.

## Frontend — plain fetch(), not the generated OpenAPI client

`useMeetings.ts` uses hand-written `fetch()` calls wrapped in React Query hooks, not
`@workspace/api-client-react`. This matches reference's own precedent for this exact feature (its
`useMeetings.ts` never touches the generated client either) and this repo's own existing escape
hatch (`usePushSubscription.ts` already does the same) — avoided hand-patching ~15 new endpoint
shapes into `api.schemas.ts` for a codegen toolchain that's currently broken for unrelated reasons
(see ticket 30's notes on the zod/orval version drift).

## Frontend — navigation restructuring (worth double-checking)

Reference's design makes the meeting workspace a manager's primary landing page, not an add-on:
`/` now redirects `role === "manager"` accounts straight to `/manager` (the meeting dashboard)
instead of showing the crew roster; `/crew-roster` becomes the escape hatch back to the roster
view; a "Manager / Crew Roster" toggle in the sidebar switches between the two contexts; the nav
list itself changes shape depending on which context you're in. This is a genuine, real behavior
change for existing manager accounts' default landing page, not just new pages bolted on. It's
also clearly the *intended* design (the reference repo's own memory doc for this feature states
outright: "Its root is an action-focused meeting dashboard" — a deliberate principle, not an
accident), and porting the feature "as designed" was already approved — so this was implemented
rather than treated as a fresh open question, but it's flagged here explicitly since it's the one
part of this ticket most likely to surprise a manager opening the app the next time.

## Worth knowing

- `ManagerCalendar.tsx`'s merge of the existing leave-request system uses `user.officerId` — a
  field only ever populated on crew-role accounts in this codebase's data model (`managers.officer_id`'s
  own schema comment says as much). A manager account typically has no linked officer record, so
  the "combine your approved/pending leave into My Calendar" half of this page will show nothing
  for most managers in practice — this is reference's own actual behavior (same field, same
  assumption on their side), ported faithfully rather than "fixed," since it isn't a bug this port
  introduced.
- The overall minimum/full-response semantics: *required* attendees gate the collecting→ready
  transition; *optional* attendees never do, but both get invitations, reminders, and count toward
  the displayed response tally.
- No `"cancelled"` status exists — deleting a meeting is the only way to remove it; there's no
  soft-cancel state to design around.
