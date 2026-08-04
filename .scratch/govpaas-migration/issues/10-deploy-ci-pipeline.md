Type: grilling
Status: resolved
Blocked by: 01

## Question

Decide how deploys actually happen once this is on GitHub + GOV PaaS, using the platform facts from [GOV PaaS platform capabilities](01-govpaas-platform-capabilities.md) (buildpack vs. container image, CLI push vs. CI-driven).

Cover: build step for the pnpm workspace (`api-server`'s `build.mjs` + `pnpm -r build` for the frontends), whether GitHub Actions drives deploys or GOV PaaS pulls from GitHub directly, how the `DATABASE_URL` and other secrets from [secrets & config migration](08-secrets-config-migration.md) get injected per-environment, and whether `drizzle-kit push`/migrations run as a deploy step or a manual gate.

## Answer

### Decisions made

- **Build mechanism: Dockerfile per service**, not buildpacks. One Dockerfile each for `api-server`, `roster-dashboard`, `apa`, `inspector` — COPYs the whole workspace, runs `pnpm install` at the root (so shared internal packages like `lib/db`, `lib/api-zod` resolve correctly), then `pnpm --filter @workspace/X run build`. This mirrors exactly what each artifact's `.replit-artifact/artifact.toml` build command already does today — the translation is direct, not a redesign. Chosen over buildpacks because auto-detection generally assumes a single-package root and this is a pnpm workspace monorepo with real cross-package dependencies.
- **CI/CD location: GitHub Actions**, not Northflank-native triggers. Actions workflows build and trigger Northflank deploys (per the [platform capabilities research](01-govpaas-platform-capabilities.md), Northflank documents this integration path explicitly), rather than Northflank watching the branch directly via its own webhook.
- **Migrations: manual gate**, not automatic on every deploy. `drizzle-kit push` (via the existing `pnpm --filter db push` in `package.json`) runs as an explicitly-triggered step — a separate `workflow_dispatch`-triggered GitHub Actions job, run deliberately after reviewing a schema change, not folded into the regular deploy pipeline. Lower risk of an unreviewed migration silently hitting production for a live ops tool, at the cost of one extra manual step per schema change.

### Resolves the `post-merge.sh` follow-up from repo hygiene

The [repo hygiene ticket](06-repo-hygiene-replit-surface.md) flagged that `scripts/post-merge.sh` (`pnpm install --frozen-lockfile && pnpm --filter db push`) needs a new invocation point once `.replit`'s `[postMerge]` hook goes away. Resolution: the script's `pnpm --filter db push` line becomes the payload of the manual-gate GitHub Actions job described above — invoked deliberately via `workflow_dispatch`, not automatically on every merge like it was on Replit. This is a deliberate behavior change (automatic → manual), consistent with the migration-gating decision above.

### Secrets/config injection

Already resolved in [secrets & config migration](08-secrets-config-migration.md) — `DATABASE_URL` and the rest of the api-server secret group are injected as runtime environment variables via Northflank's secret groups, not through GitHub Actions. GitHub Actions' role is limited to building images and triggering Northflank deploys; it doesn't need to know `DATABASE_URL` or `SESSION_SECRET` itself. The three frontend services' `PORT`/`BASE_PATH` values (from [hosting topology](07-hosting-topology.md): `/roster/`, `/apa/`, `/inspector/`) are plain build-time args, not secrets, set directly per service.

### Build order

`api-server` and the three frontends have no build-order dependency on each other (each Dockerfile builds independently against the same repo checkout), but each depends on `lib/db`/`lib/api-zod` etc. being resolvable via the workspace-root `pnpm install` step inside its own Dockerfile — no cross-service build orchestration needed, just correct `COPY` scope in each Dockerfile.
