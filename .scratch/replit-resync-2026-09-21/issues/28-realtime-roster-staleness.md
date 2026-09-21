Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 7).*

## What this is

Replit's roster screens poll a cheap "has anything changed" endpoint every 10s (plus on tab
visibility change), so a change made in one browser/session shows up in another within ~10s
instead of only on window focus. This repo's `RosterVersionContext.tsx` only bumped on focus.

## What changed

**Frontend** — `artifacts/roster-dashboard/src/context/RosterVersionContext.tsx`: added a
`useEffect` that fetches `/api/roster-plan/version` every 10s and on `visibilitychange`, compares
the returned opaque `revision` string against the last-seen value, and on a change invalidates
every react-query cache entry whose key contains `"roster"` before bumping the existing version
counter. This is essentially a verbatim port of Replit's frontend logic — the frontend only
consumes an opaque string, so no Postgres-specific work was needed here.

**Backend** — `artifacts/api-server/src/routes/rosterPlan.ts`: new `GET /roster-plan/version`,
placed right after `rosterPlanRouter` is created (matching Replit's own placement).

## The one real adaptation: how to compute "has anything changed" without files

Replit's version reads a fixed list of 14 flat JSON files and `fs.statSync`s each one, building the
revision from `${basename}:${mtimeMs}:${size}` joined together. There's no direct equivalent here
— roster data lives in Postgres tables, not files with mtimes.

Two options considered:
1. Add an `updated_at` column to every roster-relevant table, bump it in every write path, and
   `MAX()` them together for the revision.
2. Read Postgres's own per-table write counters from `pg_stat_user_tables`
   (`n_tup_ins`/`n_tup_upd`/`n_tup_del`), which Postgres already maintains automatically for every
   table.

Went with (2): it's a system-catalog lookup (cheap, no data scan) and requires **zero** changes to
any existing write path — no risk of a mutation somewhere forgetting to bump a timestamp and
silently breaking the staleness signal. Queries the 14 tables that back the roster screens
(`officers`, `roster_patterns`, `roster_config`, `roster_requirements`, `roster_swaps`,
`roster_overrides`, `roster_leaves`, `roster_day_overrides`, `roster_cycle_meta`,
`roster_cycle_duties`, `ph_roster_ref`, `leave_requests`, `roster_vehicle_arrangements`,
`roster_vehicle_defaults`), builds `relname:ins:upd:del` per table, sorts and joins with `|`.

This is the first `db.execute(sql\`...\`)` raw-SQL call anywhere in `artifacts/api-server/src` —
every other query in this codebase goes through Drizzle's query builder. Necessary here because
`pg_stat_user_tables` is a system view Drizzle has no schema/table object for.

**Restart-safety epoch**: `pg_stat_user_tables` counters reset to 0 whenever Postgres restarts
(this differs from ticket 15's ETag epoch, which addressed a *Node app* restart — this one guards
against a *Postgres* restart, e.g. a failover or maintenance window). Without it, a client's cached
pre-restart revision string could coincidentally collide with the fresh post-restart counters and
mask a real change. Added `rosterVersionProcessEpoch = Date.now()` (set once at Node process
startup) appended to every revision string — since the Node process is very likely to restart
around/after any Postgres restart in this deployment model, this closes the gap without needing
its own separate persisted state.

## Worth knowing

- `GET /roster-plan/version` is unauthenticated at the route level (no `requireManager`) since it
  leaks no data beyond opaque counters — matches Replit's own endpoint, which is also open.
- Response has `Cache-Control: no-store` so no intermediate cache masks a real change.
- Polled every 10s by every open roster/crew/manager tab; this is a cheap catalog lookup, not a
  concern at this repo's scale, but worth knowing if this ever needs to scale to many more
  concurrent clients.
