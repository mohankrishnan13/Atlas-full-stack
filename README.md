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
- **FastAPI** → asyncpg → **PostgreSQL 16**. Ingest: Vector/Fluent Bit → `POST /api/ingest/http`; S3 cold path (optional); Velociraptor → `POST /webhooks/velociraptor`.

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

**Dashboard GETs** (all support `?env=cloud|local`): `/overview`, `/api-monitoring`, `/network-traffic`, `/endpoint-security`, `/db-monitoring`, `/incidents`, `/header-data`, `/users`, `/health`.

**Mitigation / actions:**  
`POST /endpoint-security/quarantine` (workstationId), `POST /incidents/remediate` (incidentId, action: Block IP | Isolate Endpoint | Dismiss), `POST /network-traffic/block` (sourceIp, app), `POST /db-monitoring/kill-query` (activityId, app, user), `POST /api-monitoring/block-route` (app, path).

**Auth** (`/api/auth/`): `POST /login`, `GET|PUT /me`, `POST /change-password`, `PATCH /2fa`, `GET /sessions`, `GET|POST|PUT|DELETE /users` (admin). JWT in `Authorization: Bearer <token>`; 401 → frontend clears token and redirects to `/login`.

**Ingest:** `POST /api/ingest/http` (API key header; batch JSON array or `{ "logs": [...] }`). **Webhook:** `POST /webhooks/velociraptor` (HMAC-verified). **Settings:** `GET|POST|PATCH|DELETE /settings/containment-rules`.

**Data sources:** MVP ingests JSONL from `data/logs/` on startup (`REINGEST_ON_STARTUP`). Production: Vector → `/api/ingest/http`; optional S3 poll; Velociraptor webhooks.

---

## 6. Frontend (Next.js)

**Data:** All dashboard data from FastAPI via `src/lib/api.ts` (`apiGet`, `apiPost`, `apiPut`, `apiDelete`). JWT from `localStorage` (`atlas_auth_token`); 401 triggers logout and redirect. No mock data.

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

*ATLAS is for internal SOC use. Do not expose to the internet without HTTPS, rate limiting, and proper secrets management.*
