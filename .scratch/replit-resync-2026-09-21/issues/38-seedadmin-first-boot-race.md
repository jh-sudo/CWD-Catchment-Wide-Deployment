Type: bug
Status: done

> *Found during the same two-axis code review as [ticket 37](37-admin-password-still-hardcoded.md).
> Also in `f79d12c`'s `seedAdmin()` rework.*

## What's wrong

`seedAdmin()` in [auth.ts](../../../artifacts/api-server/src/routes/auth.ts) was called
fire-and-forget (`seedAdmin();`, no `.catch`), and its `app_config`/admin-row inserts had no
conflict handling.

## Impact

On the very first boot after `app_config` has no row — a fresh deploy, or a table recreated by
this repo's self-healing `startupMigration.ts` pattern — if the api-server ever runs with more
than one replica, or restarts overlap, two processes can both pass the `!configRow` /
`!managers.find(...)` checks and both attempt the same primary-key insert. The loser's insert
rejects; with no `.catch` and no `process.on('unhandledRejection', ...)` handler anywhere in
api-server, Node's default policy kills that process — a boot crash-loop instead of a clean start.
Low-probability today (this service currently runs single-instance), but a real gap in a shared
boot-time code path.

## Fix — done

- Added `.onConflictDoNothing().returning()` to both the `app_config` insert and the admin-account
  insert, gating the seed log line on whether this process actually won the insert (`if (inserted)`)
  so a losing replica doesn't log PIN/password values that were never persisted.
- Added `.catch()` to the top-level `seedAdmin()` call, logging via `console.error` rather than
  crashing the process on an unexpected failure.

`artifacts/api-server/src/routes/auth.ts`.
