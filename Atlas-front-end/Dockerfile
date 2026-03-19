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

# ── Stage 1: Install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps

# libc6-compat is required for some native Node.js bindings on Alpine
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy manifest files first so Docker can cache the install layer.
# This layer is only rebuilt when package.json or package-lock.json changes.
COPY package.json package-lock.json* ./

# Install ALL dependencies — devDependencies are required for `next build`
# (TypeScript compilation, ESLint, etc.) and are NOT included in the final image.
RUN npm ci

# ── Stage 2: Build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# ── Build argument: backend URL ───────────────────────────────────────────────
# Passed by Docker Compose (or CI) via the `args:` block.
# NEXT_PUBLIC_ prefix means this value is inlined into client JS bundles
# at build time — it cannot be changed at container runtime.
# Default: localhost:8000 for local dev without Compose.
ARG NEXT_PUBLIC_ATLAS_BACKEND_URL=http://localhost:8000
ENV NEXT_PUBLIC_ATLAS_BACKEND_URL=$NEXT_PUBLIC_ATLAS_BACKEND_URL

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Copy installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy all source files
COPY . .

# Build the production Next.js bundle.
# Requires `output: 'standalone'` in next.config.ts (already configured).
RUN npm run build

# ── Stage 3: Production runner ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user — security best practice
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the self-contained Next.js server (no node_modules needed at runtime)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets (CSS, JS chunks, images optimised by Next.js)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy the public directory (favicon, static files served verbatim)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health-check: hits the Next.js root which always returns 200 or a redirect
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Start the standalone Next.js server
CMD ["node", "server.js"]
