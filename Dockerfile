# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────────────────────
# FineApp — obraz produkcyjny (jeden kontener: API + statyczny frontend)
#   • Fastify serwuje /api/* oraz zbudowany SPA z apps/web/dist
#   • Dane trwałe (SQLite + uploady) w wolumenie /data
# ──────────────────────────────────────────────────────────────────────────────

# ---------- Stage 1: zależności ----------
FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
# better-sqlite3 i sharp potrzebują toolchaina do ewentualnej kompilacji
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm run build
# Produkcyjne zależności wyłącznie dla API
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter=@fineapp/api --prod /app/deploy-api

# ---------- Stage 3: runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/fineapp.db \
    UPLOAD_DIR=/data/uploads \
    WEB_DIST_PATH=/app/web
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/deploy-api ./
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/src/db/migrations ./dist/db/migrations
COPY --from=build /app/apps/web/dist ./web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /data/uploads \
    && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
