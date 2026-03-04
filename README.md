# ATLAS — Advanced Traffic Layer Anomaly System

> Enterprise-grade Security Operations Centre (SOC) Dashboard built on a lean, cost-effective stack — **PostgreSQL + Velociraptor** replacing the traditional Elasticsearch + Wazuh toolchain.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [Backend — FastAPI](#5-backend--fastapi)
   - [Database Schema](#51-database-schema)
   - [API Endpoints](#52-api-endpoints)
   - [Authentication & RBAC](#53-authentication--rbac)
   - [Log Ingestion Engine](#54-log-ingestion-engine)
   - [S3 Cold-Storage Ingestion](#55-s3-cold-storage-ingestion)
   - [HTTP Ingest Endpoint](#56-http-ingest-endpoint)
   - [Velociraptor Webhook](#57-velociraptor-webhook)
6. [Frontend — Next.js](#6-frontend--nextjs)
   - [Dashboard Pages](#61-dashboard-pages)
   - [API Client](#62-api-client)
   - [Auth Context](#63-auth-context)
   - [Mitigation Actions](#64-mitigation-actions)
7. [Environment Variables](#7-environment-variables)
8. [Running the Project](#8-running-the-project)
9. [Default Credentials](#9-default-credentials)
10. [Data Flow](#10-data-flow)
11. [Security Design](#11-security-design)
12. [Roadmap — Production Hardening](#12-roadmap--production-hardening)

---

## 1. Project Overview

ATLAS is a full-stack Security Operations Centre dashboard that gives SOC analysts a unified, real-time view of:

- **API traffic anomalies** — cost spikes, rate-limit violations, and abuse patterns
- **Network threats** — active connection anomalies, port scans, and lateral movement
- **Endpoint security** — Velociraptor/Wazuh agent alerts, malware detections, and quarantine actions
- **Database activity** — suspicious query patterns, data-exfiltration indicators, and DLP flags
- **Incident management** — a full incident lifecycle from detection through AI-assisted triage to remediation
- **User access control** — role-based access for Admin, Analyst, and Read-Only personas

The project started as a static React prototype backed by hardcoded mock data and has been completely refactored across three major phases into a production-ready, fully integrated full-stack application.

### What Was Replaced

| Removed (expensive) | Replaced with (lean) |
|---|---|
| Elasticsearch | PostgreSQL 16 with JSONB columns |
| Wazuh SIEM | Velociraptor endpoint agent (webhook-driven) |
| Redis session store | Stateless JWT authentication |
| Hardcoded mock data | Live FastAPI endpoints backed by PostgreSQL |
| Static Next.js API routes | Direct browser → FastAPI communication |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User's Browser                          │
│                                                                 │
│   ┌──────────────────────────────┐                             │
│   │   Next.js Dashboard          │  http://localhost:3000      │
│   │   (React 19 / Tailwind CSS)  │                             │
│   └──────────────┬───────────────┘                             │
│                  │  fetch() calls with JWT Bearer token        │
│                  │  NEXT_PUBLIC_ATLAS_BACKEND_URL              │
└──────────────────┼──────────────────────────────────────────────┘
                   │  http://localhost:8000
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                  FastAPI Backend                                  │
│                  (Python 3.11 / Uvicorn)                         │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ routes.py   │  │ routes_auth  │  │ routes_ingest          │  │
│  │ Dashboard   │  │ JWT / RBAC   │  │ Vector / Fluent Bit    │  │
│  │ endpoints   │  │ User mgmt    │  │ HTTP batch ingest      │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────┐  ┌───────────────────────────────────┐ │
│  │ routes_webhooks      │  │ routes_settings                   │ │
│  │ Velociraptor payloads│  │ Containment rules CRUD            │ │
│  └──────────────────────┘  └───────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Services Layer                                             │ │
│  │  auth_service · log_ingestion · query_service · s3_ingestor│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                       │ asyncpg                                  │
└───────────────────────┼──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│              PostgreSQL 16  (atlas-postgres)                     │
│                                                                  │
│   network_logs · api_logs · endpoint_logs · db_activity_logs    │
│   incidents · alerts · atlas_users · user_sessions              │
│   s3_ingest_cursor                                               │
└──────────────────────────────────────────────────────────────────┘

External Inputs (Hot Path):
  Vector / Fluent Bit  ──POST /api/ingest/http──▶  FastAPI ──▶ PostgreSQL

External Inputs (Cold Path):
  AWS S3 bucket  ──background poll (boto3)──▶  FastAPI ──▶ PostgreSQL

External Inputs (Webhook):
  Velociraptor agent  ──POST /webhooks/velociraptor──▶  FastAPI ──▶ PostgreSQL
```

---

## 3. Technology Stack

### Backend
| Component | Technology | Version |
|---|---|---|
| Web framework | FastAPI | 0.111 |
| ASGI server | Uvicorn | 0.29 |
| Database ORM | SQLAlchemy (async) | 2.0 |
| Database driver | asyncpg | 0.29 |
| Database | PostgreSQL | 16 |
| Migrations | Alembic | 1.13 |
| Authentication | python-jose (JWT) + passlib (bcrypt) | 3.3 / 1.7 |
| Data validation | Pydantic v2 | 2.7 |
| S3 integration | boto3 | 1.34 |
| HTTP client | httpx | 0.27 |

### Frontend
| Component | Technology | Version |
|---|---|---|
| Framework | Next.js | 15 |
| UI library | React | 19 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 3.4 |
| Component library | shadcn/ui + Radix UI | latest |
| Charts | Recharts | 2.15 |
| Form handling | React Hook Form + Zod | 7.x / 3.x |
| AI features | Genkit (Google GenAI) | 1.28 |

### Infrastructure
| Component | Technology |
|---|---|
| Containerisation | Docker + Docker Compose v2 |
| Database | PostgreSQL 16 Alpine |
| Cold storage | AWS S3 (optional) |
| Log shipping | Vector / Fluent Bit (optional) |

---

## 4. Repository Structure

```
Atlas-full-stack/
│
├── docker-compose.yml               ← Unified: postgres + backend + frontend
├── .env                             ← Your secrets (never commit this)
├── .env.example                     ← Template with all required variables
│
├── Atlas-back-end/                  ← FastAPI backend
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py                  ← Lifespan, router registration, CORS
│   │   ├── api/
│   │   │   ├── routes.py            ← All dashboard GET endpoints
│   │   │   ├── routes_auth.py       ← Login, profile, user management
│   │   │   ├── routes_ingest.py     ← POST /api/ingest/http
│   │   │   ├── routes_webhooks.py   ← POST /webhooks/velociraptor
│   │   │   └── routes_settings.py  ← Containment rules CRUD
│   │   ├── core/
│   │   │   ├── config.py            ← Pydantic Settings (reads .env)
│   │   │   ├── database.py          ← Async SQLAlchemy engine + session
│   │   │   └── security.py          ← Ingest API key dependency
│   │   ├── models/
│   │   │   ├── db_models.py         ← All SQLAlchemy ORM table definitions
│   │   │   └── schemas.py           ← Pydantic response/request schemas
│   │   └── services/
│   │       ├── auth_service.py      ← JWT, bcrypt, seed, session logging
│   │       ├── log_ingestion.py     ← JSONL file parser → PostgreSQL
│   │       ├── query_service.py     ← All DB queries for dashboard endpoints
│   │       └── s3_ingestor.py       ← Background S3 polling task
│   ├── data/
│   │   └── logs/                    ← Sample JSONL log files for development
│   └── config/
│       └── vector.toml              ← Production Vector pipeline config
│
└── Atlas-front-end/                 ← Next.js frontend
    ├── Dockerfile                   ← Multi-stage build (fixed)
    ├── next.config.ts               ← standalone output enabled
    ├── .env.local                   ← NEXT_PUBLIC_ATLAS_BACKEND_URL
    └── src/
        ├── app/
        │   ├── (auth)/
        │   │   ├── login/page.tsx   ← JWT login form
        │   │   ├── signup/page.tsx
        │   │   └── forgot-password/page.tsx
        │   └── (dashboard)/
        │       ├── layout.tsx       ← Auth guard + provider tree
        │       ├── overview/        ← KPI cards, microservice topology, charts
        │       ├── api-monitoring/  ← Usage charts, routing/abuse table
        │       ├── network-traffic/ ← Bandwidth, anomaly table, traffic map
        │       ├── endpoint-security/ ← Wazuh events, OS/alert pie charts
        │       ├── database-monitoring/ ← Query charts, DLP suspicious activity
        │       ├── incidents/       ← Incident table + AI investigator sheet
        │       ├── profile/         ← Live profile edit, password change, sessions
        │       ├── settings/        ← System config + live user management
        │       └── reports/
        ├── context/
        │   ├── AuthContext.tsx      ← Current user state, /api/auth/me fetch
        │   └── EnvironmentContext.tsx ← Cloud/Local environment switcher
        ├── lib/
        │   ├── api.ts               ← Centralised API client (JWT, 401 guard)
        │   └── types.ts             ← All shared TypeScript interfaces
        ├── components/
        │   ├── dashboard/
        │   │   ├── header.tsx       ← User dropdown, notifications, env switcher
        │   │   ├── sidebar.tsx      ← Navigation
        │   │   ├── ai-copilot-widget.tsx
        │   │   └── dashboard-providers.tsx ← AuthProvider + EnvironmentProvider
        │   └── ui/                  ← shadcn/ui component library
        ├── hooks/
        │   └── use-toast.ts
        └── ai/
            └── flows/               ← Genkit AI flows (briefing, investigator)
```

---

## 5. Backend — FastAPI

### 5.1 Database Schema

All tables are created automatically by SQLAlchemy on startup. Every log table carries a `raw_payload JSONB` column that stores the original log verbatim alongside the structured indexed columns, enabling both fast SQL queries and flexible ad-hoc `@>` containment searches.

| Table | Purpose |
|---|---|
| `network_logs` | Raw network traffic events: source/dest IP, port, protocol, anomaly type |
| `api_logs` | API request logs: route, method, latency, cost, action taken |
| `endpoint_logs` | Velociraptor/Wazuh endpoint events: workstation ID, employee, alert, severity |
| `db_activity_logs` | Database query events: app, user, query type, target table, DLP flags |
| `incidents` | Full incident records: severity, status, source/dest, event details |
| `alerts` | Recent alert feed shown in the header notification bell |
| `atlas_users` | Platform users: email, bcrypt password, role, TOTP flag, phone, avatar |
| `user_sessions` | Login audit trail: IP address, device/user-agent, success or failure |
| `s3_ingest_cursor` | Idempotency ledger for the S3 cold-storage background task |

All log tables have an `env` column (`cloud` or `local`) that maps to the Environment Switcher in the dashboard header, allowing the same database to serve both cloud and on-premises deployment contexts simultaneously.

### 5.2 API Endpoints

All endpoints are documented interactively at `http://localhost:8000/docs`.

#### Dashboard Endpoints
| Method | Path | Description |
|---|---|---|
| `GET` | `/overview` | KPI cards, microservice topology, anomaly charts |
| `GET` | `/api-monitoring` | API usage stats, routing/abuse table |
| `GET` | `/network-traffic` | Bandwidth, active connections, anomaly table |
| `GET` | `/endpoint-security` | Monitored devices, OS/alert charts, Wazuh events |
| `GET` | `/db-monitoring` | Connection stats, operations chart, suspicious activity |
| `GET` | `/incidents` | Paginated incident list (filterable by env) |
| `POST` | `/incidents/remediate` | Block IP, isolate endpoint, or dismiss an incident |
| `POST` | `/endpoint-security/quarantine` | Quarantine a device by workstation ID |
| `GET` | `/header-data` | Current user, recent alerts, app list for the header |
| `GET` | `/users` | Application list for the environment context selector |
| `GET` | `/health` | Liveness probe for Docker healthcheck |

All dashboard `GET` endpoints accept an `?env=cloud` or `?env=local` query parameter that scopes the query to the correct data partition.

#### Authentication Endpoints (`/api/auth/`)
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | None | Validate credentials, return JWT + user profile |
| `GET` | `/api/auth/me` | Bearer | Get the current user's full profile |
| `PUT` | `/api/auth/me` | Bearer | Update name, email, phone, or avatar |
| `POST` | `/api/auth/change-password` | Bearer | Change password (requires current password) |
| `PATCH` | `/api/auth/2fa` | Bearer | Enable or disable TOTP two-factor authentication |
| `GET` | `/api/auth/sessions` | Bearer | Last 10 login attempts (profile page activity table) |
| `GET` | `/api/auth/users` | Admin | List all platform users |
| `POST` | `/api/auth/users/invite` | Admin | Create a new user with a temporary password |
| `PUT` | `/api/auth/users/{id}/role` | Admin | Change a user's role |
| `DELETE` | `/api/auth/users/{id}` | Admin | Deactivate a user account (non-destructive) |

#### Ingest & Webhook Endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/ingest/http` | API Key header | Batch log ingest from Vector / Fluent Bit |
| `POST` | `/webhooks/velociraptor` | HMAC signature | Live endpoint alerts from Velociraptor agent |

#### Settings Endpoints (`/settings/`)
| Method | Path | Description |
|---|---|---|
| `GET` | `/settings/containment-rules` | List all progressive containment rules |
| `GET` | `/settings/containment-rules/{id}` | Get a single rule |
| `POST` | `/settings/containment-rules` | Create a new rule |
| `PATCH` | `/settings/containment-rules/{id}` | Update a rule |
| `DELETE` | `/settings/containment-rules/{id}` | Delete a rule |

### 5.3 Authentication & RBAC

Authentication is stateless JWT. There is no session store — all state lives in the signed token payload.

**Token flow:**
1. User submits email + password to `POST /api/auth/login`
2. Backend verifies the bcrypt hash with `passlib`
3. Backend mints a signed JWT (via `python-jose`) containing `{ sub: email, role: role }`
4. Token is returned in the response body and stored in the browser's `localStorage`
5. Every subsequent request attaches the token as `Authorization: Bearer <token>`
6. FastAPI's `get_current_user` dependency validates the token and resolves the `AtlasUser` row on every request

**Roles:**

| Role | Permissions |
|---|---|
| `Admin` | Full access — all dashboard views, all mitigation actions, user management, settings writes |
| `Analyst` | All dashboard views, quarantine devices, remediate incidents — cannot manage users or change system settings |
| `Read-Only` | View all dashboards only — all write and mitigation buttons are disabled in the UI |

Every login attempt (success or failure) is written to the `user_sessions` table. The profile page surfaces the last 10 sessions with IP address, device/user-agent string, and result.

**Seed accounts** are created automatically on first boot if no users exist:

| Email | Password | Role |
|---|---|---|
| `admin@atlas.local` | `AtlasAdmin1!` | Admin |
| `analyst@atlas.local` | `Analyst123!` | Analyst |
| `audit@firm.com` | `ReadOnly123!` | Read-Only |

### 5.4 Log Ingestion Engine

The file-based ingestion service (`services/log_ingestion.py`) is the MVP's primary data source. On startup (when `REINGEST_ON_STARTUP=true`), it scans the `data/logs/` directory for JSONL files and parses them into the appropriate PostgreSQL tables.

**Expected file naming and format:**
```
data/logs/
├── network/        → network_logs table
├── api/            → api_logs table
├── endpoint/       → endpoint_logs table
├── db/             → db_activity_logs table
├── incidents/      → incidents table
└── alerts/         → alerts table
```

Each file is a newline-delimited JSON file where each line is one log record. The parser uses a `log_type` field on each record to route it to the correct table and calls the appropriate `_parse_*` function for structured column extraction.

**Per-record error handling:** a malformed record is counted and skipped — it never aborts the entire file parse. The ingest statistics (accepted/rejected counts) are logged at startup.

### 5.5 S3 Cold-Storage Ingestion

An optional background asyncio task (`services/s3_ingestor.py`) polls an AWS S3 bucket on a configurable interval (default 300 seconds) and ingests compressed log archives.

**Activation:** set `S3_ENABLED=true` in `.env` and provide AWS credentials (or use an IAM role in production).

**Expected S3 key pattern:**
```
logs/{log_type}/{YYYY}/{MM}/{DD}/{HH}-{mm}-{ss}.jsonl.gz
```

The task downloads, decompresses (gzip), and parses each object using the same `_parse_*` functions as the file-based ingestion. After successful ingest, it records the object's key and ETag in the `s3_ingest_cursor` table. On the next poll, any key already in this table is skipped — making the task fully idempotent and safe to restart at any time without double-counting records.

Boto3 calls are wrapped in `asyncio.to_thread()` to avoid blocking the event loop.

### 5.6 HTTP Ingest Endpoint

`POST /api/ingest/http` accepts batched log records in real time from log shippers like Vector or Fluent Bit. It is the "hot path" for live production environments.

**Authentication:** a static API key passed in a configurable header (`X-Atlas-API-Key` by default). Key validation uses `hmac.compare_digest` to prevent timing-attack enumeration.

**Payload format — bare array:**
```json
[
  { "log_type": "network", "env": "cloud", "source_ip": "10.0.1.5", ... },
  { "log_type": "api",     "env": "cloud", "path": "/v1/payment", ... }
]
```

**Payload format — wrapped object:**
```json
{ "logs": [ { "log_type": "network", ... } ] }
```

Supported `log_type` values: `network`, `api`, `endpoint`, `db`, `incident`, `alert`.

**Response:**
```json
{ "accepted": 42, "rejected": 1, "batch_size": 43, "source": "vector", "errors": ["..."] }
```

Hard batch cap: 5000 records per request (configurable via `INGEST_MAX_BATCH_SIZE`).

A production-ready Vector pipeline configuration is provided in `config/vector.toml`. It defines sources (log files, syslog UDP, forwarded Vector events), enrichment transforms, and two sinks — the hot path (`/api/ingest/http`) and the cold path (AWS S3 with gzip, STANDARD_IA storage class, and AES256 encryption).

### 5.7 Velociraptor Webhook

`POST /webhooks/velociraptor` receives live endpoint telemetry from a Velociraptor server. Payloads are HMAC-SHA256 verified against the `VELOCIRAPTOR_WEBHOOK_SECRET` environment variable before processing.

A detailed production guide for setting up a live Velociraptor server, configuring it to send webhook alerts, and transitioning from local log files to a live Kafka queue is documented in `FUTURE_IMPLEMENTATION.md` in the backend folder.

---

## 6. Frontend — Next.js

### 6.1 Dashboard Pages

Every page follows the same data-fetching pattern: `useState` + `useEffect` with an `isLoading` flag, skeleton loading states while data is in flight, and a destructive toast notification on error. No mock data exists anywhere in the codebase — all data comes from FastAPI.

| Page | Route | Data Source | Actions |
|---|---|---|---|
| Overview | `/overview` | `GET /overview` | Read-only — AI daily threat briefing generated via Genkit |
| API Monitoring | `/api-monitoring` | `GET /api-monitoring` | Read-only — usage chart + routing/abuse table |
| Network Traffic | `/network-traffic` | `GET /network-traffic` | Read-only — anomaly table + traffic flow diagram |
| Endpoint Security | `/endpoint-security` | `GET /endpoint-security` | **Quarantine Device** → `POST /endpoint-security/quarantine` |
| Database Monitoring | `/database-monitoring` | `GET /db-monitoring` | Read-only — operations chart + DLP table |
| Incidents | `/incidents` | `GET /incidents` | **Block IP / Isolate / Dismiss** → `POST /incidents/remediate` |
| Profile | `/profile` | `GET /api/auth/me` + `GET /api/auth/sessions` | Save profile, change password, toggle 2FA |
| Settings | `/settings` | `GET /api/auth/users` (user-access tab) | Invite users, change roles, revoke access |
| Reports | `/reports` | — | Static layout |

### 6.2 API Client

`src/lib/api.ts` is the single source of truth for all backend communication. It replaces ad-hoc `fetch()` calls scattered across components.

**Key behaviours:**

- **Automatic JWT attachment** — reads `atlas_auth_token` from `localStorage` and sets `Authorization: Bearer <token>` on every request
- **Global 401 handler** — if any response returns HTTP 401, the token is cleared from `localStorage` and the browser is redirected to `/login` immediately, preventing components from trying to render stale data
- **Typed helpers** — `apiGet<T>`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete` all parse the JSON response body and throw a typed `ApiError` (with the HTTP status code attached) on non-OK responses, so component error handlers always have a useful message to surface in a toast

```typescript
// Typed GET — throws ApiError on non-200
const data = await apiGet<OverviewData>('/overview?env=cloud');

// POST with body
await apiPost('/endpoint-security/quarantine', { workstationId: 'WS-042' });

// DELETE
await apiDelete(`/api/auth/users/${userId}`);
```

### 6.3 Auth Context

`src/context/AuthContext.tsx` provides the authenticated user's full profile to every component in the dashboard tree without prop-drilling.

On mount it calls `GET /api/auth/me`. If the token is valid, the `user` object (id, name, email, role, totp_enabled, etc.) is stored in context. If the token is missing or expired, `apiFetch` handles the redirect before the context even resolves.

The `setUser` function is exposed so that the Profile page can update the globally displayed name/email/avatar immediately after saving, without requiring a page reload.

**Auth guard in the dashboard layout** (`layout.tsx`) performs a fast local check — if `localStorage` has no token at all, it calls `router.replace('/login')` before any dashboard API calls fire, preventing a flash of unauthenticated content.

### 6.4 Mitigation Actions

All destructive action buttons are wired to real API calls. Every button follows the same pattern:

1. Button click triggers an async handler
2. A `LoaderCircle` spinner replaces the button label while the request is in-flight
3. The button is `disabled` during the request to prevent double-submits
4. On success — a `toast` notification confirms the action to the analyst
5. On failure — a destructive `toast` shows the exact error message returned by the backend
6. The local component state is updated optimistically where appropriate (e.g. the deactivated user row dims in place without a full re-fetch)

| Button | Endpoint | Effect |
|---|---|---|
| Quarantine Device | `POST /endpoint-security/quarantine` | Sends workstation ID to backend for isolation |
| Block IP | `POST /incidents/remediate` `{ action: "Block IP" }` | Logs the block action against the incident |
| Isolate Endpoint | `POST /incidents/remediate` `{ action: "Isolate Endpoint" }` | Triggers endpoint isolation |
| Dismiss Incident | `POST /incidents/remediate` `{ action: "Dismiss" }` | Marks incident as closed |
| Revoke Access | `DELETE /api/auth/users/{id}` | Deactivates the user account immediately |
| Change Role | `PUT /api/auth/users/{id}/role` | Updates role inline with a dropdown |
| Add New User | `POST /api/auth/users/invite` | Opens a modal, creates account on submit |
| Save Profile | `PUT /api/auth/me` | Updates name, email, phone in the database |
| Update Password | `POST /api/auth/change-password` | Validates current password before replacing |
| Toggle 2FA | `PATCH /api/auth/2fa` | Flips the TOTP enabled flag |

---

## 7. Environment Variables

All configuration is managed through a single `.env` file in the `Atlas-full-stack/` root. Copy `.env.example` to `.env` before first run.

### Backend Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | *(required)* | Async PostgreSQL URL — `postgresql+asyncpg://user:pass@host/db` |
| `DATABASE_URL_SYNC` | *(required)* | Sync URL for Alembic migrations — `postgresql+psycopg2://...` |
| `SECRET_KEY` | *(required)* | Long random hex string for JWT signing. Generate with `secrets.token_hex(32)` |
| `ALGORITHM` | `HS256` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | JWT lifetime in minutes |
| `APP_ENV` | `development` | Application environment label |
| `DEBUG` | `false` | Enable verbose SQL and request logging |
| `REINGEST_ON_STARTUP` | `true` | Parse JSONL files from `data/logs/` on every startup |
| `LOG_DATA_DIR` | `data/logs` | Path to the local log files directory |
| `INGEST_API_KEY` | *(required)* | Static API key for the `/api/ingest/http` endpoint |
| `INGEST_API_KEY_HEADER` | `X-Atlas-API-Key` | Header name for the ingest key |
| `INGEST_MAX_BATCH_SIZE` | `5000` | Maximum records per ingest POST |
| `VELOCIRAPTOR_WEBHOOK_SECRET` | *(required)* | HMAC secret for verifying Velociraptor payloads |
| `S3_ENABLED` | `false` | Enable the S3 cold-storage background task |
| `AWS_ACCESS_KEY_ID` | *(optional)* | Leave blank to use IAM role in production |
| `AWS_SECRET_ACCESS_KEY` | *(optional)* | Leave blank to use IAM role in production |
| `AWS_REGION` | `us-east-1` | AWS region for the S3 bucket |
| `S3_LOG_BUCKET` | `atlas-soc-cold-logs` | S3 bucket name |
| `S3_LOG_PREFIX` | `logs/` | Key prefix to filter which objects are ingested |
| `S3_POLL_INTERVAL_SECONDS` | `300` | How often the S3 task polls for new objects |
| `S3_MAX_KEYS_PER_POLL` | `50` | Maximum S3 objects processed per poll cycle |

### Frontend Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_ATLAS_BACKEND_URL` | The URL the **browser** uses to reach the FastAPI backend. Baked into the JS bundle at build time. Default: `http://localhost:8000` |

> `NEXT_PUBLIC_` prefix is mandatory — Next.js only exposes environment variables with this prefix to client-side code. This value must be set as a Docker build `ARG` (already configured in the Dockerfile and `docker-compose.yml`).

---

## 8. Running the Project

### Prerequisites

- Docker Desktop 24+ (Mac / Windows) or Docker Engine + Compose plugin (Linux)
- Verify: `docker --version` and `docker compose version`

### First-Time Setup

```bash
# 1. Navigate to the root folder
cd Atlas-full-stack

# 2. Create your environment file
cp .env.example .env
# Open .env and set SECRET_KEY, INGEST_API_KEY, VELOCIRAPTOR_WEBHOOK_SECRET

# 3. Build and start all three services
docker compose up --build
```

First build downloads all dependencies — expect 8–12 minutes. Subsequent starts use the Docker cache and take under 30 seconds.

### Accessing the Application

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| Swagger API Docs | http://localhost:8000/docs |
| OpenAPI JSON | http://localhost:8000/openapi.json |
| Health Check | http://localhost:8000/health |

### Common Commands

```bash
# Start in background (after first build)
docker compose up -d

# Watch logs from all services
docker compose logs -f

# Watch logs from one service
docker compose logs -f atlas-backend

# Stop everything (data preserved)
docker compose down

# Full reset — stops everything and deletes the database volume
docker compose down -v

# Rebuild after editing backend Python code
docker compose up --build atlas-backend

# Rebuild after editing frontend TypeScript code
docker compose up --build atlas-frontend
```

---

## 9. Default Credentials

Three accounts are seeded automatically on first boot. The seed runs only once — if any users exist in the database, the seed is skipped entirely.

| Email | Password | Role | What They Can Do |
|---|---|---|---|
| `admin@atlas.local` | `AtlasAdmin1!` | Admin | Everything — including adding/removing users and editing system settings |
| `analyst@atlas.local` | `Analyst123!` | Analyst | All dashboards, quarantine devices, remediate incidents |
| `audit@firm.com` | `ReadOnly123!` | Read-Only | View all dashboards, no write or action buttons |

> ⚠️ Change all default passwords immediately after first login in any environment that is not strictly local development.

---

## 10. Data Flow

### Development (Local Log Files)

```
data/logs/*.jsonl
       │
       │  On startup (REINGEST_ON_STARTUP=true)
       ▼
log_ingestion.py
       │
       │  _parse_network() / _parse_api() / _parse_endpoint() / etc.
       ▼
PostgreSQL tables
       │
       │  SQLAlchemy async queries
       ▼
FastAPI endpoints  →  JSON response  →  React components
```

### Production (Live Ingest — Hot Path)

```
Firewall / App servers
       │
       │  Raw logs written to /var/log/atlas/
       ▼
Vector (log shipper)
       │
       │  POST /api/ingest/http
       │  Header: X-Atlas-API-Key: <token>
       │  Body: [{ "log_type": "network", ... }, ...]
       ▼
routes_ingest.py  →  _parse_*()  →  PostgreSQL
```

### Production (Cold Path — S3 Archive Replay)

```
Vector S3 sink  →  AWS S3 bucket (gzip JSONL)
                          │
                          │  Background task polls every 5 minutes
                          ▼
                   s3_ingestor.py
                          │
                          │  Download → decompress → parse → insert
                          ▼
                   PostgreSQL  +  s3_ingest_cursor (idempotency)
```

### Authentication Flow

```
Browser: POST /api/auth/login { email, password }
       │
       ▼
FastAPI: bcrypt.verify(password, hashed_password)
       │
       ├── ✗ Invalid  →  HTTP 401  +  log failed attempt to user_sessions
       │
       └── ✓ Valid    →  jwt.encode({ sub: email, role: role, exp: now+60m })
                               │
                               ▼
                    HTTP 200 { access_token, user: {...} }
                               │
                               ▼
                    Browser: localStorage.setItem('atlas_auth_token', token)
                               │
                               ▼
                    All subsequent requests:
                    Authorization: Bearer <token>
                               │
                               ▼
                    FastAPI Depends(get_current_user):
                    jwt.decode()  →  SELECT * FROM atlas_users WHERE email = sub
```

---

## 11. Security Design

### Authentication
- Passwords hashed with bcrypt (cost factor 12 via passlib). Plain text is never logged or stored anywhere
- JWTs signed with HS256 and a configurable secret key. Tokens expire after 60 minutes by default
- The `get_current_user` FastAPI dependency validates every protected request — there is no way to reach a protected endpoint without a valid, non-expired token
- Deactivated users (`is_active=false`) are rejected even if their token has not yet expired

### API Key Security
- The ingest endpoint API key is validated with `hmac.compare_digest`, which takes constant time regardless of where the strings differ, preventing timing-based enumeration attacks
- The Velociraptor webhook uses HMAC-SHA256 payload signature verification

### RBAC
- Role is embedded in the JWT payload and verified on every admin-gated endpoint via the `require_admin` dependency
- Non-admin users receive HTTP 403 — the error does not reveal what the endpoint does

### Audit Trail
- Every login attempt (success or failure) is recorded in `user_sessions` with IP address, user-agent, and timestamp
- User deletions are soft-deletes (`is_active=false`) to preserve the audit history — rows are never dropped

### Production Recommendations
- Replace `SECRET_KEY` with a randomly generated 256-bit value and rotate it periodically
- Run PostgreSQL without an exposed host port (the `docker-compose.yml` uses `expose:` not `ports:` for postgres)
- Add HTTPS termination via a reverse proxy (nginx or Caddy) in front of both the frontend and backend
- Store `.env` in a secrets manager (AWS Secrets Manager, HashiCorp Vault) rather than on disk

---

## 12. Roadmap — Production Hardening

The following items are documented and stubbed but not yet implemented in the MVP. Refer to `FUTURE_IMPLEMENTATION.md` for detailed guides.

| Item | Status | Notes |
|---|---|---|
| Live Velociraptor server | Stub only | `FUTURE_IMPLEMENTATION.md` covers full setup |
| Live Kafka / Syslog stream | Stub only | Replace `log_ingestion.py` with `aiokafka` consumer |
| Alembic database migrations | Schema exists | Run `alembic revision --autogenerate` to generate migration files |
| JWT refresh tokens | Not implemented | Add a short-lived access token + long-lived refresh token pair |
| Token revocation denylist | Not implemented | Redis-backed denylist for logout invalidation |
| Full TOTP 2FA flow | Flag only | Add `pyotp` + QR code generation to `/api/auth/2fa` |
| Rate limiting on ingest | Not implemented | Add `slowapi` middleware to `routes_ingest.py` |
| S3 streaming decompression | Not implemented | Required for objects larger than 500 MB |
| ML anomaly baseline engine | Removed from MVP | Was `scikit-learn` — re-add as a separate async worker |
| Prometheus metrics | Stub import | Vector exposes metrics on `:9598/metrics` |
| Genkit AI Copilot | Integrated | Requires `GOOGLE_GENAI_API_KEY` environment variable |

---

*ATLAS is an internal security tooling project. Do not expose this application to the public internet without first implementing HTTPS, rate limiting, and a proper secrets management strategy.*
