Type: grilling
Status: resolved

## Question

Who owns/registers the domain the migrated services will be reachable at, and how are DNS and TLS managed? The [hosting topology](07-hosting-topology.md) decision assumes one subdomain with path-based routing across the four services (mirroring the current Replit topology), and [GOV PaaS platform capabilities](01-govpaas-platform-capabilities.md) confirms Northflank auto-provisions TLS per custom domain — but neither ticket pins down which domain, who controls its DNS records today, or who has authority to point it at GOV PaaS. Also decide whether a GOV PaaS-provided default subdomain is acceptable for an interim period versus needing the real domain from day one.

## Answer

### Starting fact

The app currently has **no custom domain** — Replit's own default subdomain is in use today (`your-app.replit.app`, referenced as the API endpoint in `artifacts/wls-android-forwarder/BUILD_INSTRUCTIONS.md`). There's no existing DNS to migrate; this is a fresh decision, not a lift-and-shift.

### Finding that reshaped this ticket

Checked directly against Northflank's docs (this platform detail wasn't covered by [ticket 01](01-govpaas-platform-capabilities.md)'s original research): Northflank does offer a free auto-generated hostname per service (`*.code.run`) with no domain setup — **but path-based routing, which [ticket 07](07-hosting-topology.md) locked in as the mechanism putting all four services under one same-origin subdomain, explicitly requires a verified custom domain first.** It is not available on the generic default hostnames. So "just use the platform's free default subdomain" (the initial instinct) is incompatible with the already-locked topology — it would mean 4 separate origins, reopening the CORS/cross-origin-cookie question ticket 07 deliberately closed.

### Decisions made

- **Domain**: `[project name].[team name].stg.paas.sandbox.gov.sg` — the GOV PaaS sandbox platform auto-provisions this per project. Not a self-registered or externally-purchased domain.
- **Ownership/DNS**: owned and managed entirely by the GOV PaaS platform operator (GovTech's sandbox). No registrar involved, no DNS records for this project's team to manage directly.
- **Path-based routing compatibility**: confirmed pre-verified and ready to use out of the box — no separate "add/verify custom domain" console step needed. This resolves the blocker above: ticket 07's same-origin, path-routed topology (api-server + 3 frontends under one origin) works as designed on this domain.
- **TLS**: not independently confirmed for this gov-operated instance (undocumented publicly, per the map's note that GOV PaaS specifics need to come from the user rather than guessing) — assumed to auto-provision the same way Northflank's own custom-domain flow does (Let's Encrypt, on-demand). Flagged as a follow-up to visually confirm (padlock/cert check) once the project is actually deployed, not a hard blocker.
- **No separate "real" custom domain planned**: the goal is simply to get the app deployed, not to acquire a branded domain — the sandbox-assigned domain is accepted as-is, indefinitely, not as an interim placeholder.
- **Does not reopen [ticket 12](12-staging-environment.md)**: despite "stg" in the hostname, this sandbox tier is the actual (only) deployment target for this effort — there's a separate production tier at the platform level, but moving to it is explicitly not this migration's goal, so it doesn't change the earlier no-staging-environment decision.
