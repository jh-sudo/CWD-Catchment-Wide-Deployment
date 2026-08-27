# Build from the repo root: docker build -f artifacts/api-server/Dockerfile .
# Mirrors the production build/run commands from
# artifacts/api-server/.replit-artifact/artifact.toml.

FROM node:20-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./
COPY lib lib
COPY scripts scripts
COPY artifacts artifacts

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

FROM node:20-slim AS runtime
WORKDIR /app

# Run as a non-root user rather than the default root — node:20-slim already
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
USER node

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/api/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "artifacts/api-server/dist/index.mjs"]
