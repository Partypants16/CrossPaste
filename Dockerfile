# syntax=docker/dockerfile:1

# --- Stage 1: install production dependencies (native modules may need build tools) ---
FROM node:22-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Stage 2: minimal runtime image ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    APP_HOST=0.0.0.0 \
    APP_PORT=3000 \
    DATA_DIRECTORY=/app/data \
    UPLOAD_DIRECTORY=/app/data/uploads \
    THUMBNAIL_DIRECTORY=/app/data/thumbnails

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY migrations ./migrations
COPY scripts ./scripts

# The "node" user/group (uid/gid 1000) already exists in the official Node.js image.
RUN mkdir -p /app/data/uploads /app/data/thumbnails \
  && chown -R node:node /app

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.APP_PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

CMD ["node", "server/server.js"]
