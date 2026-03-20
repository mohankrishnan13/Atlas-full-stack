# ══════════════════════════════════════════════════════════════════════════════
# ATLAS Frontend — Multi-Stage Docker Build
# Node 20 LTS · Next.js 15 standalone output
#
# Stage 1 (deps)     — installs ALL npm packages (including devDeps required
#                      by the TypeScript/Next.js compiler).
# Stage 2 (builder)  — runs `next build`. Bakes NEXT_PUBLIC_ATLAS_BACKEND_URL
#                      into the JS bundle at build time (Next.js public env vars
#                      are inlined at build, not runtime).
# Stage 3 (runner)   — minimal production image; copies only the standalone
#                      server from the builder. Requires `output: 'standalone'`
#                      in next.config.ts (already set).
#
# Final image: ~200 MB vs the full node image at ~900 MB.
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Install dependencies ──────────────────────────────
FROM node:20.11-slim AS deps

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci


# ── Stage 2: Build ─────────────────────────────────────────────
FROM node:20.11-slim AS builder

WORKDIR /app

# Disable telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# If you STILL want build-time API URL, keep this.
# Otherwise, remove and rely on Nginx (/api proxy)
ARG NEXT_PUBLIC_ATLAS_BACKEND_URL=http://atlas-backend:8000
ENV NEXT_PUBLIC_ATLAS_BACKEND_URL=$NEXT_PUBLIC_ATLAS_BACKEND_URL

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source (safe because of .dockerignore)
COPY . .

# Build Next.js standalone output
RUN npm run build

# 🔒 Safety check — ensure standalone build exists
RUN test -f .next/standalone/server.js || (echo "❌ Standalone build failed" && exit 1)


# ── Stage 3: Production runner ─────────────────────────────────
FROM node:20.11-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=256"

# Install tini (proper signal handling)
RUN apt-get update && apt-get install -y tini \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 nextjs

# Copy standalone server
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Use non-root user
USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Healthcheck (basic but reliable)
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Proper container init
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start Next.js standalone server
CMD ["node", "server.js"]