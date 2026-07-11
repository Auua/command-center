# syntax=docker/dockerfile:1
# @command-center/api — API + worker image (NFR-13: runnable anywhere).
# Build from the MONOREPO ROOT:
#   docker build -f apps/api/Dockerfile -t command-center-api .
# Run the API:     docker run -p 3001:3001 command-center-api
# Run the worker:  docker run command-center-api node dist/worker

FROM node:22-alpine AS base
RUN corepack enable

# ---- Build stage: install + build the api and its workspace deps ----------
FROM base AS build
WORKDIR /repo

# Workspace manifests first for layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# Install and build only @command-center/api and its workspace dependencies
# (contracts is built first via topological ordering).
RUN pnpm --filter @command-center/api... install --frozen-lockfile
RUN pnpm --filter @command-center/api... run build

# Produce a pruned, production-only bundle of the api package
# (dist + prod node_modules with workspace deps inlined).
RUN pnpm --filter @command-center/api deploy --prod /app

# ---- Runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app ./

USER node
EXPOSE 3001
CMD ["node", "dist/main"]
