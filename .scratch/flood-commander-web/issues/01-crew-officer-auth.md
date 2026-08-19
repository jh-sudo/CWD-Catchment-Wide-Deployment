# 01 — Per-officer crew authentication

Status: in-progress — core mechanism built and locally tested, not yet deployed

## Problem

Today, crew "auth" (`artifacts/api-server/src/routes/auth.ts`) is a single shared
4-digit PIN (`appConfig.crewPin`, default `1234`), checked via
`POST /api/crew-pin/check` — a boolean pass/fail, no session or token issued.
*Which* officer is acting is picked from a self-declared roster dropdown in
`deployment-tracker`'s `index.tsx`, entirely disconnected from the PIN check.
Anyone who knows the PIN (presumably the whole crew) can submit an update as any
officer's name.

This was tolerable as a fallback inside a bigger native app. It stops being
tolerable once it's the primary way officers interact with the system — a location
update is meaningless if it can't be trusted to be from who it claims to be from.

## SSP controls this addresses

(`context/low-risk-cloud-ssp.xlsx_safe.pdf`)
- `ac-1` Least privilege — shared secret violates per-identity access
- `ac-6` Default credentials — PIN default (`1234`) is a live example of what this
  control flags
- `ac-11` Single user per endpoint — each officer's own phone should map to their
  own identity, not a shared secret
- `as-4` Rate-limiting — `/api/crew-pin/check` has none today
- `wu-14` Accessible authentication — whatever replaces this can't rely solely on
  a cognitive test (a per-officer PIN is fine)

## Scope

1. **Per-officer credential** — each officer record gets its own short code
   (proposal: reuse the existing roster/officer ID + a short PIN, not a full
   username/password — keep the tap-friction low for a field officer). Needs a
   schema change (officer-linked credential, not the single `appConfig.crewPin`
   row) and a new/replaced check endpoint that returns an officer-scoped
   session/token instead of a bare boolean.
2. **Rate-limit** the crew check endpoint (`as-4`).
3. **Manager side, while touching auth anyway** — two pre-existing gaps worth
   closing in the same pass, not new scope discovered by this ticket:
   - Rotate/remove the hardcoded `admin`/`Admin@1234` seed and the live
     `cwd-test-admin`/`CwdTest@2026` test account before this goes anywhere near
     real production traffic.
   - Remove or rotate the manager-PIN backdoor (`X-Manager-Pin` header bypass,
     default `123456`) — it fully bypasses session auth today.
   - Add rate-limiting to `/manager/auth/login` (`as-4`).
4. **Out of scope for this ticket**: MFA (`ac-2`), Singpass/Corppass (`ac-7`), SSO
   (`ac-12`) — all recommended-not-required at Archetype 3, not blocking.

## Depends on

Nothing — this is the first build item. 02 (crew web page) and 08 (manager auth
hardening, if kept separate) both need this to attribute anything correctly.

## Progress

Built and locally verified (Docker Postgres + MinIO, see README's "Local
Postgres & MinIO" section):
- `POST /api/crew/auth/login` — per-officer PIN login, issues a real session
  (reuses the existing `role: "crew"` + `officerId` account shape in
  `managersTable`, which already existed but was never wired into any crew UI)
- `PUT /manager/auth/officers/:officerId/crew-pin` — admin sets/replaces one
  officer's PIN directly, auto-approved (no self-register-and-wait flow needed)
- `GET /manager/auth/officers/crew-pins` — admin lists which officers have a
  crew login set up (no PIN values returned, same write-only pattern as
  password resets elsewhere in this file)
- Rate-limiting added to all four credential-check endpoints (manager login,
  manager PIN, legacy shared crew PIN, new per-officer crew login) — one
  limiter *instance* per endpoint, not shared, so traffic on one doesn't burn
  the quota for another on a shared/NAT'd IP. 10 attempts / 15 min each.
- Old shared crew-PIN endpoint (`/api/crew-pin/check`) left in place, commented
  as superseded, for backward compat until 08 retires the native app.

Verified end-to-end locally: admin login → set PIN for a test officer → crew
login with correct PIN succeeds and returns a session → wrong PIN rejected →
8th+ attempt in a window correctly 429s → confirmed manager-login attempts
don't consume the crew-login quota or vice versa.

**Not yet done**:
- Manager-side default-credential rotation (hardcoded `admin`/`Admin@1234` seed,
  live `cwd-test-admin` account, manager-PIN backdoor default `123456`) —
  deliberately left alone for now since a working admin login is needed for
  testing the rest of this build; rotate before real production traffic.
- Not deployed anywhere yet — built and tested against a local Postgres/MinIO
  only, per the README's new "Local Postgres & MinIO" section.
