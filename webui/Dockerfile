# webui/Dockerfile

# --- Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm ci

# Copy sources
COPY . .

# Build (Vite)
# If you want a default at build time: ADDON_BASE env -> VITE_ADDON_URL
# e.g.: docker build --build-arg VITE_ADDON_URL=http://addon:7000 ...
ARG VITE_ADDON_URL
ENV VITE_ADDON_URL=${VITE_ADDON_URL}
RUN npm run build

# --- Runtime stage
FROM nginx:1.27-alpine AS runtime
WORKDIR /usr/share/nginx/html

# Copy app
COPY --from=build /app/dist/ ./

# Replace default Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
