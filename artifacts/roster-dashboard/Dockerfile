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

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/roster-dashboard run build

FROM node:20-slim AS runtime
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY --from=builder /app /app

ENV NODE_ENV=production
ENV PORT=20315
ENV BASE_PATH=/roster/
EXPOSE 20315

CMD ["pnpm", "--filter", "@workspace/roster-dashboard", "run", "serve"]
