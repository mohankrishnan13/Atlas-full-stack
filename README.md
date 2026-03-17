# ATLAS — Advanced Traffic Layer Anomaly System

Enterprise-grade Security Operations Centre (SOC) dashboard. **PostgreSQL + Velociraptor** replace Elasticsearch + Wazuh. Full-stack: FastAPI backend, Next.js 15 + React 19 frontend, all data from the API (no mock data).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Quick Start](#2-quick-start)
3. [Architecture & Stack](#3-architecture--stack)
4. [Repository Structure](#4-repository-structure)
5. [Backend (FastAPI)](#5-backend-fastapi)
6. [Frontend (Next.js)](#6-frontend-nextjs)
7. [Environment & Config](#7-environment--config)
8. [Default Credentials](#8-default-credentials)
9. [Security & Production Notes](#9-security--production-notes)
10. [Future / Production Roadmap](#10-future--production-roadmap)
11. [UI & Style Guidelines](#11-ui--style-guidelines)

---

## 1. Overview

ATLAS gives SOC analysts a unified view of:

- **API traffic** — cost, rate limits, abuse; consumption and routing by **application**
- **Network** — anomalies by **source IP** and **target app**; mitigation (e.g. hard block)
- **Endpoint security** — Velociraptor/Wazuh events by **hostname**; quarantine
- **Database / DLP** — operations and suspicious activity by **target app**; kill-query
- **Incidents** — lifecycle, AI summaries, Block IP / Isolate / Dismiss
- **RBAC** — Admin, Analyst, Read-Only

**Replaced:** Elasticsearch → PostgreSQL 16 + JSONB; Wazuh → Velociraptor webhooks; Redis sessions → stateless JWT; mock data → 100% FastAPI; Next.js API routes → direct browser → FastAPI.

---

## 2. Quick Start

**Prerequisites:** Docker 24+ and Docker Compose v2.

```bash
cd Atlas-full-stack
cp .env.example .env
# Edit .env: set POSTGRES_*, SECRET_KEY, INGEST_API_KEY, VELOCIRAPTOR_WEBHOOK_SECRET
docker compose up --build
```

- **Dashboard:** http://localhost:3000  
- **API docs:** http://localhost:8000/docs  
- **Health:** http://localhost:8000/health  

**How data works in this release (source of truth):**

- **Applications catalog:** Stored in PostgreSQL (see `ApplicationRow`), returned by `GET /header-data`.
- **Logs:** Sample JSONL files in `Atlas-back-end/data/logs/` are ingested into PostgreSQL on backend startup (controlled by `REINGEST_ON_STARTUP`). All dashboard endpoints query PostgreSQL.

**Generate secrets:**
```bash
python -c "import secrets; print(secrets.token_hex(32))"   # SECRET_KEY / VELOCIRAPTOR_WEBHOOK_SECRET
python -c "import secrets; print(secrets.token_urlsafe(48))"  # INGEST_API_KEY
```

**Useful commands:**
```bash
docker compose up -d              # background
docker compose logs -f            # all logs
docker compose down               # stop (DB kept)
docker compose down -v            # stop + remove DB volume
docker compose up --build atlas-backend   # rebuild backend
docker compose up --build atlas-frontend  # rebuild frontend
```

**Troubleshooting:** If frontend crashes, ensure the correct Dockerfile and `next.config.ts` are in `Atlas-front-end/`. If login fails, check `docker compose ps`. If panels show "Failed to load data", restart backend: `docker compose restart atlas-backend`. The browser calls the backend at `http://localhost:8000`; keep that port mapped in `docker-compose.yml`.

---

## 3. Architecture & Stack

- **Browser** (port 3000) → Next.js dashboard; all API calls go to **FastAPI** (port 8000) with JWT.
- **FastAPI** → asyncpg → **PostgreSQL 16**.
  - **Current (MVP) ingest:** JSONL files from `Atlas-back-end/data/logs/` → Postgres on startup.
  - **Near-real-time ingest (available now):** Vector/Fluent Bit → `POST /api/ingest/http`.
  - **Optional cold-path replay:** S3 poller (disabled by default).
  - **Endpoint telemetry (future-ready):** Velociraptor → `POST /webhooks/velociraptor`.

**Backend:** FastAPI, Uvicorn, SQLAlchemy (async), asyncpg, Pydantic v2, python-jose (JWT), passlib (bcrypt), boto3, httpx.  
**Frontend:** Next.js 15, React 19, TypeScript, Tailwind, shadcn/ui, Recharts, React Hook Form + Zod, Genkit (Gemini).  
**Infra:** Docker Compose, PostgreSQL 16 Alpine.

---

## 4. Repository Structure

```
Atlas-full-stack/
├── docker-compose.yml
├── .env.example
├── README.md
├── Atlas-back-end/
│   ├── Dockerfile, requirements.txt
│   ├── app/ (main.py, api/routes*, core/, models/, services/)
│   ├── data/logs/   # JSONL sample data
│   └── config/vector.toml
└── Atlas-front-end/
    ├── Dockerfile, next.config.ts
    └── src/ (app/(auth)|(dashboard), components/, context/, lib/, ai/flows)
```

---

## 5. Backend (FastAPI)

**DB tables:** `network_logs`, `api_logs`, `endpoint_logs`, `db_activity_logs`, `incidents`, `alerts`, `atlas_users`, `user_sessions`, `s3_ingest_cursor`. All log tables have `env` (cloud/local) and `raw_payload` JSONB.

**Applications (source of truth):**

- The app selector on the frontend is populated from `GET /header-data`.
- `GET /header-data` returns applications from the DB (see `ApplicationRow` filtered by `env`).
- The frontend does not hardcode app names; whatever apps your company has deployed should be represented by rows in PostgreSQL.

**Dashboard GETs** (all support `?env=cloud|local`): `/overview`, `/api-monitoring`, `/network-traffic`, `/endpoint-security`, `/db-monitoring`, `/incidents`, `/header-data`, `/users`, `/health`.

**Mitigation / actions:**  
`POST /endpoint-security/quarantine` (workstationId), `POST /incidents/remediate` (incidentId, action: Block IP | Isolate Endpoint | Dismiss), `POST /network-traffic/block` (sourceIp, app), `POST /db-monitoring/kill-query` (activityId, app, user), `POST /api-monitoring/block-route` (app, path).

**Auth** (`/api/auth/`): `POST /login`, `GET|PUT /me`, `POST /change-password`, `PATCH /2fa`, `GET /sessions`, `GET|POST|PUT|DELETE /users` (admin). JWT in `Authorization: Bearer <token>`; 401 → frontend clears token and redirects to `/login`.

**Ingest:** `POST /api/ingest/http` (API key header; batch JSON array or `{ "logs": [...] }`). **Webhook:** `POST /webhooks/velociraptor` (HMAC-verified). **Settings:** `GET|POST|PATCH|DELETE /settings/containment-rules`.

**Data sources (current vs future):**

- **Current (this release):** JSONL in `Atlas-back-end/data/logs/` is ingested into PostgreSQL on backend startup by `app/services/log_ingestion.py`.
  - Controlled by `REINGEST_ON_STARTUP` (recommended `true` for development; set `false` to preserve DB data across restarts).
  - The ingest reads:
    - `network_logs.jsonl`
    - `api_logs.jsonl`
    - `endpoint_logs.jsonl`
    - `db_activity_logs.jsonl`
    - `incidents.jsonl`
    - `alerts.jsonl`
- **Available now (future-friendly):** `POST /api/ingest/http` accepts batches from shippers such as Vector/Fluent Bit/Logstash.
- **Optional:** S3 replay ingestor (disabled by default).
- **Future:** Velociraptor webhook ingestion for endpoint events.

---

## 6. Frontend (Next.js)

**Data:** All dashboard data from FastAPI via `src/lib/api.ts` (`apiGet`, `apiPost`, `apiPut`, `apiDelete`). JWT from `localStorage` (`atlas_auth_token`); 401 triggers logout and redirect. No mock data.

**Apps are backend-driven:** the header app selector uses the DB-backed list from `GET /header-data`. This supports the real enterprise use case where multiple internal apps are deployed in cloud environments.

**Pages:** Overview (KPIs, app anomalies, microservice topology, API requests by app, system anomalies); API Monitoring (consumption by app, routing table, Apply Hard Block); Network (anomalies by app & by source IP, Apply Hard Block); Endpoint (OS/alert charts, alerts by hostname, Quarantine Device); Database (operations by app, DLP by app, Kill Query); Incidents (list, AI investigator sheet, Block IP / Isolate / Dismiss); Profile (edit, password, 2FA, sessions); Settings (user access, containment, etc.); Reports.

**Charts:** Categorical only (by app, hostname, or source IP)—no time-series line charts. Bar/horizontal bar for consumption, anomalies, DLP, etc.

**Auth:** `AuthContext` fetches `GET /api/auth/me`. Header uses auth user when available. Login stores JWT; dashboard layout guards on token.

---

## 7. Environment & Config

Single `.env` at repo root. Key variables:

- **DB:** `DATABASE_URL` (asyncpg), `DATABASE_URL_SYNC` (Alembic), `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- **Auth:** `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`
- **Ingest:** `INGEST_API_KEY`, `INGEST_API_KEY_HEADER`, `INGEST_MAX_BATCH_SIZE`
- **Velociraptor:** `VELOCIRAPTOR_WEBHOOK_SECRET`
- **Optional S3:** `S3_ENABLED`, `AWS_*`, `S3_LOG_BUCKET`, `S3_LOG_PREFIX`, `S3_POLL_INTERVAL_SECONDS`, `S3_MAX_KEYS_PER_POLL`
- **Frontend:** `NEXT_PUBLIC_ATLAS_BACKEND_URL` (e.g. `http://localhost:8000`)

Do not commit `.env`.

---

## 8. Default Credentials

Seeded once when no users exist:

| Email             | Password      | Role      |
|-------------------|---------------|-----------|
| admin@atlas.com  | AtlasAdmin1!  | Admin     |
| analyst@atlas.com| Analyst123!   | Analyst   |
| audit@atlas.com  | ReadOnly123!  | Read-Only |

Change these after first login in any non-local environment.

---

## 9. Security & Production Notes

- Passwords: bcrypt (passlib). JWT: HS256, expiry 60 min. Ingest key: `hmac.compare_digest`. Velociraptor: HMAC-SHA256. RBAC enforced per route; deactivated users rejected.
- Audit: login attempts in `user_sessions`; user “deletes” are soft (is_active=false).
- For production: strong random `SECRET_KEY`; HTTPS (reverse proxy); secrets manager for `.env`; rate limiting on ingest; do not expose DB port.

---

## 10. Future / Production Roadmap

- **Velociraptor:** Deploy server; create Server Event Artifact that POSTs to `/webhooks/velociraptor` with HMAC; deploy agents (MSI/DEB). Backend already accepts and verifies webhooks.
- **Live streams:** Replace file ingestion with Kafka consumer (`aiokafka`) or Syslog UDP listener for high-throughput or on-prem.
- **Cloud log shipping:** Replace JSONL startup ingestion with a shipper-based pipeline.
  - **Agent-based shippers:** Vector / Fluent Bit / Filebeat running on nodes, clusters, or VMs.
  - **Transport:** HTTP ingest (`/api/ingest/http`) now, Kafka later, or direct to a log store.
  - **Storage:** Postgres for SOC dashboard queries; optionally OpenSearch/Elasticsearch for long retention/search.
- **Kibana / Elastic stack (future release):**
  - Keep ATLAS as the analyst workflow + action layer.
  - Use Elasticsearch/OpenSearch + Kibana for exploratory search, dashboards, and long-term retention.
  - Add connectors so ATLAS can correlate anomalies/incidents with deep Kibana links.
- **Hardening:** Alembic migrations; JWT refresh tokens; token revocation (e.g. Redis); full TOTP 2FA (pyotp + QR); rate limiting (e.g. slowapi); CORS allowlist; Prometheus/OpenTelemetry; Kubernetes with secrets.
- **AI:** Genkit flows (daily briefing, investigator) require `GOOGLE_GENAI_API_KEY` if used.

---

## 11. UI & Style Guidelines

- **Theme:** Dark; deep slate/navy (#233554), cards #334155; high contrast for SOC use.
- **Severity:** Critical red, High orange, Medium yellow, Low/Healthy green.
- **Font:** Inter (or similar). **Icons:** Lucide. **Layout:** Persistent sidebar + top bar (environment, alerts, user).
- **Charts:** Categorical bar/horizontal bar by app or hostname; no generic time-series X-axis.
- **Responsive:** Layout works across screen sizes; smooth transitions.

---

# ATLAS Backend — Security Reference

This document describes the threat model, secret management conventions, and
operational security runbook for the ATLAS SOC Dashboard backend.

---

## 1. Threat Model

| Asset | Threat | Control |
|---|---|---|
| Wazuh API password | Exposed in source code | Removed all defaults; required via `WAZUH_PASSWORD` env var |
| JWT signing key | Weak/default key allows token forgery | `SECRET_KEY` is required, min-length validated, placeholder-rejected |
| Ingest API key | Credential stuffing from public pipelines | `INGEST_API_KEY` required; `hmac.compare_digest` prevents timing oracle |
| Seed account passwords | Default creds left unchanged in prod | All three seed passwords are required env vars with no Python default |
| Velociraptor webhook secret | Unsigned webhook replay attacks | `VELOCIRAPTOR_WEBHOOK_SECRET` required; HMAC-SHA256 verification |
| Database URL | Plaintext connection string in repo | `DATABASE_URL` required env var; never committed |
| AWS credentials | Overprivileged long-lived keys | Prefer IAM role; keys optional and blank-able in `.env` |

---

## 2. Secret Inventory

Every secret the backend requires, how to generate it, and where it is used:

### `SECRET_KEY`
- **Purpose:** Signs and verifies all JWT access tokens.
- **Generate:** `python -c "import secrets; print(secrets.token_hex(32))"`
- **Rotation impact:** All active sessions are immediately invalidated. Users must log in again.
- **Used in:** `auth_service.create_access_token`, `auth_service.decode_token`

### `INGEST_API_KEY`
- **Purpose:** Authenticates Vector/Fluent Bit HTTP ingest pipelines.
- **Generate:** `python -c "import secrets; print(secrets.token_urlsafe(48))"`
- **Rotation impact:** All ingestion pipelines stop until their config is updated with the new key.
- **Used in:** `core/security.py` — `require_ingest_api_key` dependency

### `WAZUH_PASSWORD`
- **Purpose:** Authenticates the ATLAS backend against the Wazuh Manager REST API.
- **Rotation:** Change in Wazuh UI → update `WAZUH_PASSWORD` in `.env` → restart ATLAS.
- **Used in:** `services/connectors/wazuh_client.py`, `services/wazuh_service.py`, `core/wazuh_client.py`

### `VELOCIRAPTOR_WEBHOOK_SECRET`
- **Purpose:** HMAC-SHA256 signature verification for Velociraptor webhooks.
- **Generate:** `openssl rand -hex 32`
- **Used in:** Webhook validation middleware (routes that accept Velociraptor payloads)

### `SEED_ADMIN_PASSWORD` / `SEED_ANALYST_PASSWORD` / `SEED_READONLY_PASSWORD`
- **Purpose:** Bootstrap user accounts on first startup (when `atlas_users` is empty).
- **Important:** After first boot these are hashed and stored in the database. Changing `.env` does **not** change the stored hash — use the UI or a DB migration instead.
- **Rotation:** Update the hash in the DB directly or via the change-password endpoint.

### `DATABASE_URL`
- **Purpose:** Async SQLAlchemy connection string (contains DB password).
- **Format:** `postgresql+asyncpg://user:password@host:5432/dbname`
- **Rotation:** Update `.env`, restart ATLAS and docker-compose `postgres` service together.

---

## 3. Placeholder Rejection

`config.py` ships a `_KNOWN_PLACEHOLDERS` sentinel set. At startup, every
secret field runs `_reject_placeholder()` which raises a `ValidationError` if
the value matches any of these strings:

```
change_me_in_production, change_me_super_secret_key_for_jwt_signing,
atlasadmin1!, analyst123!, readonly123!, changeme, change, password, …
```

This means a forgotten `.env.example` copy-paste causes an **immediate, loud
failure** rather than a silent security misconfiguration.

---

## 4. Pre-flight Validation

Before starting the application in any environment, run:

```bash
python scripts/check_env.py
```

This script:
- Loads `.env` (or `$ENV_FILE`)
- Checks every required variable is set, non-empty, meets minimum length, and
  does not contain a known placeholder
- Runs format validators (URL structure, database driver presence)
- Exits `0` on success, `1` on any failure

**Integrate in Dockerfile:**
```dockerfile
CMD ["sh", "-c", "python scripts/check_env.py && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
```

---

## 5. SSL / TLS

### Wazuh Manager
Wazuh ships with a self-signed certificate. For development:
```env
WAZUH_VERIFY_SSL=false
```

For production, replace the cert and set:
```env
WAZUH_VERIFY_SSL=true
WAZUH_CA_BUNDLE=/etc/wazuh-certs/ca.pem
```

### ATLAS Backend (inbound TLS)
Terminate TLS at a reverse proxy (nginx, Caddy, AWS ALB). Do not expose
uvicorn's plaintext port to the internet.

---

## 6. Key Rotation Runbook

### Rotating `SECRET_KEY`
1. Generate new key: `python -c "import secrets; print(secrets.token_hex(32))"`
2. Update `SECRET_KEY` in `.env` (or secrets manager).
3. Restart ATLAS. **All active sessions expire immediately.**
4. Notify analysts — they must log in again.

### Rotating `INGEST_API_KEY`
1. Generate new key.
2. Update `INGEST_API_KEY` in `.env`.
3. Update the key in every Vector/Fluent Bit config file.
4. Restart Vector/Fluent Bit first, then restart ATLAS.
5. Verify ingestion resumes: `curl -H "X-Atlas-API-Key: $NEW_KEY" http://localhost:8000/health`

### Rotating `WAZUH_PASSWORD`
1. Change the password in the Wazuh Manager UI (`wazuh-wui` user).
2. Update `WAZUH_PASSWORD` in `.env`.
3. Restart ATLAS. The token cache will refresh on the next poll cycle.

---

## 7. Secrets Management in Production

For production deployments, prefer a secrets manager over a plaintext `.env` file:

| Platform | Recommended approach |
|---|---|
| AWS ECS / EC2 | AWS Secrets Manager → inject as env vars in task definition |
| Kubernetes | Kubernetes Secrets (external-secrets-operator for rotation) |
| Docker Swarm | `docker secret` → mounted as env vars |
| Self-hosted | HashiCorp Vault Agent → write `.env` to a tmpfs mount |

`pydantic-settings` reads from environment variables regardless of how they
are injected — no code changes required when switching from `.env` to a
secrets manager.

---

## 8. Reporting Vulnerabilities

If you discover a security vulnerability in ATLAS, please open a **private**
GitHub Security Advisory rather than a public issue, so the team can
coordinate a fix before disclosure.

*ATLAS is for internal SOC use. Do not expose to the internet without HTTPS, rate limiting, and proper secrets management.*
