# 09 — TOTP-based MFA for manager/admin accounts

Status: in-progress — built and locally verified, not yet deployed
Depends on: 01 (reuses its session/auth patterns)

## Why this shape, not Entra ID SSO

Explored tying manager login to Microsoft work accounts (Entra ID/Azure AD
OAuth2 SSO) to get MFA via Microsoft Authenticator — satisfies SSP controls
`ac-2` (MFA for privileged accounts) and `ac-12` (SSO). Real blocker: needs
an App Registration created by the org's Entra/IT admin (Tenant ID, Client
ID, secret, redirect URI) before anything can even be tested — an external
dependency with its own approval process.

Personal email/personal Microsoft accounts were considered as a way around
that, and **rejected** — a personal account has no organizational
deprovisioning (an agency can't revoke someone's Gmail when they leave), is
typically far less hardened than a managed corporate account, and would
likely read as a governance red flag to a security reviewer rather than a
smaller ask than the App Registration it was meant to avoid.

**Landed on**: standalone TOTP (Time-based One-Time Password) MFA, built
entirely in CWD's own code. Microsoft Authenticator (and most authenticator
apps) support adding an account two ways — "sign in with Microsoft account"
(the SSO path, needs org approval) or **"enter a setup key" / scan a QR code
manually** (a generic TOTP generator, tied to nothing but the code itself).
This uses the second mode: satisfies `ac-2` directly, needs zero external
identity provider, zero IT approval, zero org-side dependency to wait on.
Does not satisfy `ac-12` (that one genuinely needs real SSO) — not a full
substitute for the Entra path, just the smaller, unblocked piece of it.

## Scope

**Applies to**: `admin`, `manager`, `ic` roles. **Not** `crew` — same
reasoning as before, `ac-2` targets privileged accounts and crew's PIN flow
is deliberately low-friction for field use.

### Schema (`lib/db/src/schema/managers.ts`)

Two new nullable columns on `managersTable`:
- `mfa_secret` (text, nullable) — the TOTP secret, **encrypted at rest**, not
  plaintext. Unlike passwords this can't be hashed (the server has to read
  the real value back to verify codes), so it needs actual encryption
  (AES-256-GCM via Node's built-in `crypto`, a new `MFA_ENCRYPTION_KEY` env
  var) — not the bcrypt pattern used elsewhere in this file.
- `mfa_enabled` (boolean, default false)

### New dependency

`otplib` for TOTP generation/verification. `qrcode` (npm) to render the
setup QR as a data-URI PNG server-side, embedded directly in the HTML —
consistent with this app's existing server-rendered-page pattern, no
client-side QR library needed.

### New endpoints (`auth.ts`)

- `POST /manager/auth/mfa/setup` (requires existing session) — generates a
  new secret, stores it un-enabled, returns the `otpauth://` URI + QR code.
- `POST /manager/auth/mfa/verify-setup` — 6-digit code confirms the secret
  was scanned correctly; only then flips `mfa_enabled = true`. Prevents
  someone enabling MFA against a secret they never actually confirmed they
  can generate codes for (a broken scan would otherwise lock them out
  immediately).
- Modify `POST /manager/auth/login` — after password verifies, if
  `mfa_enabled` is true, don't set `req.session.managerId` yet. Return a
  "MFA required" response instead (e.g. a short-lived pending state in the
  session), and require a second call —
- `POST /manager/auth/mfa/challenge` — 6-digit code; only on success does
  this actually set `req.session.managerId`.
- `POST /manager/auth/mfa/disable` — self-service (re-verify a current code
  first) or admin-initiated for another account (see recovery, below).

Rate-limit the challenge endpoint the same way ticket 01 did for the other
credential checks (`makeAuthRateLimit()`) — unlimited attempts against a
6-digit code is a real brute-force surface even with a 30s validity window.

### Login page changes

`LOGIN_HTML` (existing template in `auth.ts`) needs a second step: after
username/password succeeds, if the server says MFA is required, show a
6-digit code entry field before establishing the session. Two-step flow, not
a single form.

## Real operational question to settle before/during this: lockout recovery

What happens when a manager loses their phone/authenticator app?
Recommended: mirror the existing forgot-password-with-admin-approval pattern
already in this file (`/manager/auth/forgot-password` →
`/manager/auth/managers/:id/approve-reset`) — an admin can clear another
manager's `mfa_secret`/`mfa_enabled`, forcing re-enrollment on next login.

**Bootstrapping risk worth flagging explicitly**: if there's ever only one
admin account and *they* lose their device, there's no other admin to reset
them. Either keep 2+ admin accounts with MFA enabled at all times, or
document a break-glass procedure (direct DB access via the pod-shell
pattern already used for account seeding, to manually clear the columns for
a locked-out admin).

## Rollout policy

Originally recommended **optional/opt-in first**, deferring the
mandatory-or-not call as "an organizational policy call, not this ticket's
job." **Superseded 2026-08-20**: user made that call — MFA is mandatory for
admin/manager/ic, specifically to satisfy the SSP `ac-2` requirement rather
than just make the capability available. `/manager/auth/login` now forces
an unenrolled admin/manager/ic account straight into setup (a new pane on
the login page) before granting a session at all; no opt-out, no session
until verify-setup succeeds. Applies to every existing account on its next
login, not just new ones — the 46 real backfilled manager accounts will all
hit this the first time they sign in after this deploys. The dashboard's 🛡️
button remains for voluntary re-linking after initial enrollment.

## Out of scope for this ticket

- Entra ID / SSO (separate, blocked on org approval — not being pursued for
  now per the reasoning above)
- Crew accounts
- Backup/recovery codes (a common companion to TOTP — worth considering as a
  follow-up once the core flow is proven, not required for a first version)

## Progress

Built as designed above:
- `lib/db/src/schema/managers.ts` — `mfa_secret` (nullable text) + `mfa_enabled`
  (boolean, default false) columns.
- `artifacts/api-server/src/lib/mfa.ts` — AES-256-GCM encrypt/decrypt (new
  `MFA_ENCRYPTION_KEY` env var, no fallback, same fail-fast pattern as
  `SESSION_SECRET`), plus thin wrappers around `otplib` (secret/URI
  generation, code verification with ±30s clock-drift tolerance) and
  `qrcode` (QR as a data-URI PNG).
- `auth.ts` — `POST /manager/auth/mfa/setup`, `/mfa/verify-setup`,
  `/mfa/challenge` (rate-limited via the existing `makeAuthRateLimit()`),
  self-service `/mfa/disable`, and admin-initiated
  `/manager/auth/managers/:id/disable-mfa` for lockout recovery. Login now
  returns `{ mfaRequired: true }` and holds the session in a *not yet
  authenticated* pending state (`session.pendingMfaManagerId`, distinct from
  `session.managerId`) instead of establishing a session until the challenge
  succeeds. Gated to `admin`/`manager`/`ic` — crew's setup/disable calls are
  rejected.
- Login page (`LOGIN_HTML`) — third pane for the 6-digit challenge, shown in
  place of the login form when the server reports `mfaRequired`.
- `/manager` dashboard — 🛡️ header button opens a self-service setup/disable
  modal (QR + manual setup key + confirmation code); Users panel gained an
  MFA badge and admin "Reset MFA" action per account (mirrors the existing
  Reset PW action).
- `otplib` + `qrcode` added to `artifacts/api-server/package.json`;
  `README.md` documents the new env var and the full endpoint flow.

**Verified end-to-end locally** (Docker Postgres, per the README's "Local
Postgres & MinIO" section): schema pushed cleanly (additive, no prompt) →
logged in as the seeded admin → `mfa/setup` returned a working `otpauth://`
URI + QR → generated a real code for that secret and confirmed via
`verify-setup` → logged out → logged back in and confirmed the *first*
response is `{ mfaRequired: true }` with no session yet (`/manager/auth/me`
still 401) → wrong challenge code correctly rejected without disturbing the
pending state → correct code completed the session → managers list surfaces
`mfaEnabled` per account → self-service disable rejects a wrong code, accepts
a correct one, and correctly refuses a second disable once already off →
admin-initiated `disable-mfa` clears an in-progress (unconfirmed) secret too,
and 400s when there's nothing to clear → login page HTML confirmed to render
the new challenge pane and dashboard confirmed to render the header
button/modal with `CURRENT_USER.mfaEnabled` wired through.

**Not yet done**:
- Not deployed anywhere — GOV PaaS needs `MFA_ENCRYPTION_KEY` added to
  `api-server`'s environment before the next redeploy, or the service won't
  boot (same fail-fast contract as `SESSION_SECRET`). Generate with
  `openssl rand -base64 32`.
- Schema push (`pnpm --filter @workspace/db run push`) still needs to run
  against the real dev-instance/prod database — additive/non-destructive
  (two new nullable/defaulted columns), same as every other schema change
  here, but hasn't been run outside the local Docker Postgres.
- Backup/recovery codes remain explicitly out of scope (see above).
