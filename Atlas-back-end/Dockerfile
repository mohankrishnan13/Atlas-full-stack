# ══════════════════════════════════════════════════════════════════════════════
# ATLAS SOC Dashboard — Dockerfile
# Multi-stage build: builder installs deps, runtime keeps the image lean.
# Target runtime: Python 3.12-slim (matches app/__pycache__/cpython-312 bytecode)
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Dependency builder ─────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# System packages needed to compile native extensions
#   libpq-dev  — psycopg2-binary / asyncpg
#   gcc        — C extensions in cryptography / bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages into an isolated prefix so they can be copied cleanly
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: Production runtime ─────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app

# Runtime system libraries only (no compiler toolchain)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Pull installed Python packages from builder
COPY --from=builder /install /usr/local

# Create a least-privilege user before copying application code
RUN groupadd --system atlas \
 && useradd  --system --gid atlas --no-create-home atlas

# Copy application source
COPY --chown=atlas:atlas . .

# Create data directory for log files (LOG_DATA_DIR=data/logs)
RUN mkdir -p data/logs && chown -R atlas:atlas data/

# Drop to non-root for the rest of the container's lifetime
USER atlas

# Expose the Uvicorn port (matches CMD below and docker-compose port mapping)
EXPOSE 8000

# Health-check: matches the /health endpoint in app/main.py
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# ── Entrypoint ──────────────────────────────────────────────────────────────────
# Workers: 1 is safe for development.
# Production: set --workers $(nproc) or use gunicorn -k uvicorn.workers.UvicornWorker
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info", \
     "--access-log"]
