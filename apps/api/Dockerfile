# syntax=docker/dockerfile:1
#
# RazorGrowth API production image.
#
# Debian-slim rather than Alpine: Prisma's query engine needs OpenSSL 3
# and glibc, and the musl targets are a recurring source of "query engine
# not found" failures. The image is larger; the tradeoff buys a runtime
# that behaves the same as local development.
#
# Build from the REPOSITORY ROOT, not this directory — the API depends on
# two workspace packages (@razorgrowth/domain, @razorgrowth/contracts):
#
#   docker build -f apps/api/Dockerfile -t razorgrowth-api .

# ---------- deps ----------
FROM node:22-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Copy only manifests first so this layer caches across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json        apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/

# `postinstall` builds domain + contracts, which needs their sources.
COPY packages/ packages/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
WORKDIR /app
# The shared tsconfig lives at packages/config/tsconfig.base.json, which
# the `COPY packages/` in the deps stage already brought in.
COPY apps/api/ apps/api/
RUN pnpm --filter @razorgrowth/api run db:generate \
    && pnpm --filter @razorgrowth/api run build

# ---------- runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY --from=build /app/node_modules            ./node_modules
COPY --from=build /app/package.json            ./package.json
COPY --from=build /app/pnpm-workspace.yaml     ./pnpm-workspace.yaml
COPY --from=build /app/packages                ./packages
COPY --from=build /app/apps/api/node_modules   ./apps/api/node_modules
COPY --from=build /app/apps/api/dist           ./apps/api/dist
COPY --from=build /app/apps/api/package.json   ./apps/api/package.json
COPY --from=build /app/apps/api/prisma         ./apps/api/prisma
# `/agent-gateway/run-demo` spawns this script. Without it the endpoint
# exists in the image and fails the moment anyone presses the button.
COPY --from=build /app/apps/api/scripts        ./apps/api/scripts

# Run as a non-root user. `node` (uid 1000) ships with the base image.
USER node

EXPOSE 4000

# Migrations run at container start, before the server binds. This is
# `migrate deploy` (apply committed migrations only) — never `migrate
# dev`, which can generate or reset. If a migration fails the container
# exits rather than serving traffic against a schema it does not match.
CMD ["sh", "-c", "pnpm --filter @razorgrowth/api run db:deploy && node apps/api/dist/server.js"]
