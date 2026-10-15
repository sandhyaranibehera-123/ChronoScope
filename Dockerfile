# ==============================================================================
# CHRONOSCOPE Multi-Stage Production Dockerfile (Rules 1, 10, 19, 22)
# ==============================================================================

FROM node:24-alpine AS builder

WORKDIR /app

# Install native compilation dependencies for C++ modules (if required)
RUN apk add --no-cache python3 make g++

# Copy root workspace configurations
COPY package.json package-lock.json* tsconfig.base.json tsconfig.json vitest.config.ts ./

# Copy all workspace package.json files
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/domain/package.json ./packages/domain/
COPY packages/events/package.json ./packages/events/
COPY packages/database/package.json ./packages/database/
COPY packages/read-store/package.json ./packages/read-store/
COPY packages/replay-engine/package.json ./packages/replay-engine/
COPY packages/messaging/package.json ./packages/messaging/
COPY packages/chaos/package.json ./packages/chaos/
COPY packages/observability/package.json ./packages/observability/
COPY packages/testing/package.json ./packages/testing/

COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/projection-worker/package.json ./apps/projection-worker/
COPY apps/replay-worker/package.json ./apps/replay-worker/
COPY apps/chaos-agent/package.json ./apps/chaos-agent/
COPY apps/cli/package.json ./apps/cli/

# Install all dependencies across the monorepo
RUN npm install

# Copy source code
COPY packages/ ./packages/
COPY apps/ ./apps/

# Compile all TypeScript workspaces and build web SPA
RUN npm run build

# ==============================================================================
# Production Runner Stage
# ==============================================================================
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Security: run as non-root user
RUN addgroup -S chronoscope && adduser -S chronoscope -G chronoscope

# Copy root metadata and node_modules
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy built package distributions and package.json manifests
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps

USER chronoscope

EXPOSE 3000 50051

# Default entrypoint starts API service
CMD ["node", "apps/api/dist/index.js"]
