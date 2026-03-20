# ══════════════════════════════════════════════════════════════════════════════
# ATLAS SOC Dashboard — Dockerfile
# Multi-stage build: builder installs deps, runtime keeps the image lean.
# Python 3.12-slim
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Build ─────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

ENV PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --upgrade pip \
 && pip install --prefix=/install --no-cache-dir -r requirements.txt

RUN find /install -type d -name "__pycache__" -exec rm -r {} +


# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    postgresql-client \
    tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

# Create non-root user
RUN groupadd --system atlas \
 && useradd --system --gid atlas --no-create-home atlas

# Copy application source
COPY --chown=atlas:atlas app       ./app
COPY --chown=atlas:atlas config    ./config
COPY --chown=atlas:atlas alembic   ./alembic
COPY --chown=atlas:atlas alembic.ini .

# Create runtime data directory
RUN install -d -o atlas -g atlas data/logs

# Sanity check — catches import errors before the container is deployed
RUN python -c "import app"

USER atlas

EXPOSE 8000

# Healthcheck — uses the stdlib so curl is not required
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c \
  "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" \
  || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# ── CMD: run Alembic FIRST, then start uvicorn ────────────────────────────────
#
# This is the gatekeeper pattern:
#   1. `alembic upgrade head` — applies all pending migrations synchronously.
#      If the database is unreachable or a migration fails, the command exits
#      non-zero and Docker will NOT start uvicorn (the container exits with an
#      error, which Docker Compose restart policies will handle).
#   2. `&&`                   — only proceeds if alembic exits 0 (success).
#   3. `uvicorn ...`          — starts the app with tables guaranteed to exist.
#
# UVICORN_WORKERS defaults to 2; override via environment variable in
# docker-compose.yml or at `docker run` time:
#   docker run -e UVICORN_WORKERS=4 atlas-backend
#
CMD ["sh", "-c", \
     "alembic upgrade head && \
      uvicorn app.main:app \
        --host 0.0.0.0 \
        --port 8000 \
        --workers ${UVICORN_WORKERS:-2}"]
