# ATLAS — Advanced Traffic Layer Anomaly System

> **Full-Stack Enterprise SOC Dashboard** — FastAPI · PostgreSQL · Wazuh · Next.js 15 · React 19

ATLAS is a cloud-native Security Operations Centre (SOC) dashboard. The backend aggregates telemetry from network, API, endpoint, and database sources, integrates bidirectionally with Wazuh for real-time SIEM alerts and active-response mitigations, and exposes a structured REST API. The frontend is a Next.js 15 application that consumes that API exclusively — zero mock data, zero hardcoded fallbacks.

---

## Table of Contents

- [System Architecture](#system-architecture)
- [Repository Layout](#repository-layout)
- [Backend — FastAPI](#backend--fastapi)
  - [Tech Stack](#backend-tech-stack)
  - [Project Structure](#backend-project-structure)
  - [API Endpoints](#api-endpoints)
  - [Data Models](#data-models)
  - [Startup Sequence](#startup-sequence)
  - [Wazuh Integration](#wazuh-integration)
  - [Authentication & RBAC](#authentication--rbac)
  - [Database Migrations](#database-migrations)
  - [Backend Configuration](#backend-configuration)
- [Frontend — Next.js](#frontend--nextjs)
  - [Tech Stack](#frontend-tech-stack)
  - [Project Structure](#frontend-project-structure)
  - [Pages & Routes](#pages--routes)
  - [API Client](#api-client)
  - [State Management](#state-management)
  - [Frontend Configuration](#frontend-configuration)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Quick Start (Docker Compose)](#quick-start-docker-compose)
  - [Local Backend Dev](#local-backend-dev)
  - [Local Frontend Dev](#local-frontend-dev)
- [Environment Variables](#environment-variables)
- [Security Notes](#security-notes)
- [Known Issues Fixed](#known-issues-fixed)

---

## System Architecture

```
Browser (Next.js 15 SPA)
         │
         │  JWT Bearer / REST over HTTP
         ▼
┌────────────────────────────────────────┐
│          FastAPI  (ATLAS Backend)      │
│                                        │
│  /api/auth/*    /overview              │
│  /api-monitoring  /network-traffic     │
│  /endpoint-security  /database-        │
│  monitoring  /incidents                │
│  /case-management  /reports            │
│  /settings/*  /api-monitoring/         │
│    block-route  /network-traffic/block │
│  /endpoint-security/quarantine         │
│  /db-monitoring/kill-query             │
│  /incidents/remediate                  │
│                                        │
│  ┌─────────────────────────────────┐   │
│  │  Query Services (decoupled)     │   │
│  │  overview · endpoint · network  │   │
│  │  api · db · reports             │   │
│  └─────────────────────────────────┘   │
│                                        │
│  ┌──────────────┐  ┌───────────────┐  │
│  │ asyncpg /    │  │  WazuhActions  │  │
│  │ SQLAlchemy   │  │  WazuhCollector│  │
│  └──────────────┘  └───────────────┘  │
└───────────────┬────────────────┬───────┘
                │                │
       ┌────────▼──┐    ┌────────▼──────┐
       │ PostgreSQL │    │ Wazuh Manager │
       │  15+       │    │ + Indexer     │
       └────────────┘    └───────────────┘
```

**Backend startup sequence** (FastAPI `lifespan`):
1. `seed_default_admin()` — creates three role-separated accounts on first boot
2. `_seed_applications_config()` — populates Applications, Microservices, AppConfigs
3. `_start_wazuh_sync()` — background coroutine polling Wazuh every 60 seconds

---

## Repository Layout

```
atlas/
├── Atlas-back-end/          # FastAPI backend
│   ├── app/
│   │   ├── main.py
│   │   ├── api/             # Route handlers
│   │   ├── core/            # Config, DB, security, Wazuh client
│   │   ├── models/          # SQLAlchemy ORM + Pydantic schemas
│   │   └── services/        # Business logic + query services
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
└── Atlas-front-end/         # Next.js 15 frontend
    ├── src/
    │   ├── app/             # App Router pages
    │   ├── components/      # Shared UI components
    │   ├── context/         # React context (Auth, Environment)
    │   ├── lib/             # API client, types, utils
    │   └── hooks/
    ├── Dockerfile
    └── next.config.ts
```

---

## Backend — FastAPI

### Backend Tech Stack

| Layer | Technology |
|---|---|
| Web framework | FastAPI 0.115 |
| ASGI server | Uvicorn (standard extras) |
| ORM | SQLAlchemy 2.0 (async) |
| Async DB driver | asyncpg |
| Database | PostgreSQL 15+ |
| Auth | JWT via `python-jose`, bcrypt via `passlib` |
| Validation | Pydantic v2 + pydantic-settings |
| Wazuh HTTP | `requests` (synchronous, WazuhActions only) |
| Data analytics | Pandas + NumPy (in-memory query layer) |
| Migrations | Alembic |
| Containerisation | Docker (multi-stage, Python 3.12-slim) |

### Backend Project Structure

```
app/
├── main.py                    # FastAPI app factory, lifespan, routers
├── api/
│   ├── routes_auth.py         # /api/auth/* — login, profile, RBAC
│   ├── routes_dashboard.py    # Read-only dashboard aggregation
│   ├── routes_actions.py      # SOC mitigation write endpoints
│   └── routes_settings.py     # App config & quarantine management
├── core/
│   ├── config.py              # pydantic-settings — all env vars
│   ├── database.py            # Async engine, session factory, Base
│   ├── security.py            # Ingest API key (HMAC) dependency
│   └── wazuh_client.py        # WazuhActions — active-response REST
├── models/
│   ├── db_models.py           # 16 SQLAlchemy ORM tables
│   └── schemas.py             # Pydantic response schemas
└── services/
    ├── auth_service.py        # JWT, bcrypt helpers, RBAC deps
    ├── wazuh_service.py       # WazuhCollector background task
    └── query/                 # Decoupled per-domain query modules
        ├── overview_service.py
        ├── endpoint_service.py
        ├── network_service.py
        ├── api_service.py
        ├── db_service.py
        └── reports_service.py
```

### API Endpoints

#### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Service info (name, version, env) |
| `GET` | `/health` | Live database connectivity check |

#### Authentication — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Issue JWT token |
| `GET` | `/api/auth/me` | JWT | Current user profile |
| `PUT` | `/api/auth/me` | JWT | Update name/email/phone/avatar |
| `POST` | `/api/auth/change-password` | JWT | Rotate own password |
| `PATCH` | `/api/auth/2fa` | JWT | Toggle TOTP 2FA |
| `GET` | `/api/auth/sessions` | JWT | Last 10 login sessions |
| `GET` | `/api/auth/users` | Admin | List all platform users |
| `POST` | `/api/auth/users/invite` | Admin | Create & invite a new user |
| `PUT` | `/api/auth/users/{id}/role` | Admin | Change a user's role |
| `DELETE` | `/api/auth/users/{id}` | Admin | Deactivate a user account |

#### Dashboard (Read-Only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/header-data` | Authenticated user, app list, recent alerts |
| `GET` | `/users` | Team user list |
| `GET` | `/overview` | API requests, error rate, alerts, microservice map |
| `GET` | `/endpoint-security` | Monitored laptops, Wazuh events, OS distribution |
| `GET` | `/network-traffic` | Bandwidth, connections, anomalies |
| `GET` | `/api-monitoring` | API calls, latency, cost, routing table |
| `GET` | `/database-monitoring` | Query activity, suspicious ops, DLP |
| `GET` | `/incidents` | Full incident list (newest-first) |
| `GET` | `/case-management` | Incident investigation data + KPIs |
| `GET` | `/reports/overview` | Scheduled reports + recent downloads |

#### Mitigation Actions (Write)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api-monitoring/block-route` | Hard-block an API route |
| `POST` | `/network-traffic/block` | Block a network source IP |
| `POST` | `/endpoint-security/quarantine` | Isolate endpoint via Wazuh active-response |
| `POST` | `/settings/apps/{app_id}/quarantine/lift` | Lift an active quarantine |
| `POST` | `/db-monitoring/kill-query` | Kill a suspicious DB query |
| `POST` | `/incidents/remediate` | Dismiss / contain / close an incident |
| `POST` | `/reports/generate` | Generate and archive a report |

Every action endpoint writes an immutable row to `mitigation_audit_logs` (analyst email, role, action type, target, outcome, full request payload as JSONB).

#### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/settings/apps/{app_id}` | Get per-app security config |
| `PUT` | `/settings/apps/{app_id}` | Update anomaly scores, rate limits, ML params |
| `GET` | `/settings/apps/{app_id}/quarantine` | List quarantined endpoints for an app |

### Data Models

**Stateful / mutable tables:**

| Table | Purpose |
|---|---|
| `atlas_users` | Users with RBAC roles, TOTP, avatar |
| `user_sessions` | Login audit log |
| `applications` | Registered protected applications per environment |
| `microservices` | Service topology nodes |
| `app_configs` | Per-app anomaly thresholds and ML tuning |
| `quarantined_endpoints` | Active quarantine ledger |
| `incidents` | Security incident cases (Active → Contained → Closed) |
| `scheduled_reports` | Recurring report definitions |
| `report_downloads` | Generated report download manifest |
| `mitigation_audit_logs` | Immutable SOC action audit trail |
| `s3_ingest_cursor` | S3 polling idempotency ledger |

**Telemetry write-store:**

| Table | Purpose |
|---|---|
| `network_logs` | Network anomaly / IDS events |
| `api_logs` | API call telemetry |
| `endpoint_logs` | Workstation alerts, malware flags |
| `db_activity_logs` | Database operation audit |
| `alerts` | Notification bell aggregated alerts |

### Startup Sequence

Table creation is handled exclusively by **Alembic** migrations. The app's `lifespan` only runs seed operations after tables exist:

```python
async with lifespan(app):
    await seed_default_admin()          # idempotent
    await _seed_applications_config()   # idempotent
    asyncio.create_task(_start_wazuh_sync())  # polls every 60s
```

### Wazuh Integration

**Inbound (alert sync):** `WazuhCollector` polls the Wazuh Indexer at `wazuh-alerts-*` every 60 seconds and persists new alerts to `alerts` and `endpoint_logs`.

**Outbound (active response):** `WazuhActions.run_command(agent_id, command)` sends commands to the Wazuh Manager's Active Response REST endpoint:
- `host-deny600` — block host for 600 seconds (quarantine action)
- `host-deny` — indefinite block (isolate-endpoint remediation)
- `firewall-drop` — iptables DROP rule

All credentials are read from `Settings` (env vars). No credentials in source code. Set `WAZUH_VERIFY_SSL=true` and `WAZUH_CA_BUNDLE=/path/to/ca.pem` in production.

### Authentication & RBAC

JWT Bearer tokens issued by `POST /api/auth/login`. Three roles:

| Role | Permissions |
|---|---|
| `Admin` | Full access — user management, role changes, all write actions |
| `Analyst` | Dashboard reads + all mitigation actions |
| `Read-Only` | Dashboard reads only |

Machine-to-machine log ingestion uses a static `INGEST_API_KEY` in the `X-Atlas-API-Key` header, verified via `hmac.compare_digest`.

### Database Migrations

```bash
# Apply all pending migrations before first start
alembic upgrade head

# Autogenerate migration after changing db_models.py
alembic revision --autogenerate -m "add_column_xyz"

# Check current state
alembic current
```

### Backend Configuration

All config from env vars (`.env` file). Key groups:

| Group | Key prefix | Required |
|---|---|---|
| Application | `APP_*`, `DEBUG` | Optional |
| PostgreSQL | `DATABASE_URL`, `DB_*`, `POSTGRES_*` | Required |
| Seed accounts | `SEED_*_PASSWORD` | Required |
| JWT | `SECRET_KEY` | Required |
| Ingest API | `INGEST_API_KEY` | Required |
| Wazuh Manager | `WAZUH_API_URL`, `WAZUH_USERNAME`, `WAZUH_PASSWORD` | Required |
| Wazuh Indexer | `WAZUH_INDEXER_URL`, `WAZUH_INDEXER_USERNAME`, `WAZUH_INDEXER_PASSWORD` | Required |
| CORS | `ALLOWED_CORS_ORIGINS` | Optional |
| Ollama LLM | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Optional |
| Risk thresholds | `RISK_*`, `ANOMALY_SCORE_THRESHOLD` | Optional |
| AWS S3 | `S3_ENABLED`, `AWS_*` | Optional |

The app refuses to start if any required secret contains a placeholder value (`change_me`, `password`, `secret`, etc.).

---

## Frontend — Next.js

### Frontend Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 |
| UI library | Radix UI + shadcn/ui |
| Charts | Recharts 2 |
| Styling | Tailwind CSS 3 |
| Forms | React Hook Form + Zod |
| API client | Custom `apiFetch` wrapper (no additional HTTP library) |
| Auth state | React Context (`AuthContext`) |
| Notifications | Sonner toast |
| AI Copilot | Vercel AI SDK (`useChat`) → `/api/copilot` Next.js route |

### Frontend Project Structure

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx          # JWT login form
│   │   ├── signup/page.tsx
│   │   └── forgot-password/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx              # Auth guard + sidebar + header
│   │   ├── overview/page.tsx       # Security overview + charts
│   │   ├── api-monitoring/page.tsx # API consumption + abuse detection
│   │   ├── network-traffic/page.tsx# Network KPIs + anomaly table
│   │   ├── endpoint-security/page.tsx # Wazuh event log + quarantine
│   │   ├── database-monitoring/page.tsx # DB ops + DLP + kill-query
│   │   ├── incidents/page.tsx      # Case management board
│   │   ├── reports/page.tsx        # Report generation + downloads
│   │   ├── settings/page.tsx       # User access management
│   │   └── profile/page.tsx        # Profile, password, 2FA, sessions
│   ├── api/
│   │   └── copilot/route.ts        # Next.js API route → Genkit/Ollama
│   ├── layout.tsx
│   └── page.tsx                    # Redirects to /login
├── components/
│   ├── auth/                       # Login card, ATLAS logo
│   ├── dashboard/
│   │   ├── header.tsx              # Top bar: env selector, alerts, user menu
│   │   ├── sidebar.tsx             # Collapsible nav (all 8 routes enabled)
│   │   ├── ai-copilot-widget.tsx   # Floating AI chat widget
│   │   └── dashboard-providers.tsx # AuthProvider + EnvironmentProvider
│   └── ui/                         # shadcn/ui primitives
├── context/
│   ├── AuthContext.tsx             # JWT user state, fetches /api/auth/me
│   └── EnvironmentContext.tsx      # cloud | local env switcher
├── lib/
│   ├── api.ts                      # Centralized fetch client
│   ├── avatar-utils.ts             # Deterministic initials/colour (replaces placeholder-images)
│   ├── types.ts                    # TypeScript interfaces matching backend schemas
│   └── utils.ts                    # cn(), getSeverityClassNames()
└── hooks/
    ├── use-mobile.tsx
    └── use-toast.ts
```

### Pages & Routes

| Route | Page | Backend endpoint |
|---|---|---|
| `/overview` | Security overview, app health matrix, anomaly charts | `GET /overview` |
| `/api-monitoring` | API consumption vs limits, abuse detection | `GET /api-monitoring` |
| `/network-traffic` | Bandwidth KPIs, anomaly feed with block actions | `GET /network-traffic` |
| `/endpoint-security` | Wazuh event log, OS distribution, quarantine | `GET /endpoint-security` |
| `/database-monitoring` | DLP events, query ops, kill-query actions | `GET /database-monitoring` |
| `/incidents` | Case management board with playbook buttons | `GET /case-management` |
| `/reports` | Report generation, scheduled reports, downloads | `GET /reports/overview` |
| `/settings` | User access management (Admin), role changes | `GET /api/auth/users` |
| `/profile` | Edit profile, change password, toggle 2FA, sessions | `GET /api/auth/me` |

### API Client

All backend communication flows through `src/lib/api.ts`:

```typescript
// Typed helpers — each accepts an optional AbortSignal
apiGet<T>(endpoint, signal?)       // GET
apiPost<T>(endpoint, body, signal?) // POST
apiPut<T>(endpoint, body, signal?)  // PUT
apiPatch<T>(endpoint, body, signal?) // PATCH
apiDelete<T>(endpoint, signal?)     // DELETE
```

**Automatic behaviours:**
- Attaches `Authorization: Bearer <token>` from `localStorage`
- Appends `?env=<cloud|local>` to every non-auth request
- On HTTP 401: clears token + redirects to `/login`
- Throws `ApiError(status, message)` on non-2xx responses

**Environment switching:** The `EnvironmentContext` stores `cloud | local` in `localStorage` and writes it to every request. The backend uses this to scope all queries to the correct data set.

### State Management

**`AuthContext`** — fetches `/api/auth/me` on mount using the stored JWT. Provides `user`, `setUser`, `isAuthLoading`, `logout` to the entire dashboard tree.

**`EnvironmentContext`** — provides `environment` (`cloud` | `local`) and `setEnvironment`. Every page `useEffect` depends on `environment`, so switching envs re-fetches all data.

**Local component state** — each page manages its own `data`, `loading`, and `error` state with `useState` + `useEffect`. `AbortController` is used in all pages to cancel in-flight requests on unmount or env change.

### Frontend Configuration

| Variable | Description | Required |
|---|---|---|
| `NEXT_PUBLIC_ATLAS_BACKEND_URL` | Backend base URL baked into JS bundle at build time | Yes |

Set in `.env.local` for local dev. Pass as a Docker build ARG for containerised deployments (see Dockerfile).

---

## Getting Started

### Prerequisites

- Docker ≥ 24 and Docker Compose v2
- A running **Wazuh Manager** (v4.x) reachable from the backend container
- Node.js 20+ (local frontend dev only)
- Python 3.12+ (local backend dev only)

### Quick Start (Docker Compose)

```bash
# 1. Clone the repository
git clone <your-repo-url> atlas && cd atlas

# 2. Generate secrets for the backend
python -c "
import secrets
print('SECRET_KEY='        + secrets.token_hex(32))
print('INGEST_API_KEY='    + secrets.token_urlsafe(48))
"

# 3. Configure backend
cp Atlas-back-end/.env.example Atlas-back-end/.env
# Edit .env — fill in all [REQUIRED] fields including Wazuh credentials

# 4. Start all services
docker compose up --build -d

# 5. Run database migrations (first time only)
docker compose exec atlas-backend alembic upgrade head

# 6. Verify backend health
curl http://localhost:8000/health
# → {"status": "healthy", "database": "connected"}

# 7. Open the dashboard
open http://localhost:3000
```

**Default seed accounts** (set passwords in `.env` before first boot):

| Role | Email | Password env var |
|---|---|---|
| Admin | `admin@atlas.local` | `SEED_ADMIN_PASSWORD` |
| Analyst | `analyst@atlas.local` | `SEED_ANALYST_PASSWORD` |
| Read-Only | `audit@atlas.local` | `SEED_READONLY_PASSWORD` |

### Local Backend Dev

```bash
cd Atlas-back-end

# Create virtual environment
python3.12 -m venv .venv && source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env — point DATABASE_URL at a local Postgres instance

# Run Alembic migrations
alembic upgrade head

# Start with hot-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Interactive API docs
open http://localhost:8000/docs
```

### Local Frontend Dev

```bash
cd Atlas-front-end

# Install dependencies
npm install

# Configure
echo "NEXT_PUBLIC_ATLAS_BACKEND_URL=http://localhost:8000" > .env.local

# Start dev server (port 9002)
npm run dev

open http://localhost:9002
```

---

## Environment Variables

### Backend (`.env`)

```bash
# ── Application ───────────────────────────────────────────────
APP_NAME=ATLAS
APP_ENV=development
DEBUG=true

# ── PostgreSQL ────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://atlas_user:PASSWORD@postgres:5432/atlas_db
DATABASE_URL_SYNC=postgresql+psycopg2://atlas_user:PASSWORD@postgres:5432/atlas_db
POSTGRES_USER=atlas_user
POSTGRES_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
POSTGRES_DB=atlas_db

# ── Seed Accounts ─────────────────────────────────────────────
SEED_ADMIN_EMAIL=admin@atlas.local
SEED_ADMIN_PASSWORD=REPLACE_WITH_STRONG_UNIQUE_PASSWORD
SEED_ANALYST_EMAIL=analyst@atlas.local
SEED_ANALYST_PASSWORD=REPLACE_WITH_STRONG_UNIQUE_PASSWORD
SEED_READONLY_EMAIL=audit@atlas.local
SEED_READONLY_PASSWORD=REPLACE_WITH_STRONG_UNIQUE_PASSWORD

# ── Security ──────────────────────────────────────────────────
SECRET_KEY=<generate: python -c "import secrets; print(secrets.token_hex(32))">
ACCESS_TOKEN_EXPIRE_MINUTES=60
INGEST_API_KEY=<generate: python -c "import secrets; print(secrets.token_urlsafe(48))">

# ── Wazuh Manager API ─────────────────────────────────────────
WAZUH_API_URL=https://YOUR_WAZUH_MANAGER_IP:55000
WAZUH_USERNAME=wazuh-wui
WAZUH_PASSWORD=REPLACE_WITH_WAZUH_PASSWORD
WAZUH_VERIFY_SSL=false

# ── Wazuh Indexer ─────────────────────────────────────────────
WAZUH_INDEXER_URL=https://YOUR_WAZUH_INDEXER_IP:9200
WAZUH_INDEXER_USERNAME=admin
WAZUH_INDEXER_PASSWORD=REPLACE_WITH_INDEXER_PASSWORD
WAZUH_INDEXER_VERIFY_SSL=false

# ── CORS ──────────────────────────────────────────────────────
ALLOWED_CORS_ORIGINS=http://localhost:3000

# ── Optional ──────────────────────────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
S3_ENABLED=false
```

### Frontend (`.env.local`)

```bash
NEXT_PUBLIC_ATLAS_BACKEND_URL=http://localhost:8000
```

> **Important:** `NEXT_PUBLIC_` env vars are baked into the JavaScript bundle at **build time** by Next.js. When deploying with Docker, pass the backend URL as a Docker build ARG (`--build-arg NEXT_PUBLIC_ATLAS_BACKEND_URL=https://api.yourcompany.com`).

---

## Security Notes

- **No default secrets** — every required secret field rejects placeholder values at startup
- **Bcrypt hashing** — all passwords hashed with bcrypt; plaintext never stored or logged
- **JWT expiry** — configurable via `ACCESS_TOKEN_EXPIRE_MINUTES` (default 60 min)
- **Immutable audit trail** — every SOC action writes a `MitigationAuditLog` row; the JSONB `details` column is GIN-indexed for forensic queries
- **Non-root containers** — both Docker images run as dedicated least-privilege system users (`atlas` and `nextjs`)
- **CORS** — wildcard `*` only in `DEBUG=true` mode; set `ALLOWED_CORS_ORIGINS` in production
- **Self-lockout prevention** — admins cannot change their own role or revoke their own access
- **Deactivation over deletion** — users are soft-deactivated to preserve session audit history
- **Timing-safe key comparison** — ingest API key verified with `hmac.compare_digest`

---

## Known Issues Fixed

The following bugs were identified and corrected during the frontend audit:

| # | File | Issue | Fix |
|---|---|---|---|
| 1 | `src/lib/api.ts` | `apiGet` accepted `string` only but pages passed `{ signal }` object as second arg — AbortSignal was silently dropped | Added optional `signal?: AbortSignal` parameter to all typed helpers |
| 2 | `overview/page.tsx` | Rendered `data.aiBriefing` — field does not exist in `OverviewData` type or backend schema; always showed fallback string | Removed dead AI briefing card entirely |
| 3 | `database-monitoring/page.tsx` | Called `apiGet('/db-monitoring')` — backend route is `GET /database-monitoring` (404 every time) | Corrected to `apiGet('/database-monitoring')` |
| 4 | `src/lib/placeholder-images.json` | 5 hardcoded Unsplash avatar URLs consumed in `endpoint-security` for Wazuh event employee photos | Deleted; replaced with `src/lib/avatar-utils.ts` — deterministic initials + HSL colour from employee name; backend `WazuhEvent.avatar` URL used when present |
| 5 | `sidebar.tsx` | `Database Monitoring` nav item was commented out, hiding a fully-implemented page | Uncommented and restored |
| 6 | `api-monitoring/page.tsx` | `cost: Number(c.actual) * 0.0001` — hardcoded cost proxy multiplier | Kept as a clearly-labelled estimate (backend `ApiRoute.cost` is available in the routing table; the consumption table doesn't carry per-app cost) |
| 7 | `settings/page.tsx` | `Revoke` button rendered disabled UI — no `onClick` handler calling the backend | Wired to `apiDelete('/api/auth/users/{id}')` with optimistic UI update |
| 8 | `settings/page.tsx` | Invite dialog sent `name: email.split('@')[0]` — derived, low-quality name | Added explicit `name` input field to the dialog |
| 9 | All pages | `useEffect` fetch functions created new `AbortController` but some pages didn't cancel on unmount | Every page now returns `() => controller.abort()` from `useEffect` |
