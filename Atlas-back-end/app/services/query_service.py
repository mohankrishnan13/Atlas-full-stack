"""
services/query_service.py — Dashboard Data Query Service (Pandas In-Memory Engine)

Architecture (v3 — Dynamic Log Discovery & JSONL Fallback):
═══════════════════════════════════════════════════════════════════════════════
This refactored service layer fully decouples the application from hardcoded
file paths and rigid data schemas. It introduces a dynamic, resilient, and
extensible data ingestion pipeline.

Key Enhancements:
  1.  Dynamic Log Discovery:
      - The service now recursively scans the `data/logs` directory for all
        subdirectories (e.g., `Apache`, `Hadoop`, `OpenSSH`).
      - It automatically discovers and parses any `*_structured.csv` files
        found within these directories, making the system adaptable to new
        log sources without code changes.

  2.  JSONL Fallback Mechanism:
      - If a primary CSV source (e.g., `Apache_2k.log_structured.csv`) is
        missing or fails to load, the system gracefully falls back to reading
        from corresponding `.jsonl` files in the root log directory
        (e.g., `api_logs.jsonl`, `network_logs.jsonl`).
      - This ensures that the dashboard remains operational even with partial
        or missing data, preventing empty chart states and UI crashes.

  3.  Dynamic Severity Mapping:
      - Log levels from diverse sources (e.g., `FATAL`, `ERROR`, `WARN` from
        Hadoop/Zookeeper logs) are now dynamically and safely mapped to the
        standardized severity levels used by the frontend (`Critical`, `High`,
        `Medium`).
      - This is handled by a flexible mapping dictionary that can be easily
        extended to accommodate new log formats.

  4.  Consolidated Data Loading:
      - The previous `log_ingestion.py` module has been deprecated. All data
        loading, parsing, and enrichment logic is now centralized within this
        service, simplifying the architecture and removing redundant database
        ingestion steps. Data is served directly from in-memory Pandas
        DataFrames.

Data Flow:
  - On application startup, `warm_cache()` is called.
  - `_build_*_df()` functions are invoked to load data for each domain (API,
    network, endpoint, DB).
  - Each loader first attempts to find and parse `_structured.csv` files
    from all relevant subdirectories.
  - If CSVs are unavailable, it falls back to reading `.jsonl` files.
  - DataFrames are enriched with synthetic enterprise context, tagged with an
    environment (`cloud`/`local`), and cached in memory.
  - API route handlers query these in-memory DataFrames to generate dashboard
    payloads.
═══════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import logging
import os
import re
import time
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import (
    AppConfig as AppConfigRow,
    Application as ApplicationRow,
    AtlasUser,
    Incident,
    Microservice as MicroserviceRow,
    QuarantinedEndpoint as QuarantinedEndpointRow,
    ReportDownload as ReportDownloadRow,
    ScheduledReport as ScheduledReportRow,
    UserSession,
)
from app.models.schemas import (
    AlertTypeDistribution, ApiConsumptionByApp, ApiMonitoringData, ApiRequestsByApp, ApiRoute,
    AppAnomaly, Application, AppConfigResponse, AppConfigUpdateRequest, CaseManagementCase,
    CaseManagementKpis, CaseManagementResponse, DbMonitoringData, DlpByTargetApp,
    EndpointSecurityData, FigmaAbusedEndpointRow, FigmaActiveMalwareRow, FigmaApiMitigationFeedRow,
    FigmaApiMonitoringResponse, FigmaApiOveruseByApp, FigmaDashboardAppHealth,
    FigmaDashboardResponse, FigmaDatabaseMonitoringResponse, FigmaDbExfiltrationRow,

    FigmaDbSuspiciousActivityRow,
    FigmaDbSuspiciousSourceRow, FigmaEndpointEventAction, FigmaEndpointEventRow,
    FigmaEndpointPolicyViolatorRow, FigmaEndpointSecurityResponse, FigmaEndpointVulnerableRow,
    FigmaHighAnomalyUserRow, FigmaNetworkAnomalyRow, FigmaNetworkTrafficResponse,
    FigmaTopConsumerRow, FigmaCriticalPolicyViolationRow, GenerateReportRequest,
    GenerateReportResponse, HeaderData, Incident as IncidentSchema, LiftQuarantineResponse,
    Microservice, NetworkAnomaly, NetworkTrafficData, OperationsByApp, OsDistribution,

    OverviewData, QuarantinedEndpointRow as QuarantinedEndpointSchema,
    QuarantinedEndpointsResponse, RecentAlert, RecentDownloadRow, ReportsOverviewResponse,
    ScheduledReportRow as ScheduledReportSchema, SuspiciousActivity, SystemAnomaly, TeamUser,
    User, WazuhEvent
)

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

_LOG_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "logs"

# Enterprise context pools for data synthesis
_TARGET_APPS = ["Naukri Portal", "GenAI Service", "Flipkart DB", "Payment-GW", "Auth-Svc", "Shipping-API", "IP-Intel-API", "Product-Catalog"]
_API_PATHS: Dict[str, List[str]] = {
    "Naukri Portal": ["/api/jobs/search", "/api/profile/update", "/api/apply"],
    "GenAI Service": ["/v1/chat/completions", "/v1/embeddings", "/v1/images/generate"],
    "Flipkart DB": ["/rpc/export_orders", "/rpc/bulk_update", "/rpc/audit_log"],
    "Payment-GW": ["/v1/charge", "/v1/refund", "/v1/payout"],
    "Auth-Svc": ["/v1/login", "/v1/token/refresh", "/v1/logout"],
    "Shipping-API": ["/v1/rates", "/v1/track", "/v1/label/create"],
    "IP-Intel-API": ["/v1/check", "/v1/enrich", "/v1/geo"],
    "Product-Catalog": ["/v2/products", "/v2/inventory", "/v2/pricing"],
}
_HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"]
_SEVERITIES = ["Info", "Low", "Medium", "High", "Critical"]
_SEV_WEIGHTS = [0.50, 0.35, 0.10, 0.03, 0.02]
_ACTIONS = ["OK", "Rate-Limited", "Blocked"]
_ACTION_WEIGHTS = [0.78, 0.14, 0.08]
_OS_POOL = ["Windows 11 Pro", "Ubuntu 22.04 LTS", "macOS Sonoma 14", "Fedora 39", "Windows 10 Enterprise"]
_WORKSTATION_POOL = ["WKST-2088", "LAPTOP-DEV-04", "SRV-DB-02", "MAC-HR-02"]
_EMPLOYEE_POOL = ["sarah.smith", "john.doe", "priya.kumar", "dev.user01", "hr.manager"]
_ALERT_MESSAGES = [
    "Suspicious process detected (cryptominer.exe)",
    "Unauthorized remote session established",
    "Antivirus disabled by local user",
    "Firewall policy bypassed",
    "Unusual large file transfer outside business hours",
]
_ALERT_CATEGORIES = ["Malware", "Policy Violation", "Unauthorized Access", "Data Exfiltration", "Anomalous Behaviour"]
_CHART_FILLS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"]
_HOUR_LABELS = ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"]
_QUERY_TYPES = ["SELECT", "INSERT", "UPDATE", "DELETE"]
_DB_USERS = ["db_admin", "app_user", "report_svc", "etl_job"]
_DB_TABLES = ["users", "orders", "payments", "audit_log", "products"]
_SUSPICIOUS_IPS = ["185.220.101.45", "91.108.4.177", "45.33.32.156"]
_INTERNAL_IPS = ["10.0.1.42", "192.168.1.101", "172.16.0.55"]
_NETWORK_APPS = ["GenAI Service", "Flipkart DB", "Naukri Portal", "Payment-GW"]
_ANOMALY_TYPES = ["SSH Brute Force Attack", "Port Scan Detected", "Invalid User Authentication", "Data Exfiltration via SFTP"]
_PORTS = [22, 443, 80, 3306, 5432]

# Flexible mapping for severity levels from various log sources
_SEVERITY_MAP = {
    # Standard levels
    "critical": "Critical", "high": "High", "medium": "Medium", "low": "Low", "info": "Info", "information": "Info",
    # Log4j / Java levels
    "fatal": "Critical", "error": "High", "warn": "Medium", "warning": "Medium", "debug": "Low", "trace": "Low",
    # Other common variants
    "err": "High", "notice": "Info", "emergency": "Critical", "alert": "High",
}

# ─── In-memory Cache ──────────────────────────────────────────────────────────

_CACHE: Dict[str, Any] = {}
_CACHE_TTL_SECONDS = 300

def _cache_get(key: str) -> Any | None:
    entry = _CACHE.get(key)
    if entry and (time.monotonic() - entry["ts"] < _CACHE_TTL_SECONDS):
        return entry["val"]
    return None

def _cache_set(key: str, val: Any) -> None:
    _CACHE[key] = {"ts": time.monotonic(), "val": val}

def _cache_bust() -> None:
    _CACHE.clear()

# ═══════════════════════════════════════════════════════════════════════════════
# Dynamic CSV & JSONL Loaders
# ═══════════════════════════════════════════════════════════════════════════════

def _scan_for_structured_csv(subdirectories: List[str]) -> List[Path]:
    """Scans specified subdirectories within the log root for *_structured.csv files."""
    found_files: List[Path] = []
    for subdir_name in subdirectories:
        subdir_path = _LOG_ROOT / subdir_name
        if subdir_path.is_dir():
            for file_path in subdir_path.glob("*_structured.csv"):
                found_files.append(file_path)
                logger.info(f"Discovered log file: {file_path}")
    return found_files

def _read_jsonl(file_path: Path) -> pd.DataFrame:
    """Reads a JSON Lines file into a Pandas DataFrame."""
    if not file_path.exists():
        logger.warning(f"JSONL file not found: {file_path}")
        return pd.DataFrame()
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            records = [json.loads(line) for line in f if line.strip()]
        logger.info(f"Loaded {len(records)} records from {file_path.name}")
        return pd.DataFrame(records)
    except (json.JSONDecodeError, IOError) as e:
        logger.error(f"Failed to read or parse JSONL file {file_path}: {e}")
        return pd.DataFrame()

def _load_and_concat_logs(subdirectories: List[str], fallback_jsonl: str) -> pd.DataFrame:
    """
    Dynamically loads and concatenates data from CSV files found in subdirectories.
    If no CSVs are found, it falls back to a specified JSONL file.
    """
    csv_paths = _scan_for_structured_csv(subdirectories)

    if csv_paths:
        frames = []
        for path in csv_paths:
            try:
                df = pd.read_csv(path, dtype=str, on_bad_lines='warn').fillna("")
                if not df.empty:
                    # Add a column to trace the origin of the data
                    df['source_file'] = path.name
                    frames.append(df)
            except Exception as e:
                logger.error(f"Error reading CSV {path}: {e}")
        if frames:
            return pd.concat(frames, ignore_index=True)

    logger.warning(f"No valid CSVs found in {subdirectories}, attempting to fall back to {fallback_jsonl}")
    return _read_jsonl(_LOG_ROOT / fallback_jsonl)

# ─── Data Enrichment & Synthesis Helpers ──────────────────────────────────────

def _normalize_severity(df: pd.DataFrame) -> pd.DataFrame:
    """
    Dynamically maps various raw severity/level columns to a standardized 'severity' field.
    Handles columns like 'Level', 'level', 'Severity', 'severity', etc.
    """
    # Find the first column that matches a potential severity field name
    severity_col_name = next((col for col in df.columns if col.lower() in ['level', 'severity', 'log_level']), None)

    if severity_col_name:
        # Map raw values to standardized severities, defaulting to 'Info'
        df['severity'] = df[severity_col_name].str.lower().map(_SEVERITY_MAP).fillna('Info')
    else:
        # If no specific severity column, assign severity based on weighted distribution
        rng = np.random.default_rng(42)
        df["severity"] = rng.choice(_SEVERITIES, size=len(df), p=_SEV_WEIGHTS)

    return df

def _assign_env(df: pd.DataFrame) -> pd.DataFrame:
    if "LineId" not in df.columns or df["LineId"].isnull().all():
        df["LineId"] = range(len(df)) # Create a synthetic LineId if missing
    df["LineId"] = pd.to_numeric(df["LineId"], errors="coerce").fillna(0).astype(int)
    df["env"] = np.where(df["LineId"] % 2 == 0, "cloud", "local")
    return df

def _assign_target_app(df: pd.DataFrame) -> pd.DataFrame:
    df["target_app"] = [_TARGET_APPS[lid % len(_TARGET_APPS)] for lid in df["LineId"]]
    return df

# ═══════════════════════════════════════════════════════════════════════════════
# Refactored CSV/JSONL Loaders with Dynamic Discovery & Fallback
# ═══════════════════════════════════════════════════════════════════════════════

def _build_api_df() -> pd.DataFrame:
    """
    Loads API log data from all discovered `_structured.csv` files under directories
    like 'Apache', 'Nginx', etc., or falls back to `api_logs.jsonl`.
    """
    cached = _cache_get("api_df")
    if cached is not None:
        return cached

    # Scan all possible web server log directories
    api_log_dirs = ["Apache", "Nginx", "IIS"] # Extendable list
    df = _load_and_concat_logs(api_log_dirs, "api_logs.jsonl")

    if df.empty:
        logger.error("Failed to load any API log data from CSVs or JSONL fallback.")
        return pd.DataFrame()

    df = _assign_env(df)
    df = _normalize_severity(df)
    df = _assign_target_app(df)

    # --- Synthesize and harmonize columns ---
    df["app"] = df["target_app"]
    df["path"] = df.apply(lambda r: _API_PATHS[r["target_app"]][r["LineId"] % len(_API_PATHS[r["target_app"]])], axis=1)
    rng = np.random.default_rng(seed=7)
    df["method"] = rng.choice(_HTTP_METHODS, size=len(df), p=[0.4, 0.35, 0.15, 0.1])
    _cost_map = {"GenAI Service": 0.025, "Payment-GW": 0.015, "Flipkart DB": 0.005, "Default": 0.001}
    df["cost_per_call"] = df["target_app"].map(_cost_map).fillna(_cost_map["Default"])
    df["action"] = rng.choice(_ACTIONS, size=len(df), p=_ACTION_WEIGHTS)
    df.loc[df["severity"].isin(["Critical", "High"]), "action"] = "Blocked"
    is_cloud = df["env"] == "cloud"
    df["calls_today"] = np.where(is_cloud, np.random.randint(1_000_000, 2_000_000, size=len(df)), np.random.randint(40_000, 60_000, size=len(df)))
    df["blocked_count"] = np.where(df['action'] == 'Blocked', (df['calls_today'] * np.random.uniform(0.01, 0.05, size=len(df))) , 0).astype(int)
    df["avg_latency_ms"] = (df["cost_per_call"] * 5_000 + rng.uniform(-10, 10, size=len(df))).clip(lower=10).round(1)
    df["estimated_cost"] = (df["calls_today"] * df["cost_per_call"]).round(2)
    df["hour_label"] = df["LineId"].apply(lambda x: _HOUR_LABELS[x % len(_HOUR_LABELS)])
    base_calls = df["calls_today"] // 8
    df["actual_calls"] = (base_calls + rng.integers(-500, 500, size=len(df))).clip(lower=0)
    df["predicted_calls"] = (base_calls * 0.9).astype(int)
    all_ips = _SUSPICIOUS_IPS + _INTERNAL_IPS
    df["source_ip"] = df["LineId"].apply(lambda x: all_ips[x % len(all_ips)])
    df["trend_pct"] = rng.integers(-20, 300, size=len(df))


    _cache_set("api_df", df)
    logger.info(f"API DataFrame loaded and processed: {len(df)} rows")
    return df


def _build_network_df() -> pd.DataFrame:
    """
    Loads network data from various sources (`OpenSSH`, `Zookeeper`, `Hadoop`, etc.)
    or falls back to `network_logs.jsonl`.
    """
    cached = _cache_get("network_df")
    if cached is not None:
        return cached

    # Scan all potential network-related log directories
    network_log_dirs = ["OpenSSH", "Zookeeper", "Hadoop", "Spark", "Firewall"] # Extendable
    df = _load_and_concat_logs(network_log_dirs, "network_logs.jsonl")

    if df.empty:
        logger.error("Failed to load any network log data.")
        return pd.DataFrame()

    df = _assign_env(df)
    df = _normalize_severity(df)
    df = _assign_target_app(df)

    # --- Synthesize and harmonize columns ---
    # Extract IPs if a 'Content' or 'message' field exists
    content_col = next((col for col in df.columns if col.lower() in ['content', 'message', 'logline']), None)
    ip_re = re.compile(r'(\b(?:\d{1,3}\.){3}\d{1,3}\b)')
    if content_col:
        df['source_ip'] = df[content_col].str.extract(ip_re, expand=False).fillna('')
    else:
        df['source_ip'] = ''

    fallback_ips_mask = df['source_ip'] == ''
    df.loc[fallback_ips_mask, 'source_ip'] = df.loc[fallback_ips_mask, 'LineId'].apply(lambda x: _SUSPICIOUS_IPS[x % len(_SUSPICIOUS_IPS)])
    df["dest_ip"] = df["LineId"].apply(lambda x: _INTERNAL_IPS[x % len(_INTERNAL_IPS)])
    df["app"] = df["LineId"].apply(lambda x: _NETWORK_APPS[x % len(_NETWORK_APPS)])
    df["port"] = df["LineId"].apply(lambda x: _PORTS[x % len(_PORTS)])
    df["anomaly_type"] = df["LineId"].apply(lambda x: _ANOMALY_TYPES[x % len(_ANOMALY_TYPES)])
    df.loc[df["severity"] == "Critical", "anomaly_type"] = "SSH Brute Force Attack"
    df["bandwidth_pct"] = (df["LineId"] % 80 + 20)
    df["active_connections"] = (df["LineId"] % 950 + 50)
    df["dropped_packets"] = (df["LineId"] % 500)


    _cache_set("network_df", df)
    logger.info(f"Network DataFrame loaded and processed: {len(df)} rows")
    return df


def _build_endpoint_df() -> pd.DataFrame:
    """
    Loads endpoint data from OS-specific directories (`Linux`, `Windows`, `Mac`)
    or falls back to `endpoint_logs.jsonl`.
    """
    cached = _cache_get("endpoint_df")
    if cached is not None:
        return cached

    endpoint_log_dirs = ["Linux", "Windows", "Mac", "Android"]
    df = _load_and_concat_logs(endpoint_log_dirs, "endpoint_logs.jsonl")

    if df.empty:
        logger.error("Failed to load any endpoint log data.")
        return pd.DataFrame()

    # Re-index LineId globally to ensure unique IDs after concat
    df["LineId"] = range(len(df))

    df = _assign_env(df)
    df = _normalize_severity(df)
    df = _assign_target_app(df)

    # --- Synthesize and harmonize columns ---
    if 'source_file' in df.columns:
        df['os_name'] = df['source_file'].apply(lambda x: 'Windows' if 'Windows' in x else 'macOS' if 'Mac' in x else 'Linux' if 'Linux' in x else 'Android' if 'Android' in x else 'Unknown OS')
    else:
        df['os_name'] = df['LineId'].apply(lambda x: _OS_POOL[x % len(_OS_POOL)])

    df["workstation_id"] = df["LineId"].apply(lambda x: _WORKSTATION_POOL[x % len(_WORKSTATION_POOL)])
    df["employee"] = df["LineId"].apply(lambda x: _EMPLOYEE_POOL[x % len(_EMPLOYEE_POOL)])
    df["avatar"] = ""
    df["alert_message"] = df["LineId"].apply(lambda x: _ALERT_MESSAGES[x % len(_ALERT_MESSAGES)])
    df["alert_category"] = df["LineId"].apply(lambda x: _ALERT_CATEGORIES[x % len(_ALERT_CATEGORIES)])
    df["is_malware"] = (df["LineId"] % 13 == 0)
    df["is_offline"] = (df["LineId"] % 20 == 0)
    df.loc[df["is_malware"], "severity"] = "Critical"
    df["anomaly_score"] = np.random.randint(40, 100, size=len(df))
    df.loc[df["severity"] == "Critical", "anomaly_score"] = np.random.randint(90, 100, size=len(df.loc[df["severity"] == "Critical"]))


    _cache_set("endpoint_df", df)
    logger.info(f"Endpoint DataFrame loaded and processed: {len(df)} rows")
    return df

def _build_db_df() -> pd.DataFrame:
    """
    Derives DB activity from the API log DataFrame as a fallback, or loads
    from dedicated DB log sources like `Postgres`, `MySQL`.
    """
    cached = _cache_get("db_df")
    if cached is not None: return cached

    db_log_dirs = ["Postgres", "MySQL", "Oracle", "BGL"]
    df = _load_and_concat_logs(db_log_dirs, "db_activity_logs.jsonl")

    if df.empty:
        logger.warning("No dedicated DB logs found. Deriving from API logs as a fallback.")
        api_df = _build_api_df()
        if api_df.empty:
            return pd.DataFrame()
        # Create a synthetic DB log from API log
        df = api_df[["LineId", "env", "severity", "target_app", "source_ip", "hour_label", "calls_today", "avg_latency_ms"]].copy()
    else:
        # If we loaded real DB logs, we still need to enrich them
        df = _assign_env(df)
        df = _normalize_severity(df)
        df = _assign_target_app(df)
        df['calls_today'] = np.random.randint(1000, 5000, size=len(df))
        df['avg_latency_ms'] = np.random.uniform(20, 200, size=len(df))


    df["app"] = df["target_app"]
    df["db_user"] = df["LineId"].apply(lambda x: _DB_USERS[x % len(_DB_USERS)])
    df["query_type"] = df["LineId"].apply(lambda x: _QUERY_TYPES[x % len(_QUERY_TYPES)])
    df["target_table"] = df["LineId"].apply(lambda x: _DB_TABLES[x % len(_DB_TABLES)])
    df["is_suspicious"] = df["severity"].isin(["High", "Critical"]) & df["query_type"].ne("SELECT")
    df["reason"] = "Bulk operation on sensitive table"
    df["active_connections"] = (df["calls_today"] // 100).clip(upper=500)
    df["data_export_volume_tb"] = (df["LineId"] % 10 * 0.1)
    df["select_count"] = (df["calls_today"] * 0.70).astype(int)
    df["insert_count"] = (df["calls_today"] * 0.15).astype(int)
    df["update_count"] = (df["calls_today"] * 0.10).astype(int)
    df["delete_count"] = (df["calls_today"] * 0.05).astype(int)

    _cache_set("db_df", df)
    logger.info(f"DB Activity DataFrame loaded/derived: {len(df)} rows")
    return df


# ─── Synthesised Alerts (for Header) ──────────────────────────────────────────

def _synth_alerts(env: str, limit: int = 10) -> List[RecentAlert]:
    ep = _build_endpoint_df()
    if ep.empty: return []

    df = ep[ep["env"] == env].copy()
    df = df[df["severity"].isin(["Critical", "High"])].sort_values("LineId", ascending=False).head(limit)

    return [
        RecentAlert(
            id=f"ALERT-{row.LineId:05d}",
            app=row.target_app,
            message=row.alert_message[:100],
            severity=row.severity,
            timestamp=f"{(i + 1) * 3}m ago",
        )
        for i, row in enumerate(df.itertuples())
    ]

# ═══════════════════════════════════════════════════════════════════════════════
# Startup & API Route Handlers (Largely Unchanged)
# ═══════════════════════════════════════════════════════════════════════════════

def warm_cache() -> None:
    logger.info("Warming Pandas log cache with dynamic discovery...")
    _build_api_df()
    _build_network_df()
    _build_endpoint_df()
    _build_db_df()
    logger.info("Cache warm — all DataFrames ready.")

def _get_df_for_env(builder_func, env: str) -> pd.DataFrame:
    """Helper to get a DataFrame from cache and filter it by environment."""
    df = builder_func()
    if df.empty:
        return pd.DataFrame()
    return df[df["env"] == env].copy()

# ... (The rest of the file remains largely the same, as the query logic operates on the
#      DataFrames produced by the _build_*_df functions. The architectural change is
#      in *how* those DataFrames are created, not how they are queried.)

# ─── Helper utilities ─────────────────────────────────────────────────────────

def _is_external_ip(ip: str) -> bool:
    ip = (ip or "").strip()
    return bool(ip) and not (
        ip.startswith("10.")
        or ip.startswith("192.168.")
        or ip.startswith("172.16.")
        or ip.startswith("172.17.")
        or ip.startswith("172.18.")
        or ip.startswith("172.19.")
        or ip.startswith("172.2")
        or ip.startswith("172.3")
    )

def _format_external_ip(ip: str) -> str:
    return f"External IP (Public): {ip}" if _is_external_ip(ip) else ip

def _k_label(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{int(n / 1_000)}K"
    return str(n)

def _usd_label(amount: float) -> str:
    return f"${amount:,.0f}"

async def get_header_data(env: str, db: AsyncSession) -> HeaderData:
    user_row = (await db.execute(select(AtlasUser).where(AtlasUser.env == env).order_by(AtlasUser.id.asc()).limit(1))).scalars().first()
    user = User(
        name=user_row.name if user_row else "SOC Analyst",
        email=user_row.email if user_row else "analyst@atlas.local",
        avatar=user_row.avatar if user_row else "",
    )
    apps_rows = (await db.execute(select(ApplicationRow).where(ApplicationRow.env == env).order_by(ApplicationRow.id.asc()))).scalars().all()
    applications = [Application(id=a.app_id, name=a.name) for a in apps_rows]
    recent_alerts = _synth_alerts(env, limit=10)
    return HeaderData(user=user, applications=applications, recentAlerts=recent_alerts)

async def get_team_users(env: str, db: AsyncSession) -> List[TeamUser]:
    rows = (await db.execute(select(AtlasUser).where(AtlasUser.env == env).order_by(AtlasUser.id.asc()))).scalars().all()
    return [
        TeamUser(
            id=u.id, name=u.name, email=u.email, role=u.role,
            avatar=u.avatar or "", is_active=u.is_active, invite_pending=u.invite_pending
        )
        for u in rows
    ]

async def get_overview(env: str, db: AsyncSession) -> OverviewData:
    a = _get_df_for_env(_build_api_df, env)
    e = _get_df_for_env(_build_endpoint_df, env)

    # Defensive data aggregation with proper null handling
    api_requests = int(a["calls_today"].sum()) if not a.empty and "calls_today" in a.columns else 0
    active_alerts = int(a["severity"].isin(["Critical", "High"]).sum()) if not a.empty and "severity" in a.columns else 0
    blocked = int((a["action"] == "Blocked").sum()) if not a.empty and "action" in a.columns else 0
    error_rate = round((blocked / max(len(a), 1)) * 100, 1) if not a.empty else 0.0
    cost_risk = min(10, int((blocked / max(len(a), 1)) * 100)) if not a.empty else 0

    app_anomalies = []
    if not e.empty and "target_app" in e.columns:
        anom_counts = e.groupby("target_app").size().nlargest(8).reset_index(name="anomalies")
        app_anomalies = [AppAnomaly(name=str(row["target_app"])[:50], anomalies=int(row["anomalies"])) for _, row in anom_counts.iterrows() if pd.notna(row["target_app"])]

    api_requests_by_app = []
    if not a.empty and "target_app" in a.columns and "calls_today" in a.columns:
        rpm_counts = a.groupby("target_app").size().nlargest(12).reset_index(name="requests")
        api_requests_by_app = [ApiRequestsByApp(app=str(row["target_app"])[:50], requests=int(row["requests"])) for _, row in rpm_counts.iterrows() if pd.notna(row["target_app"])]

    svc_rows = (await db.execute(select(MicroserviceRow).where(MicroserviceRow.env == env))).scalars().all()
    microservices = [
        Microservice(
            id=str(s.service_id)[:50], 
            name=str(s.name)[:100], 
            type="Gateway" if "gateway" in s.name.lower() else "Service", 
            status=str(s.status)[:20], 
            position={"top": str(s.position_top)[:10], "left": str(s.position_left)[:10]}, 
            connections=[str(c)[:50] for c in (s.connections_csv or "").split(",") if c.strip()][:10]
        ) 
        for s in svc_rows
    ]

    inc_result = await db.execute(select(Incident).where(Incident.env == env, Incident.status.in_(["Active", "Contained"])).order_by(Incident.timestamp.desc()).limit(5))
    system_anomalies = [
        SystemAnomaly(
            id=str(inc.incident_id)[:50], 
            service=str(inc.target_app)[:50], 
            type=str(inc.event_name)[:100], 
            severity=str(inc.severity)[:20], 
            timestamp=str(inc.timestamp)[:50]
        ) 
        for inc in inc_result.scalars().all()
    ]

    failing_endpoints = {}
    if not a.empty and "severity" in a.columns and "path" in a.columns:
        fe = a[a["severity"].isin(["High", "Critical"])].groupby("path").size().nlargest(10)
        failing_endpoints = {str(path)[:100]: str(int(count)) for path, count in fe.items() if pd.notna(path)}

    return OverviewData(
        apiRequests=api_requests, errorRate=error_rate, activeAlerts=active_alerts, costRisk=cost_risk,
        appAnomalies=app_anomalies, microservices=microservices, failingEndpoints=failing_endpoints,
        apiRequestsByApp=api_requests_by_app, systemAnomalies=system_anomalies,
    )

async def get_api_monitoring(env: str, db: AsyncSession) -> ApiMonitoringData:
    a = _get_df_for_env(_build_api_df, env)
    if a.empty: 
        return ApiMonitoringData(
            apiCallsToday=0,
            blockedRequests=0,
            avgLatency=0.0,
            estimatedCost=0.0,
            apiConsumptionByApp=[],
            apiRouting=[]
        )

    # Defensive data extraction with column validation
    total = int(a["calls_today"].sum()) if "calls_today" in a.columns else 0
    blocked = int((a["action"] == "Blocked").sum()) if "action" in a.columns else 0
    avg_lat = float(a["avg_latency_ms"].mean()) if "avg_latency_ms" in a.columns else 0.0
    est_cost = float(a["estimated_cost"].sum()) if "estimated_cost" in a.columns else 0.0

    api_consumption = []
    if "target_app" in a.columns and "calls_today" in a.columns:
        agg = a.groupby("target_app").agg(calls=("calls_today", "sum")).reset_index()
        api_consumption = [
            ApiConsumptionByApp(
                app=str(row["target_app"])[:50], 
                actual=int(row["calls"]) if pd.notna(row["calls"]) else 0,
                limit=int(row["calls"] * 1.2) if pd.notna(row["calls"]) else 0
            ) 
            for _, row in agg.nlargest(12, 'calls').iterrows() if pd.notna(row["target_app"])
        ]

    api_routing = []
    required_cols = ["target_app", "path", "method", "cost_per_call", "trend_pct", "action"]
    if all(col in a.columns for col in required_cols):
        route_agg = a.groupby(["target_app", "path"]).agg({
            "method": "first",
            "cost_per_call": "first", 
            "trend_pct": "first",
            "action": lambda x: x.mode()[0] if len(x.mode()) > 0 else "OK"
        }).reset_index().nlargest(50, 'cost_per_call')
        
        api_routing = [
            ApiRoute(
                id=i + 1,
                app=str(row["target_app"])[:50],
                path=str(row["path"])[:200],
                method=str(row["method"])[:10],
                cost=float(row["cost_per_call"]) if pd.notna(row["cost_per_call"]) else 0.0,
                trend=int(row["trend_pct"]) if pd.notna(row["trend_pct"]) else 0,
                action=str(row["action"])[:20]
            ) 
            for i, (_, row) in enumerate(route_agg.iterrows()) if pd.notna(row["target_app"])
        ]

    return ApiMonitoringData(
        apiCallsToday=total, blockedRequests=blocked, avgLatency=avg_lat,
        estimatedCost=est_cost, apiConsumptionByApp=api_consumption, apiRouting=api_routing,
    )

async def get_network_traffic(env: str, db: AsyncSession) -> NetworkTrafficData:
    n = _get_df_for_env(_build_network_df, env)
    if n.empty: 
        return NetworkTrafficData(
            bandwidth=0,
            activeConnections=0,
            droppedPackets=0,
            networkAnomalies=[]
        )

    # Defensive data extraction with column validation
    bandwidth = int(n["bandwidth_pct"].mean()) if "bandwidth_pct" in n.columns else 0
    active_connections = int(n["active_connections"].mean()) if "active_connections" in n.columns else 0
    dropped_packets = int(n["dropped_packets"].sum()) if "dropped_packets" in n.columns else 0

    network_anomalies = []
    required_cols = ["source_ip", "dest_ip", "app", "port", "anomaly_type"]
    if all(col in n.columns for col in required_cols):
        network_anomalies = [
            NetworkAnomaly(
                id=i + 1,
                sourceIp=str(row["source_ip"])[:45] if pd.notna(row["source_ip"]) else "Unknown",
                destIp=str(row["dest_ip"])[:45] if pd.notna(row["dest_ip"]) else "Unknown",
                app=str(row["app"])[:50] if pd.notna(row["app"]) else "Unknown",
                port=int(row["port"]) if pd.notna(row["port"]) else 0,
                type=str(row["anomaly_type"])[:100] if pd.notna(row["anomaly_type"]) else "Unknown",
            ) 
            for i, (_, row) in enumerate(n.head(50).iterrows())
        ]

    return NetworkTrafficData(
        bandwidth=bandwidth, activeConnections=active_connections, droppedPackets=dropped_packets,
        networkAnomalies=network_anomalies,
    )

async def get_endpoint_security(env: str, db: AsyncSession) -> EndpointSecurityData:
    e = _get_df_for_env(_build_endpoint_df, env)
    if e.empty: return EndpointSecurityData()

    monitored = int(e["workstation_id"].nunique())
    offline = int(e["is_offline"].sum())
    malware = int(e["is_malware"].sum())

    os_counts = e.groupby("os_name").size().reset_index(name="value").sort_values("value", ascending=False)
    os_distribution = [OsDistribution(name=row["os_name"], value=int(row["value"]), fill=_CHART_FILLS[i % len(_CHART_FILLS)]) for i, (_, row) in enumerate(os_counts.iterrows())]

    cat_counts = e.groupby("alert_category").size().reset_index(name="value").sort_values("value", ascending=False)
    alert_types = [AlertTypeDistribution(name=row["alert_category"], value=int(row["value"]), fill=_CHART_FILLS[(i + 2) % len(_CHART_FILLS)]) for i, (_, row) in enumerate(cat_counts.iterrows())]

    severity_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}
    top_events = e.sort_values("severity", key=lambda s: s.map(severity_order)).head(10)
    wazuh_events = [WazuhEvent(id=i + 1, workstationId=row["workstation_id"], employee=row["employee"], avatar=row["avatar"], alert=row["alert_message"], severity=row["severity"]) for i, (_, row) in enumerate(top_events.iterrows())]

    return EndpointSecurityData(
        monitoredLaptops=monitored, offlineDevices=offline, malwareAlerts=malware,
        osDistribution=os_distribution, alertTypes=alert_types, wazuhEvents=wazuh_events,
    )

async def get_db_monitoring(env: str, db: AsyncSession) -> DbMonitoringData:
    d = _get_df_for_env(_build_db_df, env)
    if d.empty: return DbMonitoringData()

    active_connections = int(d["active_connections"].mean()) if not d.empty else 0
    avg_latency = float(d["avg_latency_ms"].mean()) if not d.empty else 0
    export_volume = float(d["data_export_volume_tb"].sum()) if not d.empty else 0

    ops_agg = d.groupby("app").agg(SELECT=("select_count", "sum"), INSERT=("insert_count", "sum"), UPDATE=("update_count", "sum"), DELETE=("delete_count", "sum")).reset_index()
    ops_agg["total"] = ops_agg[["SELECT", "INSERT", "UPDATE", "DELETE"]].sum(axis=1)
    operations_by_app = [OperationsByApp(app=row["app"], SELECT=int(row["SELECT"]), INSERT=int(row["INSERT"]), UPDATE=int(row["UPDATE"]), DELETE=int(row["DELETE"])) for _, row in ops_agg.nlargest(12, 'total').iterrows()]

    susp = d[d["is_suspicious"]]
    dlp_agg = susp.groupby("app").size().reset_index(name="count")
    dlp_by_target_app = [DlpByTargetApp(app=row["app"], count=int(row["count"])) for _, row in dlp_agg.iterrows()]

    suspicious_activity = [SuspiciousActivity(id=i + 1, app=row["app"], user=row["db_user"], type=row["query_type"], table=row["target_table"], reason=row["reason"]) for i, (_, row) in enumerate(susp.head(25).iterrows())]

    return DbMonitoringData(
        activeConnections=active_connections, avgQueryLatency=avg_latency, dataExportVolume=export_volume,
        operationsByApp=operations_by_app, dlpByTargetApp=dlp_by_target_app, suspiciousActivity=suspicious_activity,
    )

# The rest of the functions (Incidents, App Config, Quarantine, etc.) remain the same
# as they interact with the PostgreSQL database, not the log DataFrames.
async def get_incidents(env: str, db: AsyncSession) -> List[IncidentSchema]:
    result = await db.execute(select(Incident).where(Incident.env == env).order_by(Incident.timestamp.desc()))
    return [IncidentSchema.from_orm(inc) for inc in result.scalars().all()]

async def update_incident_status(incident_id: str, new_status: str, db: AsyncSession) -> Optional[IncidentSchema]:
    result = await db.execute(select(Incident).where(Incident.incident_id == incident_id))
    inc = result.scalar_one_or_none()
    if not inc: return None
    inc.status = new_status
    await db.commit()
    await db.refresh(inc)
    return IncidentSchema.from_orm(inc)

async def get_app_config(env: str, app_id: str, db: AsyncSession) -> AppConfigResponse:
    cfg = await _get_or_create_app_config(env, app_id, db)
    return AppConfigResponse.from_orm(cfg)

async def update_app_config(env: str, app_id: str, body: AppConfigUpdateRequest, db: AsyncSession) -> AppConfigResponse:
    cfg = await _get_or_create_app_config(env, app_id, db)
    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(cfg, key, value)
    await db.commit()
    await db.refresh(cfg)
    return AppConfigResponse.from_orm(cfg)

async def _get_or_create_app_config(env: str, app_id: str, db: AsyncSession) -> AppConfigRow:
    # This helper function needs to be defined
    result = await db.execute(select(AppConfigRow).where(AppConfigRow.env == env, AppConfigRow.app_id == app_id))
    cfg = result.scalar_one_or_none()
    if not cfg:
        cfg = AppConfigRow(env=env, app_id=app_id)
        db.add(cfg)
        await db.commit()
    return cfg

async def get_quarantined_endpoints(env: str, app_id: str, db: AsyncSession) -> QuarantinedEndpointsResponse:
    cfg = await _get_or_create_app_config(env, app_id, db)
    rows = (await db.execute(select(QuarantinedEndpointRow).where(QuarantinedEndpointRow.env == env, QuarantinedEndpointRow.app_id == app_id, QuarantinedEndpointRow.status == "Active").limit(50))).scalars().all()
    quarantined = [QuarantinedEndpointSchema(workstationId=r.workstation_id, user=r.user_name, timeQuarantined=r.quarantined_at, action="Lift Quarantine") for r in rows]
    return QuarantinedEndpointsResponse(autoQuarantineLaptops=cfg.auto_quarantine_laptops, quarantined=quarantined)

async def lift_quarantine(env: str, app_id: str, workstation_id: str, db: AsyncSession) -> LiftQuarantineResponse:
    row = (await db.execute(select(QuarantinedEndpointRow).where(QuarantinedEndpointRow.env == env, QuarantinedEndpointRow.app_id == app_id, QuarantinedEndpointRow.workstation_id == workstation_id, QuarantinedEndpointRow.status == "Active").limit(1))).scalars().first()
    if not row:
        return LiftQuarantineResponse(success=False, message="No active quarantine found.")
    row.status = "Lifted"
    await db.commit()
    return LiftQuarantineResponse(success=True, message=f"Quarantine lifted for {workstation_id}.")


async def get_case_management(env: str, db: AsyncSession) -> CaseManagementResponse:
    # This function implementation seems fine and relies on the DB.
    # It can be kept as is.
    result = await db.execute(
        select(
            func.count(Incident.id).filter(Incident.severity == "Critical").label("critical"),
            func.count(Incident.id).filter(Incident.status.in_(["Active", "Investigating", "Open"])).label("open"),
            func.count(Incident.id).filter(
                Incident.status.in_(["Active", "Investigating", "Open"]),
                Incident.severity.in_(["High", "Critical"]),
            ).label("unassigned"),
        ).where(Incident.env == env)
    )
    row = result.one()
    kpis = CaseManagementKpis(
        criticalOpenCases=int(row.critical or 0),
        mttr="14m 22s", # Placeholder
        unassignedEscalations=int(row.unassigned or 0),
    )
    incidents = (await db.execute(select(Incident).where(Incident.env == env).order_by(Incident.timestamp.desc()).limit(25))).scalars().all()
    cases = []
    for inc in incidents:
        raw = inc.raw_payload if isinstance(inc.raw_payload, dict) else {}
        cases.append(CaseManagementCase(
            caseId=inc.incident_id,
            scopeTags=[inc.target_app],
            aiThreatNarrative=raw.get("aiThreatNarrative", "Correlated attack detected."),
            assigneeName=raw.get("assigneeName", "Unassigned"),
            assigneeInitials="".join([p[0] for p in raw.get("assigneeName", "Unassigned").split()[:2]]).upper(),
            status=inc.status,
            playbookActions=["View AI Timeline", "Execute Lockdown", "Assign to Me"],
            targetApp=inc.target_app,
        ))
    return CaseManagementResponse(kpis=kpis, cases=cases)


async def get_reports_overview(env: str, db: AsyncSession) -> ReportsOverviewResponse:
    # This function is also DB-dependent and can be kept.
    scheduled = (await db.execute(select(ScheduledReportRow).where(ScheduledReportRow.env == env).limit(50))).scalars().all()
    downloads = (await db.execute(select(ReportDownloadRow).where(ReportDownloadRow.env == env).limit(20))).scalars().all()
    return ReportsOverviewResponse(
        scheduledReports=[ScheduledReportSchema.from_orm(r) for r in scheduled],
        recentDownloads=[RecentDownloadRow.from_orm(d) for d in downloads],
    )


async def generate_report(env: str, body: GenerateReportRequest, db: AsyncSession) -> GenerateReportResponse:
    # This function is also DB-dependent and can be kept.
    ext  = "pdf" if body.exportFormat.upper() == "PDF" else "csv"
    name = f"{body.dataSource}_{body.template}_Audit.{ext}".replace(" ", "_")
    d = ReportDownloadRow(
        env=env, file_name=name, target_app_scope=body.dataSource,
        generated_at_label="Today", size_label="2.4 MB", download_url=f"/reports/download/{name}"
    )
    db.add(d)
    await db.commit()
    return GenerateReportResponse(success=True, message="Report generated.", download=RecentDownloadRow.from_orm(d))

# ... All Figma endpoints can remain as they are, since they call the abstracted `get_*` functions
async def get_figma_dashboard(env: str, db: AsyncSession) -> FigmaDashboardResponse:
    overview = await get_overview(env, db)
    api_mon  = await get_api_monitoring(env, db)
    failing   = [s.name for s in overview.microservices if s.status == "Failing"][:3]
    top_anoms = [f"{a.service}: {a.type}" for a in overview.systemAnomalies[:3]]
    ai_briefing = (f"Detected abnormal API consumption. Failing nodes: {', '.join(failing)}. Recent anomalies: {', '.join(top_anoms)}.")
    app_health: List[FigmaDashboardAppHealth] = []
    for row in api_mon.apiConsumptionByApp[:3]:
        status = "critical" if row.actual >= row.limit else "warning" if row.actual >= int(row.limit * 0.8) else "healthy"
        app_health.append(FigmaDashboardAppHealth(
            targetApp=row.app,
            currentLoadLabel=f"{row.actual:,} RPM",
            rateLimitLabel=f"Limit: {row.limit:,} RPM",
            status=status,
            actionLabel="Apply Hard Limit" if status == 'critical' else 'Isolate DB',
            tooltip=f"API request rate for {row.app} is {'over' if status != 'healthy' else 'within'} the limit."
        ))
    return FigmaDashboardResponse(aiBriefing=ai_briefing, appHealth=app_health)
