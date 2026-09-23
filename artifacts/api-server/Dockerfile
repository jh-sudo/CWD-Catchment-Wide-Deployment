# Build from the repo root: docker build -f artifacts/api-server/Dockerfile .
# Mirrors the production build/run commands from
# artifacts/api-server/.replit-artifact/artifact.toml.

# alpine, not slim (Debian): verified 2026-09-23 that the bundled
# dist/index.mjs has no runtime native-addon dependency (esbuild/swc/etc.
# are build-only, fully inlined at build time — see build.mjs's `external`
# list), so there's nothing musl-incompatible to worry about here. Cuts
# CRITICAL/HIGH CVEs in the shipped image from 90 to 4 (verified via a
# real Trivy scan) — node:20-slim's own upstream tag hadn't been
# rebuilt in ~5 months, so a plain rebuild wouldn't have helped; the
# smaller Alpine OS surface is what actually matters here.
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./
COPY lib lib
COPY scripts scripts
COPY artifacts artifacts

# Deliberately separate layers, not two RUNs left uncombined by oversight:
# keeps `pnpm install` cached and skipped when only app source changes,
# not just dependencies. Consolidating would force a full reinstall on
# every source-only rebuild.
RUN pnpm install --frozen-lockfile
# hadolint ignore=DL3059
RUN pnpm --filter @workspace/api-server run build

FROM node:20-alpine AS runtime
WORKDIR /app

# psql — not needed by the app itself, but GOV PaaS's Postgres addon is
# private-network-only (see startupMigration.ts / README's Deployment
# section), so this container's own Shell tab is the only place anyone can
# ever run ad-hoc SQL against it. Worth the ~10MB: the 2026-09-22
# lightning_sectors incident hit "psql: command not found" mid-outage
# because this wasn't here yet.
# Deliberately unpinned: `FROM node:20-alpine` above is itself a floating
# tag, not pinned to a digest, so a version+revision pin here (e.g.
# postgresql-client=18.6-r0) could silently vanish from Alpine's repo
# snapshot on a future base-image update and break the build — a worse
# fragility than the supply-chain risk this rule guards against. Also
# only ever used for manual operator debugging via the Shell tab, never
# part of the app's own request-handling attack surface.
# hadolint ignore=DL3018
RUN apk add --no-cache postgresql-client

# Run as a non-root user rather than the default root — node:20-alpine already
# ships a low-privilege "node" user/group (uid/gid 1000). --chown here (not a
# separate `RUN chown -R /app`) sets ownership as part of the copy itself —
# a follow-up recursive chown over node_modules took ~4 minutes in testing.
#
# Only copy dist/ (the esbuild bundle — see build.mjs's `external` list,
# none of it covers anything this app actually imports, so dependencies AND
# devDependencies are both fully inlined into dist/index.mjs) plus data/
# (the one thing NOT bundle-reachable: CSV/JSON files read via `__dirname`-
# relative fs.readFileSync at runtime, e.g. locations.csv). No node_modules,
# no source, no devDependency packages ship in the final image at all.
COPY --from=builder --chown=node:node /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder --chown=node:node /app/artifacts/api-server/data ./artifacts/api-server/data
# Named user, not numeric uid, deliberately: self-documents as
# node:20-alpine's own pre-existing low-privilege user (uid/gid 1000) rather
# than a bare "1000" a reader has to go look up. No security difference
# either way — non-root is the actual point, not which spelling.
# hadolint ignore=DL3066
USER node

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/api/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "artifacts/api-server/dist/index.mjs"]
