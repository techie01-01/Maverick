# ==============================================================================
# Stage 1: Build client frontend assets
# ==============================================================================
FROM node:20-slim AS client-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Production server runtime
# ==============================================================================
FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/server/data

# Install server dependencies
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server code and test files
COPY server/src ./src
COPY server/test ./test

# Root workspace file
WORKDIR /app
COPY package.json ./

# Copy built frontend assets from builder stage
COPY --from=client-builder /app/client/dist /app/client/dist

# Setup persistent data directory
RUN mkdir -p /app/server/data
VOLUME ["/app/server/data"]

# Entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/src/index.js"]

