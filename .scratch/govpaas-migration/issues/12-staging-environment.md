Type: grilling
Status: resolved

## Question

Does this migration need a staging/pre-production environment on GOV PaaS before the production cutover, or does the plan go straight from Replit (acting as de facto staging via the [soft cutover](11-data-backfill-cutover.md)) to a single GOV PaaS production environment? If staging is needed, decide its scope (all four services or a subset), whether it shares the same Postgres/MinIO addons or gets its own, and how it's provisioned relative to the [hosting topology](07-hosting-topology.md) — extra Northflank services under the same project, or a separate project entirely.

## Answer

**No dedicated staging/pre-production environment on GOV PaaS** — neither for the one-time migration cutover nor as a permanent ongoing environment.

- **Migration cutover**: already covered by [ticket 11](11-data-backfill-cutover.md)'s soft cutover — the GOV PaaS production deployment is stood up and validated (row counts, spot checks, orphan check) with Replit staying live as fallback, *before* DNS traffic switches over. That validation window is the de facto staging step for the migration itself; no separate environment needed on top of it.
- **Ongoing staging for future development**: considered and rejected. Reasoning:
  - [Ticket 10](10-deploy-ci-pipeline.md) already made schema migrations (`drizzle-kit push`) a deliberate `workflow_dispatch` manual gate specifically to prevent unreviewed changes from silently hitting production — a permanent staging environment would duplicate that safety margin, not add to it.
  - This is a small-scale internal tool (small team, likely maintained by one person) — a full 4-service + second-Postgres + second-MinIO mirror running indefinitely is cost/complexity out of proportion to the risk it removes.
  - "Test before I push" is better served by **local development**: run the pnpm workspace locally against a local Postgres (seeded from a prod dump/export) — faster iteration, zero hosting cost, catches most issues before anything touches Northflank.
- **Escape hatch, not a standing environment**: if a specific future change ever needs more-than-local testing (e.g. verifying Northflank-specific routing/build behavior), Northflank's git-branch build triggers (documented in [platform capabilities](01-govpaas-platform-capabilities.md)/`docs/research/northflank-platform-capabilities.md` §4) support building from PR branches — an ad hoc preview build can be spun up on demand for that one change and torn down after, rather than maintaining a permanent staging environment.
