# ATLAS — Refactored Codebase Summary

> **State of the codebase after all refactoring phases.**

---

## What ATLAS Is Now

ATLAS is a focused **Anomaly Command Center** — a SOC dashboard built exclusively around **Wazuh** (endpoint telemetry) and **Zeek** (network telemetry, routed through Wazuh). It detects, surfaces, and lets analysts act on real threats from these two sources. Every other monitoring domain has been removed. The dashboard has one job: show what Wazuh and Zeek are seeing, and let analysts respond immediately.

---

## Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS (dark theme, `slate-900/950` palette) |
| UI Components | shadcn/ui + Radix UI primitives |
| Charts | Recharts (AreaChart for Threat Pulse, BarChart for endpoint distributions) |
| Forms | React Hook Form + Zod |
| AI Flows | Google Genkit + Gemini 2.5 Flash (Copilot widget) |
| API Layer | Centralised `apiClient.ts` with mock-bypass pattern |

### Backend
| Layer | Technology |
|---|---|
| Framework | FastAPI + Uvicorn |
| Language | Python 3.11 |
| Database | PostgreSQL (asyncpg driver) |
| ORM | SQLAlchemy 2.0 (async, typed `Mapped` columns) |
| Table Creation | `init_db.py` — `metadata.create_all` (no Alembic) |
| Auth | JWT (python-jose) + bcrypt |
| HTTP Client | httpx (async Wazuh API) + requests (Wazuh Indexer sync poller) |
| Anomaly Engine | Pure Python statistics — zero ML dependencies |
| Cold Storage | AWS S3 (boto3, optional, `S3_ENABLED=false` by default) |

---

## Frontend — Refactored Structure

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── forgot-password/page.tsx      ← signup removed (admin-invite only)
│   ├── (dashboard)/
│   │   ├── overview/page.tsx             ← Anomaly Command Center
│   │   ├── network-traffic/page.tsx      ← Zeek anomaly feed
│   │   ├── endpoint-security/page.tsx    ← Wazuh event log + agent topology
│   │   ├── incidents/page.tsx            ← Case management board
│   │   ├── settings/page.tsx             ← User access management
│   │   └── profile/page.tsx
│   └── api/copilot/route.ts
├── components/
│   └── dashboard/
│       ├── sidebar.tsx                   ← 5 nav items, collapsed tooltip
│       ├── header.tsx                    ← uses apiClient.getHeaderData()
│       └── ai-copilot-widget.tsx
└── lib/
    ├── api.ts                            ← low-level fetch client (unchanged)
    ├── apiClient.ts                      ← NEW: centralised API service layer
    ├── mockData.ts                       ← NEW: single source of truth for all mock data
    ├── types.ts                          ← updated: WazuhEvent, NetworkAnomaly, case types
    └── utils.ts
```

### Pages Removed
| Page | Reason |
|---|---|
| `api-monitoring/page.tsx` | API Monitoring domain retired |
| `database-monitoring/page.tsx` | DB Monitoring domain retired |
| `reports/page.tsx` | Reports domain retired |
| `case-management/page.tsx` | Was a dead, unreachable route (sidebar never linked to it) |

### Files Deleted
| File | Reason |
|---|---|
| `components/charts/DefensiveChart.tsx` | Zero imports anywhere in the codebase |
| `lib/placeholder-images.ts` | Zero imports anywhere |
| `lib/placeholder-images.json` | Only consumed by the file above |

---

## Frontend — Key Architectural Changes

### 1. `src/lib/mockData.ts` (new)
Single source of truth for all mock/placeholder data. Every export is a named constant. No component contains inline hardcoded arrays or objects.

```
mockHeaderData         mockOverviewData        mockApiMonitoringData
mockNetworkTrafficData mockEndpointSecurityData mockDbMonitoringData
mockCaseManagementData mockUsersData            mockReportsData
mockThreatPulseData    mockAiExplanations
```

### 2. `src/lib/apiClient.ts` (new)
Centralised async API service. Every function follows the **mock bypass pattern**: returns `Promise.resolve(mockData)` now, with the real `apiFetch` call commented out directly below. Switching any function to live data is a one-line change — delete the mock return, uncomment the fetch block.

**Read functions:**
`getHeaderData()` · `getOverview()` · `getEndpointSecurity()` · `getNetworkTraffic()` · `getApiMonitoring()` · `getDatabaseMonitoring()` · `getCaseManagement()` · `getUsers()`

**Write functions:**
`blockNetworkSource()` · `quarantineDevice()` · `remediateIncident()` · `blockApiRoute()`

### 3. Sidebar — 5 Items (was 7)
```
Radio       → Anomaly Command Center  (/overview)
Network     → Network Traffic         (/network-traffic)
Laptop      → Endpoint Security       (/endpoint-security)
FolderOpen  → Case Management         (/incidents)
Settings    → Settings                (/settings)
```
Collapsed state shows hover tooltips. Active route has a blue left-bar indicator.

### 4. Anomaly Command Center (`/overview`)
The main page. Built from live data via `apiClient`, not inline mock arrays.

- **KPI strip** — Critical count, High count, total anomalies, active connections
- **Threat Pulse chart** — 24-hour `AreaChart` with two series: `endpoint` (Wazuh, violet) and `network` (Zeek, cyan). Data from `mockThreatPulseData`.
- **Anomaly feed** — Unified table combining `wazuhEvents` and `networkAnomalies`, sorted by severity (Critical first). Shows: Timestamp · Source · Threat Type · Severity badge · Origin tag (Wazuh/Zeek) · AI Explanation stub.

---

## Backend — Refactored Structure

```
app/
├── api/
│   ├── routes_auth.py           ← unchanged: JWT, users, 2FA, sessions
│   ├── routes_dashboard.py      ← 5 read-only endpoints (was 10)
│   └── routes_actions.py        ← 4 write endpoints (was 7)
│   [routes_settings.py deleted]
├── models/
│   ├── db_models.py             ← 9 models (was 16)
│   └── schemas.py               ← Pydantic schemas (bloat schemas retained,
│                                   unused ones can be pruned in a later pass)
├── services/
│   ├── auth_service.py          ← unchanged
│   ├── wazuh_service.py         ← Wazuh Indexer background poller
│   ├── anomaly_detection.py     ← NEW: statistical spike engine
│   ├── log_ingestion.py         ← bulk JSONL ingest (legacy)
│   ├── s3_ingestor.py           ← S3 cold storage (optional)
│   ├── constants.py             ← chart colours, event maps (mock seeds removed)
│   ├── connectors/
│   │   ├── wazuh_client.py      ← async Wazuh Manager REST client
│   │   └── log_loader.py        ← Pandas CSV warm cache (legacy, Zeek path)
│   └── query/
│       ├── __init__.py          ← trimmed exports
│       ├── overview_service.py  ← command center KPIs
│       ├── endpoint_service.py  ← Wazuh agent topology + alert feed
│       ├── network_service.py   ← Zeek anomaly queries
│       └── incidents_service.py ← NEW: renamed from reports_service.py
│           [api_service.py deleted]
│           [db_service.py deleted]
│           [reports_service.py deleted → incidents_service.py]
├── core/
│   ├── config.py                ← Velociraptor fields remain (not yet pruned)
│   ├── database.py              ← unchanged
│   ├── security.py              ← unchanged
│   └── wazuh_client.py          ← WazuhActions (active response)
├── main.py                      ← two background tasks in lifespan
init_db.py                       ← unchanged: creates tables via create_all
```

### Database Models (9 active, was 16)

| Model | Purpose | Change |
|---|---|---|
| `AtlasUser` | Platform users, RBAC, MFA | Kept |
| `UserSession` | Login session audit | Kept |
| `EndpointLog` | Wazuh endpoint events | Kept + new `env/timestamp` covering index |
| `NetworkLog` | Zeek network events | Kept |
| `Alert` | Aggregated bell-notification alerts | Kept |
| `TrafficAnomaly` | **NEW** — engine-detected spike events | Added |
| `Incident` | Security incident cases | Kept |
| `MitigationAuditLog` | Immutable analyst action audit trail | Kept |
| `S3IngestCursor` | S3 polling idempotency | Kept |
| ~~`ApiLog`~~ | API telemetry | **Deleted** |
| ~~`DbActivityLog`~~ | DB operation audit | **Deleted** |
| ~~`Application`~~ | App registry | **Deleted** |
| ~~`Microservice`~~ | Topology diagram nodes | **Deleted** |
| ~~`AppConfig`~~ | Per-app security tuning | **Deleted** |
| ~~`QuarantinedEndpoint`~~ | Quarantine ledger | **Deleted** |
| ~~`ScheduledReport`~~ | Report job definitions | **Deleted** |
| ~~`ReportDownload`~~ | Report download manifest | **Deleted** |

### `TrafficAnomaly` — New Model
```python
id            BigInteger PK
env           String(16)         — "cloud" | "local"
timestamp     DateTime(tz=True)  — proper TZ-aware DateTime, not a String
anomaly_type  String(128)        — e.g. "Endpoint Alert Spike"
severity      String(32)         — "Critical" | "High" | "Medium"
details       Text               — JSON snapshot: {current_count, baseline_avg,
                                   spike_ratio, env, detected_at}
ai_explanation Text (nullable)   — reserved for Phase 3 AI enrichment
```

### Dashboard API Routes (Refactored)

| Method | Route | Status |
|---|---|---|
| GET | `/header-data` | ✅ Active |
| GET | `/users` | ✅ Active |
| GET | `/overview` | ✅ Active (repurposed as command center) |
| GET | `/endpoint-security` | ✅ Active |
| GET | `/network-traffic` | ✅ Active |
| GET | `/api-monitoring` | ❌ Removed |
| GET | `/database-monitoring` | ❌ Removed |
| GET | `/incidents` | ❌ Removed from dashboard router |
| GET | `/case-management` | ❌ Removed |
| GET | `/reports/overview` | ❌ Removed |
| POST | `/api-monitoring/block-route` | ✅ Active (audit-only) |
| POST | `/network-traffic/block` | ✅ Active (audit-only) |
| POST | `/endpoint-security/quarantine` | ✅ Active (live Wazuh command) |
| POST | `/incidents/remediate` | ✅ Active (status + optional Wazuh) |
| POST | `/settings/apps/{id}/quarantine/lift` | ❌ Removed (model deleted) |
| POST | `/db-monitoring/kill-query` | ❌ Removed (domain retired) |
| POST | `/reports/generate` | ❌ Removed (domain retired) |

---

## The Anomaly Detection Engine

**File:** `app/services/anomaly_detection.py`

A pure-Python background task launched at startup alongside the Wazuh poller. Zero ML imports — `math` and `sqlalchemy.func.count` only.

### Algorithm
```
Every 60 seconds, per environment:

  current_minute_count = COUNT(EndpointLog WHERE timestamp >= now - 60s)

  baseline_total       = COUNT(EndpointLog WHERE timestamp BETWEEN
                               now - 10min AND now - 60s)   ← excludes spike minute

  baseline_average     = baseline_total / 9                 ← alerts per minute

  TRIGGER when:
    current_minute_count > 10            (absolute floor)
    AND
    current_minute_count >= baseline_average × 3.0          (300% spike)

  severity:
    ratio >= 5.0 → "Critical"
    ratio >= 3.0 → "High"
    ratio < 3.0  → "Medium"

  → INSERT TrafficAnomaly row with details JSON snapshot
```

### Error Handling
- `ProgrammingError` (tables not yet created) — swallowed silently, engine sleeps and retries next cycle
- `CancelledError` — re-raised cleanly for graceful shutdown via `asyncio.cancel()`
- All other exceptions — logged with `exc_info=True`, loop continues

### Startup Integration (`main.py`)
```python
wazuh_task   = asyncio.create_task(_start_wazuh_sync(),  name="wazuh_sync")
anomaly_task = asyncio.create_task(run_anomaly_engine(), name="anomaly_engine")

# Shutdown:
await asyncio.gather(wazuh_task, anomaly_task, return_exceptions=True)
```

---

## `incidents_service.py` — Refactored from `reports_service.py`

The old `reports_service.py` was one file with 9 unrelated functions spanning 4 domains. After removing the retired functions, only 3 survive — all incident-related — and the file is renamed to reflect its actual scope.

| Function | Status | Notes |
|---|---|---|
| `get_incidents()` | ✅ Kept | Sorted newest-first |
| `update_incident_status()` | ✅ Kept | Called by `routes_actions` |
| `get_case_management()` | ✅ Kept | KPI aggregation + MTTR |
| `get_app_config()` | ❌ Removed | AppConfig model deleted |
| `update_app_config()` | ❌ Removed | AppConfig model deleted |
| `get_quarantined_endpoints()` | ❌ Removed | QuarantinedEndpoint deleted |
| `lift_quarantine()` | ❌ Removed | QuarantinedEndpoint deleted |
| `get_reports_overview()` | ❌ Removed | ScheduledReport / ReportDownload deleted |
| `generate_report()` | ❌ Removed | ReportDownload deleted |

**Bugs fixed in the process:**
- `AppConfigRow` type annotation (the class was always `AppConfig`)
- KPI column label mismatch (`counts.critical` vs `.label("critical_open")`)

---

## Bugs Fixed Across All Files

| File | Bug | Fix |
|---|---|---|
| `reports_service.py` | `AppConfigRow` type used — class never existed | Removed with the function |
| `reports_service.py` | KPI label `"critical"` accessed as `counts.critical_open` | Fixed label names to match |
| `routes_actions.py` | `incident.target_identifier` — column belongs to `MitigationAuditLog`, not `Incident` | Fixed to `incident.target_app or incident.source_ip` |
| `routes_actions.py` | `lift_quarantine` — function name shadowed by the endpoint function in the same file | Removed with the endpoint |
| `types.ts` | `WazuhEvent.id` typed as `number` — mock data uses string IDs (`"evt-001"`) | Widened to `string \| number` |
| `types.ts` | `NetworkAnomaly` had no `severity` field — mock data includes it | Added as `severity?: Severity` |
| `types.ts` | `CaseManagementKpis`, `CaseManagementCase`, `CaseManagementResponse` were locally defined inside `incidents/page.tsx` | Moved to `types.ts` |

---

## Data Flow (Refactored)

```
Wazuh Indexer
    │
    ▼ every 60s
WazuhCollector.sync_alerts()
    │
    ▼ writes
EndpointLog (PostgreSQL)
    │
    ├──▶ endpoint_service.get_endpoint_security()  →  GET /endpoint-security
    │
    ├──▶ run_anomaly_engine()  →  TrafficAnomaly
    │         (every 60s, pure Python COUNT queries)
    │
    └──▶ overview_service.get_overview()  →  GET /overview


Zeek (via Wazuh / log_ingestion)
    │
    ▼ writes
NetworkLog (PostgreSQL)
    │
    └──▶ network_service.get_network_traffic()  →  GET /network-traffic
```

Everything flows through PostgreSQL. The Pandas CSV warm-cache layer (`log_loader.py`) is still present for the Zeek/network path but is isolated — it does not touch the endpoint or anomaly paths.

---

## What's Left for Future Phases

| Phase | Work |
|---|---|
| **Phase 3 — AI Enrichment** | Populate `TrafficAnomaly.ai_explanation` via a background enrichment pass using the existing Genkit/Gemini setup. The `mockAiExplanations` stubs in `mockData.ts` define the expected output format. |
| **Live API wiring** | In `apiClient.ts`, delete each `return Promise.resolve(mockData)` line and uncomment the `apiFetch` block. One change per function. |
| **`config.py` cleanup** | Remove `velociraptor_webhook_secret`, `velociraptor_api_url`, `velociraptor_api_key` fields and their validators — no longer needed. |
| **`overview_service.py` cleanup** | Remove `Microservice`, `Application` model imports and the Pandas `load_api_df` call. Replace with a `TrafficAnomaly` query for the command center feed. |
| **`signup/page.tsx` removal** | Remove the self-registration page and the `<Link href="/signup">` in `login/page.tsx`. Users are created exclusively via admin invite. |
