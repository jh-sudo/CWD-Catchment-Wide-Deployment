# Build from the repo root: docker build -f artifacts/roster-dashboard/Dockerfile .
# Mirrors the production build/run commands from
# artifacts/roster-dashboard/.replit-artifact/artifact.toml.

FROM node:20-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./
COPY lib lib
COPY scripts scripts
COPY artifacts artifacts

ENV PORT=20315
ENV BASE_PATH=/roster/

# Deliberately separate layers, not two RUNs left uncombined by oversight:
# keeps `pnpm install` cached and skipped when only app source changes,
# not just dependencies. Consolidating would force a full reinstall on
# every source-only rebuild.
RUN pnpm install --frozen-lockfile
# hadolint ignore=DL3059
RUN pnpm --filter @workspace/roster-dashboard run build

FROM node:20-slim AS runtime
# COREPACK_HOME pinned to a path outside /app (the /app COPY below would
# otherwise clobber it) and chowned to node:node so the *runtime* user can
# actually read the version `corepack prepare` fetched as root here — by
# default corepack's "activated version" state lives under $HOME, which
# differs between root (this RUN) and the `node` user USER switches to
# below, so without this the node user found no activated version and
# corepack fell back to fetching latest pnpm (needs Node 22+, this image is
# Node 20) — real incident, see the commit this comment shipped in.
# packageManager in root package.json is the belt-and-suspenders fallback:
# even without this cache, corepack reads that field before ever guessing.
ENV COREPACK_HOME=/opt/corepack-cache
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate \
  && chown -R node:node /opt/corepack-cache
WORKDIR /app
# Non-root user — see api-server/Dockerfile's comment for the pattern.
# Unlike api-server, this service's runtime command (`vite preview`) is
# itself a devDependency, so the whole /app tree (incl. node_modules) still
# needs to ship here — there's no equivalent dist-only trim available.
COPY --from=builder --chown=node:node /app /app
# Named user, not numeric uid — see api-server/Dockerfile's comment for
# the same choice/reasoning.
# hadolint ignore=DL3066
USER node

ENV NODE_ENV=production
ENV PORT=20315
ENV BASE_PATH=/roster/
EXPOSE 20315

CMD ["pnpm", "--filter", "@workspace/roster-dashboard", "run", "serve"]
