Type: grilling
Status: resolved

## Question

What should the post-migration logging/monitoring/alerting story be? Today it's just pino writing to stdout with nothing downstream. [GOV PaaS platform capabilities](01-govpaas-platform-capabilities.md) confirms Northflank captures stdout/stderr natively and can optionally sink logs to Datadog, Loki, S3, or a generic HTTP endpoint — decide whether to take a sink (and which), stay on native log capture only, and whether any alerting (e.g. on repeated deploy failures, error-rate spikes, or the flood-ops alert broadcast path in [core ops state](02-schema-core-ops-state.md)) is in scope for this migration or a later effort.

## Answer

### Starting fact

Confirmed via `artifacts/api-server/src/lib/logger.ts`: today's setup is exactly what the question describes — plain pino to stdout (JSON in production, `pino-pretty` in dev), with `req.headers.authorization`/`cookie` redaction. No sink, no alerting infrastructure exists anywhere in the codebase today.

### Scoping note

The ticket's mention of "the flood-ops alert broadcast path" is a domain feature (broadcasting flood alerts to officers), already covered as a data model in [ticket 02](02-schema-core-ops-state.md)'s alert-history table — not part of this ticket. This ticket is about *infra*-level logging/monitoring/alerting only.

### Decisions made

- **No log sink** — stays on Northflank's native stdout/stderr capture (searchable dashboard viewer, live + historical). Matches today's Replit setup exactly (nothing downstream). No code changes needed to `logger.ts`; the existing `NODE_ENV`-gated JSON-vs-pretty output behavior carries over unchanged. Same reasoning as [ticket 12](12-staging-environment.md)'s no-staging-environment decision — proportionate to a small-scale internal tool, not a lift-and-shift gap.
- **No alerting** — deferred entirely to a later effort, not in scope for this migration. Nothing like this exists today; adding it would be genuinely new infrastructure, not a migration of existing behavior.
- **Revisit condition**: both are reconsidered if the built-in dashboard's log retention window (still unconfirmed for this gov instance, per [ticket 01](01-govpaas-platform-capabilities.md)'s open item) proves too short for post-incident review, or if an actual incident makes the lack of alerting a concrete problem — not on a schedule, only if the need becomes real.
