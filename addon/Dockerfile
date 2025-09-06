# addon/Dockerfile
# Use Node 20 (better-sqlite3 requires 20/22+)
FROM node:20-alpine AS base

# System deps to build native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ bash

WORKDIR /app

# Only copy manifests first for better caching
COPY package.json package-lock.json* ./

# Install prod deps (if you have dev deps required for build, use npm ci)
RUN npm ci --omit=dev

# Then copy the rest
COPY . .

# Expose configurable envs with sane defaults
ENV HOST=0.0.0.0 \
    PORT=7000 \
    JWT_SECRET=changeme \
    CORS_ORIGIN=* \
    NODE_ENV=production

# Healthcheck (add /health endpoint in your server if not present)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

EXPOSE 7000

CMD ["node", "server.js"]
