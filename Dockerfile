# syntax=docker/dockerfile:1
#
# Single-image deployment: the server serves the REST/SSE API AND the built web
# UI as static files (no separate nginx, so SSE works with no proxy tuning).
# Build context is the repo ROOT so the npm-workspace lockfile is available.

# ---- build stage -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
# Toolchain for the better-sqlite3 native addon (musl).
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci
COPY server ./server
COPY web ./web
RUN npm run build --workspace=server && npm run build --workspace=web

# ---- production stage --------------------------------------------------------
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
# Install production deps only; build tools are added then removed to keep the
# image slim (better-sqlite3 still needs to compile against musl).
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps \
  && npm cache clean --force
# Server build output + the web bundle (served from <cwd>/public in production).
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./server/public

WORKDIR /app/server
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/status >/dev/null 2>&1 || exit 1
CMD ["node", "dist/index.js"]
