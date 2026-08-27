# syntax=docker/dockerfile:1
#
# The Node minor is pinned rather than floating on `node:24-alpine`, so a rebuild months from
# now produces the same runtime. Bump it deliberately, as a visible change.

# ── build ────────────────────────────────────────────────────────────────────
FROM node:24.18-alpine AS build

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them. The workspace manifests
# come along because npm needs them to resolve the tree.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY tsconfig.base.json ./
COPY server ./server
COPY web ./web

# The SPA is built into server/public, so one image serves the API and the app from one origin.
RUN npm run --workspace server build && npm run --workspace web build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24.18-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --omit=dev --workspace server && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public

# The official Node images ship an unprivileged `node` user; running as root is never needed.
USER node

EXPOSE 4000

# tsconfig has rootDir ".", so compiled sources keep their src/ prefix inside dist/.
CMD ["node", "server/dist/src/server.js"]
