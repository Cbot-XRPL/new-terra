# syntax=docker/dockerfile:1.6
# Multi-stage build that bundles both the API and the React client into one
# image. The Node process serves /api routes and also serves the SPA in prod.

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# --- Dependencies (installed once, cached) ---
FROM base AS deps
COPY package.json package-lock.json* ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --include=dev --workspaces

# --- Build client + server ---
FROM deps AS build
COPY . .
RUN npx prisma generate --schema=server/prisma/schema.prisma \
 && npm --workspace server run build \
 && npm --workspace client run build

# --- Runtime image ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/node_modules node_modules

# Persisted upload directory; mount a volume here in production.
RUN mkdir -p /app/server/uploads && chown -R app:app /app
USER app

EXPOSE 4000
WORKDIR /app/server
CMD ["node", "dist/index.js"]
