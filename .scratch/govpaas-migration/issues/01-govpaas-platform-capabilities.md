Type: research
Status: resolved

## Question

What does GOV PaaS (the Northflank-adjacent platform this app is moving to) actually offer, and how does it work operationally? Specifically:

- Managed Postgres offering — version, how it's provisioned, how connection details are surfaced to an app (env var? bound service?).
- Persistent file/object storage options — is there an S3-compatible object storage service, a mountable persistent volume, or neither? (Needed for inspection photos currently on local disk.)
- Secrets/config management — how environment variables and secrets get set per app (dashboard, CLI, manifest file, vault-style service?).
- Deployment mechanism — buildpacks vs. Docker/container images, CLI-driven (`cf push`-style) vs. Git-push-to-deploy vs. CI-driven.
- Multi-app/multi-service support — can multiple apps (api-server, roster-dashboard, apa, inspector) run as separate services under one org/space, each with their own route/URL? Custom domain support?
- Logging — where does stdout/stderr logging go; is there a log aggregation or drain mechanism?

GOV PaaS's own docs are not directly crawlable. Use Northflank's docs (https://northflank.com/docs) as the working reference. **Correction (user, after the first research pass went the wrong way): do not research this as the old, decommissioned UK-government Cloud-Foundry-based "GOV.UK PaaS" — that assumption is wrong and a dead end.** Research Northflank's docs directly as the reference platform; don't go looking into GOV.UK PaaS history/decommissioning at all.

## Answer

Full findings: [`docs/research/northflank-platform-capabilities.md`](../../../docs/research/northflank-platform-capabilities.md).

- **Postgres**: provisioned as a managed "addon" (versions 12–18). Connection details reach the app via env-var injection mediated by **secret groups** (not a Cloud-Foundry-style bound-service abstraction) — link the addon to a secret group, then alias the auto-generated variable names (e.g. to `DATABASE_URL`) as needed.
- **File/object storage**: both options exist as separate products — mountable **persistent volumes** (4GB–64TB, single- or multi-pod access modes, access mode fixed at creation) and a managed **MinIO addon** (S3-compatible API). MinIO is the closer architectural match to what Replit Object Storage is being replaced with, relevant to the [file storage for photos](09-file-storage-photos.md) ticket.
- **Secrets/config**: dashboard UI, CLI, and Git-committed YAML/JSON "templates" (config-as-code, bidirectional GitOps) are all supported. Secret groups have scope control (build/runtime), targeting (all services, or restricted by service/tag), and priority-based precedence on collisions.
- **Deployment**: not literal git-push-to-deploy — Northflank watches linked Git branches/PRs via webhook and builds a **container image** every commit (Dockerfile or auto-detected buildpacks, both supported). CI/CD is native to the platform (build/deploy rules, environments, workflows); external GitHub Actions integration is also documented for teams that want CI to live there instead.
- **Multi-app/multi-service**: a **project** holds multiple services as separate deployable units — api-server, roster-dashboard, apa, and inspector map cleanly onto one project as four services. Each gets its own subdomain (or path-based routing under one subdomain), with automatic Let's Encrypt TLS on custom domains.
- **Logging**: stdout/stderr captured automatically for all services/jobs/addons/builds, viewable/searchable in-dashboard, streamable via CLI. Log **sinks** can forward to Datadog, Grafana Loki, Papertrail, S3, or a generic HTTP endpoint. Retention window for the built-in viewer with no sink configured isn't documented — flagged as an open item.
- **Open items for later**: addon/volume pricing wasn't investigated (out of scope for this ticket); log retention without a sink is unconfirmed. Both noted in the research file rather than guessed at.

This unblocks [hosting topology](07-hosting-topology.md), [secrets & config migration](08-secrets-config-migration.md), [file storage for photos](09-file-storage-photos.md) (also blocked on the inspections schema ticket), and [deploy/CI pipeline](10-deploy-ci-pipeline.md).
