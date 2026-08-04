Type: task
Status: resolved

## Question

Produce a checklist of every Replit-specific artifact in this repo that needs to be removed, replaced, or deliberately kept before the eventual push to GitHub — this ticket documents the checklist, it doesn't execute the git push (the GitHub repo doesn't exist yet; that happens at deploy time per the map's Notes).

Known so far:
- Root-level stale binaries already decided to drop: `cwd-fleet-app-template.{zip,tar,dat,encrypted.zip,txt}`, `roster-dashboard-source.zip`, `wls-sms-forwarder.zip`, `roster-dashboard-code.docx`, `locations.xlsx`.
- Replit config files: `.replit`, `.replitignore`, `replit.nix`, `replit.md` — decide keep/drop/replace for each.
- `.replit`'s `[postMerge]` hook (`scripts/post-merge.sh`) — check what it does and whether it's still needed off-Replit.
- `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, `@replit/vite-plugin-runtime-error-modal` — dev-only Vite plugins referenced in `apa`, `inspector`, `roster-dashboard`, `mockup-sandbox` vite configs; likely fine to strip for a non-Replit deploy.
- `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude` allowlist for `@replit/*` packages — becomes moot once those packages are removed.
- `cloudPersistence.ts`'s Replit sidecar token exchange (`127.0.0.1:1106`) — this is the core piece the storage migration replaces; just confirm it's fully covered by the schema/storage tickets rather than needing separate handling here.
- `.gitignore` already excludes `.cache/` and `.local/` (both Replit-related) — check whether other Replit-generated paths need adding.
- **New from [data backfill & cutover](11-data-backfill-cutover.md)**: `artifacts/api-server/data/*.json` is committed to git history and includes credential material — `vapid.json`'s private VAPID key and `managers.json`'s bcrypt password hashes. Private repo or not, this shouldn't be in version control. **Resolved in [ticket 16](16-git-history-credential-scrub.md): scrub git history** (`git filter-repo`) before the eventual GitHub push, rather than accepting it as-is.

Enumerate anything else found by scanning the repo for Replit references, propose keep/drop/replace for each, and record the answer as the checklist other tickets and the eventual execution effort will follow.

## Answer

Full repo scan done (grep for "replit" case-insensitive across all source/config files, plus a manual pass over every root-level dotdirectory). Checklist below; nothing here is executed yet — this is the plan the eventual execution effort follows, per the map's "plan, don't do" default.

### Drop

- Root-level stale binaries (already decided pre-map): `cwd-fleet-app-template.{zip,tar,dat,encrypted.zip,txt}`, `roster-dashboard-source.zip`, `wls-sms-forwarder.zip`, `roster-dashboard-code.docx`, `locations.xlsx`
- `.replit`, `.replitignore`, `replit.nix` — Replit-specific config, no equivalent needed on GOV PaaS
- `replit.md` — Replit-branded instructions for Replit's own agent; not useful once off-platform (distinct from `.agents/memory/`, which holds real domain knowledge — see below)
- `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, `@replit/vite-plugin-runtime-error-modal` and their conditional-load blocks (`NODE_ENV !== "production" && REPL_ID !== undefined`) in `apa`, `inspector`, `roster-dashboard`, `mockup-sandbox`'s `vite.config.ts`
- `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude` entries for `@replit/*` and `stripe-replit-sync` — dead once those packages are removed
- `cloudPersistence.ts` in full, including the Replit sidecar token exchange (`127.0.0.1:1106`) — superseded entirely by the schema/DB tickets (02–05)
- `.config/npm/node_global` — Replit container-local npm config, not app-related
- `.canvas/` — Replit Canvas feature scratch asset (`asset_1672859492.png`), confirmed unreferenced anywhere in source
- `.agents/agent_assets_metadata.toml` — Replit agent bookkeeping; also stale (references `artifacts/flood-ops-deck/`, an artifact that doesn't exist in this repo)
- `artifacts/*/.replit-artifact/artifact.toml` files — Replit's own router config. **Note**: these were the primary source for the [hosting topology](07-hosting-topology.md) decision (path routing, ports, BASE_PATH values) — safe to drop only after that decision is actually implemented on Northflank, not before

### Keep, unchanged

- `scripts/post-merge.sh` — the script itself (`pnpm install --frozen-lockfile && pnpm --filter db push`) is portable, not Replit-specific. Only its *invocation* (`.replit`'s `[postMerge]` hook) goes away with `.replit`. **Resolved by [deploy/CI pipeline](10-deploy-ci-pipeline.md)**: its `pnpm --filter db push` line becomes a manually-triggered GitHub Actions job (`workflow_dispatch`), not an automatic post-merge hook.
- `attached_assets/` — confirmed actively used (`@assets` alias in `apa`/`inspector`/`roster-dashboard` vite configs), not disposable. **Decision: prune unused files before committing to the new repo** rather than carrying all 217 files (100MB) forward unreviewed — needs its own pass (grep actual `@assets/...` import paths in each frontend's source, keep only what's referenced) before the GitHub push.
- `deployment_locations.csv` (repo root) — possible duplicate of `attached_assets/deployment_locations_*.csv` / `artifacts/api-server/data/locations.csv`; not fully investigated, flag for a quick check during the attached_assets pruning pass rather than deciding blind here.

### Keep, but port to this repo's own convention

- **`.agents/memory/*.md`** (6 files: `deduplication-covering-officers.md`, `leave-override-interaction.md`, `ph-rotation-engine.md`, `roster-covering-swap-fields.md`, `roster-cycle-subcatchment.md`, `roster-original.md`, plus the `MEMORY.md` index) — this is Replit's own AI agent's persistent memory on this exact codebase: real business rules, bug histories, and gotchas (see the [roster & leave schema amendment](03-schema-roster-leave.md) this directly fed into). **Decision: port the content into this repo's own `CONTEXT.md`/`docs/adr/` convention** (per `docs/agents/domain.md`, not yet created — this repo has no `CONTEXT.md` today), then drop the original `.agents/` directory. `.agents/` itself is Replit's proprietary agent-memory mechanism; porting makes the knowledge framework-agnostic and discoverable by any future agent or human working in this repo, not tied to a platform being left behind. Not executed in this session — this is a checklist item for the execution effort (or can be done ahead of it as prep, since it's independent of the GOV PaaS migration itself).
- `.agents/skills` — empty directory, nothing to port, just drop with the rest of `.agents/`.

### Not Replit-specific (no action)

- `pnpm-workspace.yaml`'s `minimumReleaseAge`/general structure, `.npmrc`, `tsconfig.*` — standard tooling, unrelated to Replit
- `artifacts/api-server/dist/index.mjs`, `artifacts/deployment-tracker/dist/...`, `.../static-build/...` — build output containing residual "replit" string references (from bundled `@replit/*` deps); these are `dist`/build artifacts already covered by `.gitignore`'s `dist` rule, not source to clean up directly — resolved automatically once the source-level plugin removal above happens and the build is rerun
