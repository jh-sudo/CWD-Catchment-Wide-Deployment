Type: bug
Status: done

> *Found during a two-axis (Standards/Spec) code review of the whole resync effort's diff
> (`3651de4...HEAD`), requested by the user after an earlier high-effort `/code-review` pass. Not
> a Replit-side gap — a bug introduced in this repo's own [ticket 26](26-require-roster-editor-role.md)
> commit (`f79d12c`).*

## What's wrong

`seedAdmin()` in [auth.ts](../../../artifacts/api-server/src/routes/auth.ts) randomizes the
manager/crew PINs on first boot specifically to avoid a hardcoded, repo-readable working
credential — the comment right above it says so explicitly:

> "Random, not a fixed default — a hardcoded value here would be a known working credential for
> anyone who reads the source, not just an internal convenience."

Two lines later, the admin account seeded in the same function still used the literal password
`"Admin@1234"`. Same exposure class the PIN fix was written to close, left open one function away.
The only compensating control was `mustChangePassword: true` forcing a change on first login — but
that only helps once someone actually logs in; until then, `admin` / `Admin@1234` is a live,
source-visible credential on any freshly (re)provisioned environment.

## Impact

Anyone with repo read access has a working admin login for every environment that hasn't had its
first admin login yet (fresh deploys, a DB restore predating rotation, or any environment nobody's
logged into as admin since it was seeded).

## Fix — done

Added `generatePassword()` (16 random bytes, base64url — well over the existing
`PASSWORD_MIN_LENGTH = 12` check) alongside the existing `generatePin()`, and seed the admin
account with it instead of the literal string. Logged once via `console.log`, same pattern as the
PINs, with `mustChangePassword: true` kept as-is. `artifacts/api-server/src/routes/auth.ts`.
