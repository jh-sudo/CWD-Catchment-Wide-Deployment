# Northflank platform capabilities

Research notes for `.scratch/govpaas-migration/issues/01-govpaas-platform-capabilities.md`.

**Scope note:** the wayfinder map and the original issue file frame this as researching "GOV PaaS," described there as "Northflank-adjacent," with instructions to flag divergence from the old UK-government Cloud-Foundry-based GOV.UK PaaS. That framing was a wrong assumption from an earlier research pass — GOV.UK PaaS is decommissioned and unrelated. The user has since corrected this directly: **Northflank is the actual target platform**, and https://northflank.com/docs is the primary source, not a proxy. This document researches Northflank directly, as instructed. It does not touch GOV.UK PaaS history at all.

All claims below are cited to the specific Northflank docs page they came from. Where docs were ambiguous or a claim couldn't be pinned down, that's called out explicitly rather than guessed at.

---

## 1. Managed Postgres

- **Provisioning model:** Postgres is provisioned as an **addon** (Northflank's term for managed stateful infrastructure), not as a generic container service. You create it from the dashboard's "create addon" flow, selecting PostgreSQL as the addon type.
  Source: [Deploy PostgreSQL on Northflank](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank)

- **Versions offered:** PostgreSQL **12, 13, 14, 15, 16, 17, and 18** are supported. The addon creation flow defaults to the most recent version unless you pick an older one explicitly.
  Source: [Deploy PostgreSQL on Northflank](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank)

- **Setup flow:** name the instance → choose version → decide on TLS (can change later; TLS is required if the instance is made publicly accessible) → optionally link a secret group for credential management → choose compute/storage/replica resources → provision (documented as taking "a few minutes").
  Source: [Deploy PostgreSQL on Northflank](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank)

- **HA / operations:** supports automated failover via **Patroni**, and optional **PgBouncer** connection poolers. Backups are "native or disk" style, manageable (create/import/restore/delete) from a dedicated backups page. Admin-level access uses credentials suffixed `_ADMIN`; app-level access uses standard generated credentials.
  Sources: [Configure addons for high availability](https://northflank.com/docs/v1/application/databases-and-persistence/configure-addons-for-high-availability), [Deploy PostgreSQL on Northflank](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank)

- **How connection details reach the app:** via **environment variable injection**, mediated by **secret groups**, not a Heroku/Cloud-Foundry-style "bound service" abstraction with its own API.
  - You link the Postgres addon to a secret group; the addon's connection details (host, port, user, password, full connection string, etc.) are then inherited as runtime variables by any service or job that also inherits that secret group.
  - Variable names are auto-generated from the database name, e.g. `NF_MY-DATABASE_HOST`. If the app expects specific variable names (e.g. `DATABASE_URL`), you assign **aliases** to the generated variables rather than the app adapting to Northflank's naming.
  - It's also possible to skip secret groups and add the connection variables directly to a specific service instead.
  Source: [Connect database secrets to workloads](https://northflank.com/docs/v1/application/databases-and-persistence/connect-database-secrets-to-workloads), [Inject secrets — runtime variables](https://northflank.com/docs/v1/application/secure/inject-secrets)

---

## 2. Persistent file/object storage

Northflank offers **both** a mountable persistent volume primitive and S3-compatible object storage — but they are two distinct products, not one feature.

- **Persistent volumes (block storage):**
  - Attached directly to a deployment service, size range **4 GB up to 64 TB**.
  - Two mount-path concepts: a **container mount path** (absolute path inside the container, e.g. `/data`) and an optional **volume mount path** (a subdirectory within the volume itself, letting you mount different subfolders of one volume to different container paths).
  - Two access modes, chosen at creation and **not changeable afterward**:
    - **Single Read/Write** (default) — mountable by only one pod at a time; the service can't horizontally scale or run HA with this mode.
    - **Multi Read/Write** — the same volume can be attached to multiple pods simultaneously (across replicas or different services/jobs), enabling shared storage and horizontal scaling.
  - Volume storage can be expanded but **cannot be scaled down** after creation.
  Sources: [Add a persistent volume](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume), [Persistent storage in production](https://northflank.com/docs/v1/application/production-workloads/persistent-storage-in-production), [Increase storage](https://northflank.com/docs/v1/application/scale/increase-storage)

- **S3-compatible object storage:** Northflank does not run its own bespoke object-storage product; instead it offers **MinIO** as a one-click, managed addon ("Managed MinIO") — a high-performance object store with an S3-compatible API. It's deployed the same way as a database addon (pick it from the addon list, configure, create), managed via the MinIO Console in-browser or the MinIO CLI/JS client, and billed by resource consumption with automatic patching/upgrades and scalable replicas/compute.
  Sources: [Managed MinIO — Northflank](https://northflank.com/dbaas/managed-minio), [Use a MinIO S3 bucket on Northflank](https://northflank.com/guides/use-a-minio-s3-bucket-on-northflank), [Deploy a database](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-a-database)

- **Implication for this migration:** for the inspection-photo storage currently on local disk / Replit Object Storage, either a persistent volume (simplest lift-and-shift, single-pod constraint) or a MinIO addon (closer like-for-like replacement for GCS-backed object storage, S3 API compatible) are both viable; MinIO is the closer architectural match to what's being replaced.

---

## 3. Secrets / config management

- **Primary mechanism: secret groups**, managed through the **dashboard UI**. From a project's secrets page you create a secret group and enter values as key/value pairs, paste JSON, or import a `.env` file. Individual services/jobs can also have variables set directly on them (not group-mediated).
  Source: [Manage secret groups](https://northflank.com/docs/v1/application/secure/manage-secret-groups), [Inject secrets](https://northflank.com/docs/v1/application/secure/inject-secrets), [Upload secret files](https://northflank.com/docs/v1/application/secure/upload-secret-files)

- **Scope control:** a secret group can be marked to apply as **runtime variables**, **build arguments**, or both — controlling whether it's injected at build time, runtime, or both.
  Source: [Manage secret groups](https://northflank.com/docs/v1/application/secure/manage-secret-groups)

- **Targeting:** by default an unrestricted secret group is inherited by *all* services/jobs in the project of the matching secret type; it can instead be restricted to specific services/jobs or targeted by tags.
  Source: [Manage secret groups](https://northflank.com/docs/v1/application/secure/manage-secret-groups)

- **Precedence:** secret groups have a priority value 0–100; higher priority wins on key collisions between groups. Variables set directly on a service/job always override same-named variables inherited from any secret group.
  Source: [Manage secret groups](https://northflank.com/docs/v1/application/secure/manage-secret-groups)

- **Other features:** dynamic templating (derive new variables from ones already defined in the group), linking addons directly into a secret group (as used for the Postgres connection details above, §1), and applying changes requires an explicit "restart dependents" action to redeploy everything inheriting the group.
  Source: [Manage secret groups](https://northflank.com/docs/v1/application/secure/manage-secret-groups)

- **Config-as-code path:** beyond the dashboard, Northflank supports a **CLI** (`northflank` CLI, e.g. `northflank create template --file ./template.yaml`) and **templates** — YAML/JSON definitions that can describe secret groups alongside services, addons, and pipelines, committed to Git and applied programmatically (bidirectional GitOps is supported). So secrets/config can be managed via dashboard UI, CLI, or config-as-code templates — all three are documented, not just the UI.
  Sources: [Infrastructure as code on Northflank](https://northflank.com/docs/v1/application/infrastructure-as-code/infrastructure-as-code), [Write a template](https://northflank.com/docs/v1/application/infrastructure-as-code/write-a-template), [Create a template](https://northflank.com/docs/v1/application/infrastructure-as-code/create-a-template)

---

## 4. Deployment mechanism

- **Not git-push-to-deploy in the Heroku/`cf push` sense.** Northflank uses a **webhook-triggered build pipeline**: you link a Git repository to a service, Northflank watches specified branches/PRs, and "will build an image for every new commit to the branches or pull requests it is monitoring, as long as CI is enabled." The result is always a **container image** — there's no code-only deploy path.
  Source: [Build code from a Git repository](https://northflank.com/docs/v1/application/build/build-code-from-a-git-repository)

- **Build methods, both supported:**
  - **Dockerfile** — bring your own Dockerfile; layer caching supported to speed up rebuilds.
  - **Buildpacks** — Northflank auto-detects and builds the app without a Dockerfile.
  Sources: [Build with a Dockerfile](https://northflank.com/docs/v1/application/build/build-with-a-dockerfile), [Build your code on Northflank](https://northflank.com/docs/v1/application/build/build-your-code-on-northflank)

- **Build triggers are configurable:** default build rules watch all PR branches (`*`) plus `master`; this is customizable with branch-name regex, path-based ignore rules (e.g. skip builds for docs-only changes), and commit-message flags like `[skip ci]`.
  Source: [Build code from a Git repository](https://northflank.com/docs/v1/application/build/build-code-from-a-git-repository)

- **CI/CD is built into the platform itself** (not merely bolted onto an external CI system) — build + deploy rules, environments, and "workflows" (templated automation for tasks like DB backups, triggering builds, running jobs, deploying services) are native Northflank concepts.
  Source: [CI/CD on Northflank](https://northflank.com/docs/v1/application/release/ci-cd-on-northflank), [Manage CI/CD](https://northflank.com/docs/v1/application/release/manage-ci-cd)

- **External CI integration is also supported, not required:** Northflank documents using **GitHub Actions** to trigger Northflank builds/deploys via webhook, for teams that want their CI to live in GitHub Actions while Northflank handles hosting.
  Source: [Use GitHub Actions with Northflank](https://northflank.com/docs/v1/application/infrastructure-as-code/use-github-actions-with-northflank)

- **CLI-driven deploys** are also possible (creating/running templates, triggering builds) via the `northflank` CLI, in addition to the dashboard and Git-trigger paths.
  Source: [Infrastructure as code on Northflank](https://northflank.com/docs/v1/application/infrastructure-as-code/infrastructure-as-code)

---

## 5. Multi-app / multi-service support

- **Project structure:** a **project** is the top-level container holding services, addons, jobs, persistent data, and secrets. A single project is expected to hold multiple services — e.g. an API plus several frontend apps — as separate deployable units within it.
  Source: [Introduction to Northflank](https://northflank.com/docs/v1/application/getting-started/introduction-to-northflank)

- **Each service can have its own route/URL:** after adding and verifying a root domain, you create **subdomains** and link them to specific service **ports**. Different services (and even services in different projects) can each be exposed on their own subdomain under one root domain, e.g. `api.example.com`, `app1.example.com`, `app2.example.com`.
  Source: [Domains on Northflank](https://northflank.com/docs/v1/application/domains/domains-on-northflank), [Use path-based routing](https://northflank.com/docs/v1/application/domains/use-path-based-routing)

- **Path-based routing** is also supported: a single subdomain can route different paths to different services/ports, with priority ordering when paths overlap. Routing can cross project boundaries — "paths on a subdomain to multiple ports on the same service, ports on different services, as well as services in different projects."
  Source: [Use path-based routing](https://northflank.com/docs/v1/application/domains/use-path-based-routing)

- **Custom domain support: yes, with automatic TLS.** You add and verify your own domain, then link subdomains to service ports. Northflank provisions TLS certificates on-demand via **Let's Encrypt**, and traffic is served securely as soon as a domain is linked. Wildcard certificates are supported to avoid per-subdomain cert generation overhead for dynamically provisioned subdomains.
  Source: [Domains on Northflank](https://northflank.com/docs/v1/application/domains/domains-on-northflank), [Add a domain to your account](https://northflank.com/docs/v1/application/domains/add-a-domain-to-your-account)

- **Directly maps onto this migration's shape:** api-server, roster-dashboard, apa, and inspector can each be a separate service inside one Northflank project, each bound to its own subdomain, which matches the multi-app requirement in the map/issue almost exactly.

---

## 6. Logging

- **stdout/stderr capture:** Northflank captures all output your code writes to stdout/stderr automatically for services, jobs, addons, and builds — no app-side agent needed. Default plain-text log line format is `<timestamp> <stream [stdout|stderr]> <log line>`.
  Source: [View logs](https://northflank.com/docs/v1/application/observe/view-logs), [Configure log sinks](https://northflank.com/docs/v1/application/observe/configure-log-sinks)

- **Built-in viewing:** live and historical logs are viewable in the dashboard, searchable via plain text or regex, covering builds, running/terminated containers, addons, and job runs. Live logs can also be streamed via WebSocket-based log tailing from the CLI or JS client.
  Source: [View logs](https://northflank.com/docs/v1/application/observe/view-logs), [Log tailing](https://northflank.com/docs/v1/api/log-tailing)

- **Log aggregation / drains ("log sinks"):** Northflank supports forwarding logs out to external destinations, scoped to specific projects or the whole team. Documented sink targets include:
  - SaaS log platforms: **Datadog, Grafana Cloud Loki, Papertrail, Mezmo, Better Stack, Honeycomb, Logz.io, New Relic, Axiom**
  - **AWS S3 or any S3-compatible endpoint**
  - **Generic custom HTTP endpoint** with custom auth
  JSON-structured log encoding (message, timestamp, service name, pod identifier, etc.) is available for most sink types in addition to the default plain-text format.
  Source: [Configure log sinks](https://northflank.com/docs/v1/application/observe/configure-log-sinks), [Send logs to a HTTP endpoint from Northflank](https://northflank.com/guides/send-logs-to-a-http-endpoint-from-northflank)

- **Ambiguity flagged:** the docs don't explicitly state a retention period for logs kept in Northflank's own built-in log viewer when no external sink is configured, nor a hard cap on how far back "historical logs" go. If this repo needs guaranteed long-term log retention, that likely requires wiring up a log sink (e.g. to S3 or a SaaS log platform) rather than relying on the built-in viewer alone — this repo's current logging is just pino-to-stdout, so a sink would be a genuinely new piece of infrastructure, not a lift-and-shift.

---

## Open items / things not fully confirmed from docs alone

- **Pricing** for addons (Postgres, MinIO) and volumes was not investigated here — out of scope for this ticket's questions, but relevant to a later costing ticket.
- **Log retention window** on the built-in (no-sink) log viewer is not stated explicitly in the docs reviewed (see §6).
- This research did not attempt to sign into a Northflank account or provision anything — all findings are doc-only, consistent with the map's "plan, don't do" instruction.
