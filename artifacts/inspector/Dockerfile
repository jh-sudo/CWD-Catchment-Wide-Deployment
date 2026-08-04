# Build from the repo root: docker build -f artifacts/inspector/Dockerfile .
# Mirrors the production build/run commands from
# artifacts/inspector/.replit-artifact/artifact.toml.

FROM node:20-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./
COPY lib lib
COPY scripts scripts
COPY artifacts artifacts

ENV PORT=22578
ENV BASE_PATH=/inspector/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/inspector run build

FROM node:20-slim AS runtime
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY --from=builder /app /app

ENV NODE_ENV=production
ENV PORT=22578
ENV BASE_PATH=/inspector/
EXPOSE 22578

CMD ["pnpm", "--filter", "@workspace/inspector", "run", "serve"]
