# Build from the repo root: docker build -f artifacts/apa/Dockerfile .
# Mirrors the production build/run commands from
# artifacts/apa/.replit-artifact/artifact.toml.

FROM node:20-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./
COPY lib lib
COPY scripts scripts
COPY artifacts artifacts

ENV PORT=19712
ENV BASE_PATH=/apa/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/apa run build

FROM node:20-slim AS runtime
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY --from=builder /app /app

ENV NODE_ENV=production
ENV PORT=19712
ENV BASE_PATH=/apa/
EXPOSE 19712

CMD ["pnpm", "--filter", "@workspace/apa", "run", "serve"]
