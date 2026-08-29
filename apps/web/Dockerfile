# syntax=docker/dockerfile:1
#
# RazorGrowth web production image: static Vite build served by nginx.
#
# IMPORTANT — `VITE_API_BASE_URL` is baked in at BUILD time, not read at
# runtime. Vite substitutes `import.meta.env.*` during the build, so
# setting it as a container env var at `docker run` does nothing. It must
# be passed as a build arg:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_API_BASE_URL=https://api.example.com/api/v1 \
#     -t razorgrowth-web .
#
# Build from the REPOSITORY ROOT — the web app depends on the
# @razorgrowth/contracts and @razorgrowth/domain workspace packages.

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json           apps/web/
COPY packages/domain/package.json    packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json    packages/config/

# `postinstall` builds domain + contracts, so their sources are needed.
COPY packages/ packages/
RUN pnpm install --frozen-lockfile

COPY apps/web/ apps/web/

ARG VITE_API_BASE_URL
# Fail loudly rather than silently shipping a bundle pointing at
# localhost — a misconfigured build would otherwise only surface as
# broken API calls in the browser, long after deploy.
RUN test -n "$VITE_API_BASE_URL" || (echo "ERROR: --build-arg VITE_API_BASE_URL is required" && exit 1)
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @razorgrowth/web run build

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
