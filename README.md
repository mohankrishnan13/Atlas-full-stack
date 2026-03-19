# ATLAS — Original Codebase Summary

> **Snapshot of the codebase as uploaded, before any refactoring.**

---

## What ATLAS Was

ATLAS (Advanced Traffic Layer Anomaly System) was built as a **full-scope SIEM (Security Information and Event Management)** dashboard. It attempted to monitor every layer of a microservices stack simultaneously — API consumption, database activity, network traffic, endpoint telemetry, and scheduled reporting — from a single application. Over time this led to significant scope creep, with the system trying to be a generic monitoring platform rather than a focused security tool.

---

## Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS (dark theme throughout) |
| UI Components | shadcn/ui + Radix UI primitives |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
| AI Flows | Google Genkit + Gemini 2.5 Flash |
| Toast Notifications | Sonner |

### Backend
| Layer | Technology |
|---|---|
| Framework | FastAPI 0.111 + Uvicorn |
| Language | Python 3.11 |
| Database | PostgreSQL (asyncpg driver) |
| ORM | SQLAlchemy 2.0 (async) |
| Migrations | Alembic (defined but not actively used — `init_db.py` used instead) |
| Data Processing | Pandas + NumPy (hot-path dashboard queries) |
| Auth | JWT (python-jose) + bcrypt password hashing |
| HTTP Client | httpx (async) + requests (sync Wazuh poller) |
| Cold Storage | AWS S3 (boto3, optional) |
| Log Shipping | Vector.dev (config provided) |

---

## Frontend — Original Structure

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx           ← public self-signup (security anti-pattern)
│   │   └── forgot-password/page.tsx
│   ├── (dashboard)/
│   │   ├── overview/page.tsx         ← bloated generic overview
│   │   ├── api-monitoring/page.tsx   ← API cost/rate monitoring
│   │   ├── network-traffic/page.tsx
│   │   ├── endpoint-security/page.tsx
│   │   ├── database-monitoring/page.tsx
│   │   ├── incidents/page.tsx
│   │   ├── case-management/page.tsx  ← duplicate/dead route
│   │   ├── reports/page.tsx
│   │   ├── settings/page.tsx
│   │   └── profile/page.tsx
│   └── api/copilot/route.ts          ← Genkit AI copilot endpoint
├── components/
│   ├── charts/DefensiveChart.tsx     ← unused, never imported
│   └── dashboard/
│       ├── sidebar.tsx               ← 7 nav items including API Monitoring,
│       │                               Database Monitoring, Reports
│       ├── header.tsx
│       └── ai-copilot-widget.tsx
└── lib/
    ├── api.ts                        ← centralised fetch client
    ├── types.ts
    ├── utils.ts
    ├── placeholder-images.ts         ← unused
    └── placeholder-images.json      ← unused
```

### Frontend Problems
- **Inline hardcoded data** — every dashboard page (`overview`, `api-monitoring`, `database-monitoring`, `incidents`) had mock arrays and objects defined directly inside component files.
- **No centralised mock data file** — mock data was scattered across 6+ page files with no single source of truth.
- **`apiGet`/`apiPost` called directly** from each page — no abstraction layer between components and the HTTP client.
- **`case-management/page.tsx`** was a dead, unreachable route. The sidebar linked to `/incidents`, not `/case-management`.
- **`DefensiveChart.tsx`**, `placeholder-images.ts`, and `placeholder-images.json` were completely unused — zero imports anywhere in the codebase.
- **`signup/page.tsx`** — public self-registration on a SOC tool is a security anti-pattern. Admin invite flow already existed in the backend.
- **Sidebar listed 7 nav items** including "API Monitoring", "Database Monitoring", and "Reports" — all contributing to the scope creep.
- **`header.tsx`** called `apiGet('/header-data')` directly, bypassing any future mock bypass layer.
- **`THREAT_PULSE_DATA`** and **`AI_EXPLANATIONS`** were hardcoded inline in `overview/page.tsx`.

---

## Backend — Original Structure

```
app/
├── api/
│   ├── routes_auth.py         ← JWT login, user management, 2FA, sessions
│   ├── routes_dashboard.py    ← 8 read-only endpoints
│   ├── routes_actions.py      ← 6 write (mitigation) endpoints
│   └── routes_settings.py     ← AppConfig CRUD + quarantine ledger
├── models/
│   ├── db_models.py           ← 14 SQLAlchemy ORM models
│   └── schemas.py             ← Pydantic response/request schemas
├── services/
│   ├── auth_service.py
│   ├── wazuh_service.py       ← Wazuh Indexer poller (background task)
│   ├── log_ingestion.py       ← bulk JSONL/CSV ingest on startup
│   ├── s3_ingestor.py         ← S3 cold-storage polling task
│   ├── cache.py
│   ├── constants.py           ← hardcoded mock data seeds (RNG seeds, fake IPs)
│   ├── connectors/
│   │   ├── wazuh_client.py    ← async Wazuh Manager REST client
│   │   └── log_loader.py      ← Pandas CSV loader (warm cache)
│   └── query/
│       ├── overview_service.py
│       ├── api_service.py     ← Pandas-heavy API monitoring queries
│       ├── network_service.py ← Pandas DataFrame queries
│       ├── endpoint_service.py
│       ├── db_service.py      ← Pandas-heavy DB monitoring queries
│       └── reports_service.py ← incidents + app config + quarantine + reports
├── core/
│   ├── config.py              ← pydantic-settings (reads .env)
│   ├── database.py            ← async SQLAlchemy engine + session factory
│   ├── security.py            ← JWT encode/decode
│   └── wazuh_client.py        ← WazuhActions (active response commands)
├── main.py
config/
└── vector.toml                ← Vector.dev log shipping config
init_db.py                     ← creates all tables via metadata.create_all
```

### Database Models (14 total)

| Model | Purpose |
|---|---|
| `AtlasUser` | Platform users — login, RBAC, MFA, profile |
| `UserSession` | Login session audit log |
| `EndpointLog` | Wazuh endpoint events (malware, policy violations) |
| `NetworkLog` | Network anomaly/IDS events |
| `ApiLog` | API call telemetry — rate, latency, cost |
| `DbActivityLog` | Database operation audit (SELECT/INSERT/UPDATE/DELETE) |
| `Alert` | Bell-notification aggregated alerts |
| `Incident` | Security incident cases |
| `Application` | Registered protected applications |
| `Microservice` | Topology diagram nodes |
| `AppConfig` | Per-application security tuning parameters |
| `QuarantinedEndpoint` | Active quarantine ledger |
| `ScheduledReport` | Recurring report job definitions |
| `ReportDownload` | Generated report download manifest |
| `MitigationAuditLog` | Immutable analyst action audit trail |
| `S3IngestCursor` | Idempotency ledger for S3 polling |

### Dashboard API Routes (Original)

| Method | Route | Domain |
|---|---|---|
| GET | `/header-data` | Header bar |
| GET | `/users` | User list |
| GET | `/overview` | Generic KPI overview |
| GET | `/endpoint-security` | Wazuh endpoint data |
| GET | `/network-traffic` | Network anomaly feed |
| GET | `/api-monitoring` | API cost/rate monitoring |
| GET | `/database-monitoring` | DB operation monitoring |
| GET | `/incidents` | Incident list |
| GET | `/case-management` | Case board with MTTR |
| GET | `/reports/overview` | Scheduled reports + downloads |
| POST | `/api-monitoring/block-route` | Block API route |
| POST | `/network-traffic/block` | Block source IP |
| POST | `/endpoint-security/quarantine` | Quarantine device via Wazuh |
| POST | `/settings/apps/{id}/quarantine/lift` | Lift quarantine |
| POST | `/db-monitoring/kill-query` | Kill DB query |
| POST | `/incidents/remediate` | Remediate incident |
| POST | `/reports/generate` | Generate on-demand report |

### Backend Problems
- **Velociraptor integration** — referenced in `requirements.txt` comments, `.env.example`, and `config.py` (`VELOCIRAPTOR_WEBHOOK_SECRET` was a required field that blocked startup if not set to a non-placeholder value) despite Velociraptor not being the active EDR.
- **Pandas on the hot path** — `api_service.py`, `db_service.py`, `network_service.py`, and `overview_service.py` all loaded Pandas DataFrames from CSV files at startup and performed `groupby`, `sort_values`, and `merge` operations on every dashboard request.
- **`constants.py`** contained NumPy RNG seeds (`RNG_SEED_SEVERITY = 42`) and fake IP lists (`SUSPICIOUS_IPS`, `INTERNAL_IPS`) — mock data generation mixed with real constants.
- **`log_loader.py`** — a Pandas warm-cache layer that loaded Loghub CSV datasets at startup to power API and DB monitoring pages. Purely mock data dressed up as a data pipeline.
- **`reports_service.py`** was one overloaded module handling 9 completely unrelated functions: incidents, MTTR computation, app config CRUD, quarantine management, report scheduling, and report generation.
- **`AppConfigRow` type annotation bug** — `reports_service.py` referenced a type `AppConfigRow` that never existed; the ORM class was always `AppConfig`.
- **`routes_actions.py`** had a `incident.target_identifier` attribute bug — this column exists on `MitigationAuditLog`, not `Incident`.
- **No anomaly detection engine** — despite being an "anomaly system", there was no background statistical analysis of the data being collected.
- **Alembic listed as a dependency** and referenced in `.env.example` (`DATABASE_URL_SYNC`) but never used — table creation was handled by `init_db.py` exclusively.

### Data Flow (Original)

```
Wazuh Indexer ──→ wazuh_service.WazuhCollector ──→ EndpointLog (PostgreSQL)
                                                          │
Loghub CSV files ──→ log_loader.py (Pandas cache) ─────→ Dashboard routes
                                                          │
S3 Bucket ──→ s3_ingestor.py ──────────────────────────→ (various tables)
```

The dashboard was split between two data sources: **live PostgreSQL** (endpoint data) and **Pandas CSV** (API, network, DB data) — a hybrid that made the data unreliable and the code complex.
