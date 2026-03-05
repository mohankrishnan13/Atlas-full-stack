# ═══════════════════════════════════════════════════════════════════════════════
# ATLAS Frontend — Multi-Stage Docker Build
# ═══════════════════════════════════════════════════════════════════════════════
#
# Stage 1 (deps)    — installs ALL npm dependencies (including devDeps needed
#                     for the TypeScript/Next.js build). The original Dockerfile
#                     used `--only=production` here which breaks `next build`.
#
# Stage 2 (builder) — runs `next build` with the injected NEXT_PUBLIC_ env var.
#                     Next.js bakes public env vars into the JS bundle at build
#                     time, so the backend URL must be passed as a build ARG.
#
# Stage 3 (runner)  — minimal production image. Copies only the standalone
#                     output from the builder. Requires `output: 'standalone'`
#                     in next.config.ts (already set in this project).
#
# The final image is ~200 MB vs the full Node image at ~900 MB.
# ═══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy only the dependency manifests first so Docker can cache this layer.
# The layer is only re-built when package.json or package-lock.json changes.
COPY package.json package-lock.json* ./

# Install ALL dependencies (including devDependencies).
# devDeps are required during build for TypeScript compilation and Next.js.
# They are NOT copied into the final runner stage, keeping the image lean.
RUN npm ci

# ── Stage 2: Build the application ────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Receive the backend URL as a build argument.
# Passed by Docker Compose via the `args:` block.
# Default: localhost:8000 for local development.
ARG NEXT_PUBLIC_ATLAS_BACKEND_URL=http://localhost:8000

# Expose as an environment variable so Next.js can read it during build.
# NEXT_PUBLIC_ prefix means it is inlined into client-side JavaScript bundles.
ENV NEXT_PUBLIC_ATLAS_BACKEND_URL=$NEXT_PUBLIC_ATLAS_BACKEND_URL

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy all source files
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build the production bundle.
# Requires `output: 'standalone'` in next.config.ts (already configured).
RUN npm run build

# ── Stage 3: Production runner ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone Next.js server (self-contained, no node_modules needed)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy the static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy the public folder (favicon, images, etc.)
# COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the standalone Next.js server
CMD ["node", "server.js"]
