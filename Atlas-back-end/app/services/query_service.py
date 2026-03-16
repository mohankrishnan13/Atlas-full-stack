"""
services/query_service.py — Dashboard Data Query Service (Pandas In-Memory Engine)

Architecture (v2 — Loghub CSV → Pandas Migration):
═══════════════════════════════════════════════════════════════════════════════
PostgreSQL is now ONLY consulted for stateful, mutable data:
  AtlasUser, UserSession, Application, Microservice, Incident,
  AppConfig, QuarantinedEndpoint, ScheduledReport, ReportDownload.

All telemetry (API logs, network anomalies, endpoint events, DB activity)
is served from Loghub _structured.csv files loaded into memory at startup.

Data flow:
  1.  App startup  →  LogStore.boot()  loads all CSVs once.
  2.  Each CSV is enriched with synthetic enterprise context columns
      (target_app, severity, source_ip, action, cost_per_call, …)
      using seeded-deterministic Pandas assignments so results are
      stable across restarts but look realistic.
  3.  Each row is tagged env="cloud" (even LineId) or env="local" (odd).
  4.  API handler calls  get_*(env, db)  →  LogStore filters by env
      →  Pandas aggregation  →  Pydantic schema.

Forward-compatibility with Elasticsearch / Wazuh:
  Replace the _build_*_df() loaders with ES client calls returning a
  DataFrame.  No routes, no schemas, no handlers change.
═══════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import logging
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
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
    AlertTypeDistribution,
    ApiConsumptionByApp,
    ApiMonitoringData,
    ApiRequestsByApp,
    ApiRoute,
    AppAnomaly,
    Application,
    AppConfigResponse,
    AppConfigUpdateRequest,
    CaseManagementCase,
    CaseManagementKpis,
    CaseManagementResponse,
    DbMonitoringData,
    DlpByTargetApp,
    EndpointSecurityData,
    FigmaAbusedEndpointRow,
    FigmaActiveMalwareRow,
    FigmaApiMitigationFeedRow,
    FigmaApiMonitoringResponse,
    FigmaApiOveruseByApp,
    FigmaDashboardAppHealth,
    FigmaDashboardResponse,
    FigmaDatabaseMonitoringResponse,
    FigmaDbExfiltrationRow,
    FigmaDbSuspiciousActivityRow,
    FigmaDbSuspiciousSourceRow,
    FigmaEndpointEventAction,
    FigmaEndpointEventRow,
    FigmaEndpointPolicyViolatorRow,
    FigmaEndpointSecurityResponse,
    FigmaEndpointVulnerableRow,
    FigmaHighAnomalyUserRow,
    FigmaNetworkAnomalyRow,
    FigmaNetworkTrafficResponse,
    FigmaTopConsumerRow,
    FigmaCriticalPolicyViolationRow,
    GenerateReportRequest,
    GenerateReportResponse,
    HeaderData,
    Incident as IncidentSchema,
    LiftQuarantineResponse,
    Microservice,
    NetworkAnomaly,
    NetworkTrafficData,
    OperationsByApp,
    OsDistribution,
    OverviewData,
    QuarantinedEndpointRow as QuarantinedEndpointSchema,
    QuarantinedEndpointsResponse,
    RecentAlert,
    RecentDownloadRow,
    ReportsOverviewResponse,
    ScheduledReportRow as ScheduledReportSchema,
    SuspiciousActivity,
    SystemAnomaly,
    TeamUser,
    User,
    WazuhEvent,
)

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

# Resolved relative to this file: app/services/ → app/ → project root → data/logs/
_LOG_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "logs"

# Enterprise context pools — seeded assignments keep results stable
_TARGET_APPS = [
    "Naukri Portal",
    "GenAI Service",
    "Flipkart DB",
    "Payment-GW",
    "Auth-Svc",
    "Shipping-API",
    "IP-Intel-API",
    "Product-Catalog",
]

_API_PATHS: Dict[str, List[str]] = {
    "Naukri Portal":    ["/api/jobs/search", "/api/profile/update", "/api/apply", "/api/resume/upload"],
    "GenAI Service":    ["/v1/chat/completions", "/v1/embeddings", "/v1/fine-tune", "/v1/images/generate"],
    "Flipkart DB":      ["/rpc/get_all_employees", "/rpc/export_orders", "/rpc/bulk_update", "/rpc/audit_log"],
    "Payment-GW":       ["/v1/charge", "/v1/refund", "/v1/payout", "/v1/dispute"],
    "Auth-Svc":         ["/v1/login", "/v1/token/refresh", "/v1/logout", "/v1/mfa/verify"],
    "Shipping-API":     ["/v1/rates", "/v1/track", "/v1/label/create", "/v1/pickup/schedule"],
    "IP-Intel-API":     ["/v1/check", "/v1/enrich", "/v1/blacklist/query", "/v1/geo"],
    "Product-Catalog":  ["/v2/products", "/v2/inventory", "/v2/pricing", "/v2/categories"],
}

_HTTP_METHODS = ["GET", "POST", "POST", "GET", "PUT", "DELETE"]  # weighted toward GET/POST

# Severity distribution: ~85 % Low/Info, ~10 % Medium, ~5 % High/Critical
_SEV_WEIGHTS = [0.50, 0.35, 0.10, 0.03, 0.02]
_SEVERITIES  = ["Info", "Low", "Medium", "High", "Critical"]

# API action distribution (mirrors pgAdmin screenshot)
_ACTION_WEIGHTS = [0.78, 0.14, 0.08]
_ACTIONS        = ["OK", "Rate-Limited", "Blocked"]

# Endpoint OS pool
_OS_POOL = [
    "Windows 11 Pro",
    "Windows 10 Enterprise",
    "Ubuntu 22.04 LTS",
    "macOS Sonoma 14",
    "macOS Ventura 13",
    "Fedora 39",
]

# Realistic hostnames for workstations
_WORKSTATION_POOL = [
    "WKST-2088", "WKST-1523", "WKST-0741", "WKST-3391",
    "LAPTOP-DEV-04", "LAPTOP-HR-02", "LAPTOP-FIN-07",
    "SRV-DB-02", "SRV-WEB-01", "SRV-API-03",
    "MAC-HR-02", "MAC-DEV-11", "MAC-EXEC-01",
]

# Realistic employee names
_EMPLOYEE_POOL = [
    "sarah.smith", "john.doe", "mike.johnson", "admin_temp",
    "priya.kumar", "raj.patel", "anita.singh", "dev.user01",
    "hr.manager", "finance.lead", "security.ops", "devops.eng",
]

# Alert messages for endpoint events
_ALERT_MESSAGES = [
    "Suspicious process detected (cryptominer.exe)",
    "Unauthorized remote session established",
    "Antivirus disabled by local user",
    "Firewall policy bypassed",
    "Unusual large file transfer outside business hours",
    "USB storage device connected without authorization",
    "Multiple failed login attempts from different locations",
    "Ransomware-like file encryption activity detected",
    "Known malicious domain contacted (C2 beacon)",
    "Privilege escalation attempt via sudo",
    "DLL side-loading detected in system32",
    "Keylogger activity pattern observed",
]

_ALERT_CATEGORIES = [
    "Malware", "Policy Violation", "Unauthorized Access",
    "Data Exfiltration", "Anomalous Behaviour", "Lateral Movement",
]

# Chart fill palette (matches frontend CSS vars)
_CHART_FILLS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
]

# Hour labels as seen in pgAdmin screenshot
_HOUR_LABELS = ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"]

# DB query types for synthesised database activity
_QUERY_TYPES  = ["SELECT", "INSERT", "UPDATE", "DELETE"]
_DB_USERS     = ["db_admin", "app_user", "report_svc", "etl_job", "finance_ro", "audit_user"]
_DB_TABLES    = [
    "users", "orders", "payments", "audit_log", "sessions",
    "products", "inventory", "employee_records", "salary_data",
]

# IP-like patterns for network logs (reused across rows via seeding)
_SUSPICIOUS_IPS = [
    "185.220.101.45", "91.108.4.177", "45.33.32.156", "198.51.100.22",
    "203.0.113.78",   "159.89.49.123", "194.165.16.11", "116.203.90.41",
    "162.55.32.100",  "51.15.88.202",  "89.248.172.16", "66.240.192.138",
]
_INTERNAL_IPS = [
    "10.0.1.42", "10.0.2.15", "10.0.3.88", "192.168.1.101",
    "192.168.1.202", "192.168.2.10", "172.16.0.55",  "172.16.1.12",
]
_NETWORK_APPS = [
    "GenAI Service", "Flipkart DB", "Naukri Portal",
    "Payment-GW", "Auth-Svc", "Shipping-API",
]
_ANOMALY_TYPES = [
    "SSH Brute Force Attack",
    "Port Scan Detected",
    "Invalid User Authentication",
    "Possible Break-In Attempt",
    "Repeated Authentication Failures",
    "Data Exfiltration via SFTP",
    "Lateral Movement – Credential Stuffing",
    "Suspicious Outbound Connection",
]
_PORTS = [22, 443, 80, 3306, 5432, 8080, 6379, 27017]

# ─── In-memory cache with TTL ─────────────────────────────────────────────────

_CACHE: Dict[str, Any] = {}
_CACHE_TTL_SECONDS = 300  # 5 minutes — reloads from disk if stale

def _cache_get(key: str) -> Any | None:
    entry = _CACHE.get(key)
    if entry and (time.monotonic() - entry["ts"] < _CACHE_TTL_SECONDS):
        return entry["val"]
    return None

def _cache_set(key: str, val: Any) -> None:
    _CACHE[key] = {"ts": time.monotonic(), "val": val}

def _cache_bust() -> None:
    """Force reload on next request — call after CSV hot-swap in dev."""
    _CACHE.clear()


def _invalidate_cache() -> None:
    """
    Public alias for _cache_bust.
    Called by main.py /admin/reload-cache BEFORE warm_cache() so the
    TTL check is skipped and CSVs are always re-read from disk.
    """
    _cache_bust()


# ═══════════════════════════════════════════════════════════════════════════════
# CSV Loaders  (one per telemetry domain)
# Each loader reads raw CSV → injects enterprise columns → tags env → caches.
# ═══════════════════════════════════════════════════════════════════════════════

def _csv(relative: str) -> Path:
    """Resolve a relative log path against _LOG_ROOT."""
    return _LOG_ROOT / relative


def _assign_env(df: pd.DataFrame) -> pd.DataFrame:
    """
    Rule 4 — Environment isolation.
    Even-indexed rows → 'cloud', odd-indexed rows → 'local'.
    Uses the raw LineId column so the split is deterministic.
    """
    df["env"] = np.where(df["LineId"] % 2 == 0, "cloud", "local")
    return df


def _assign_severity_weighted(df: pd.DataFrame, seed_col: str = "LineId") -> pd.DataFrame:
    """
    Rule 3 — Realistic severity distribution.
    ~85 % Info/Low, ~10 % Medium, ~5 % High/Critical.
    Uses LineId as a deterministic seed so rows always get the same severity.
    """
    rng = np.random.default_rng(42)
    df["severity"] = rng.choice(
        _SEVERITIES,
        size=len(df),
        p=_SEV_WEIGHTS,
    )
    return df


def _assign_target_app(df: pd.DataFrame) -> pd.DataFrame:
    """Deterministically map each row to an enterprise application."""
    df["target_app"] = [_TARGET_APPS[lid % len(_TARGET_APPS)] for lid in df["LineId"]]
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Apache  →  API / Overview telemetry
# ─────────────────────────────────────────────────────────────────────────────

def _build_api_df() -> pd.DataFrame:
    """
    Load Apache_2k.log_structured.csv and synthesise all columns that the
    pgAdmin api_logs table contained (visible in the attached screenshots):
      app, path, method, cost_per_call, trend_pct, action, calls_today,
      blocked_count, avg_latency_ms, estimated_cost, hour_label,
      actual_calls, predicted_calls, source_ip, target_app, severity, env.
    """
    cached = _cache_get("api_df")
    if cached is not None:
        return cached

    csv_path = _csv("Apache/Apache_2k.log_structured.csv")
    if not csv_path.exists():
        logger.warning("Apache CSV not found at %s — returning empty DataFrame", csv_path)
        return pd.DataFrame()

    df = pd.read_csv(csv_path, dtype=str).fillna("")
    df["LineId"] = pd.to_numeric(df["LineId"], errors="coerce").fillna(0).astype(int)

    # ── Core enrichment ───────────────────────────────────────────────────────
    df = _assign_env(df)
    df = _assign_severity_weighted(df)
    df = _assign_target_app(df)

    # app  = same as target_app (mirrors pgAdmin column)
    df["app"] = df["target_app"]

    # path — picked deterministically from target_app's path pool
    df["path"] = df.apply(
        lambda r: _API_PATHS[r["target_app"]][r["LineId"] % len(_API_PATHS[r["target_app"]])],
        axis=1,
    )

    # method — weighted toward GET / POST
    rng = np.random.default_rng(seed=7)
    df["method"] = rng.choice(_HTTP_METHODS, size=len(df), p=[0.4, 0.35, 0.10, 0.05, 0.05, 0.05])

    # cost_per_call — high-value apps cost more (mirrors screenshot: GenAI ≈ $0.025)
    _cost_map = {
        "GenAI Service":   0.025,
        "Payment-GW":      0.025,
        "Flipkart DB":     0.005,
        "Naukri Portal":   0.005,
        "Auth-Svc":        0.001,
        "Shipping-API":    0.005,
        "IP-Intel-API":    0.0005,
        "Product-Catalog": 0.0001,
    }
    df["cost_per_call"] = df["target_app"].map(_cost_map).fillna(0.001)

    # trend_pct — signed integer; mirrors screenshot values (-10 … +800)
    _trend_seed = np.random.default_rng(seed=13)
    trend_raw = _trend_seed.integers(-20, 30, size=len(df))
    # A small fraction get extreme values (blocked routes show +800 in screenshot)
    extreme_mask = (df["LineId"] % 50 == 0)
    trend_raw[extreme_mask.values] = _trend_seed.integers(100, 900, size=int(extreme_mask.sum()))
    df["trend_pct"] = trend_raw

    # action — weighted: 78 % OK, 14 % Rate-Limited, 8 % Blocked
    _act_rng = np.random.default_rng(seed=99)
    df["action"] = _act_rng.choice(_ACTIONS, size=len(df), p=_ACTION_WEIGHTS)

    # Override action for Critical/High severity rows to be Blocked/Rate-Limited
    df.loc[df["severity"] == "Critical", "action"] = "Blocked"
    df.loc[df["severity"] == "High", "action"] = "Rate-Limited"

    # calls_today / blocked_count — two tiers as seen in screenshot
    # Cloud "core" apps: ~1.2 M calls / 12 K blocked  |  local apps: ~45 K / 1.2 K
    is_cloud = df["env"] == "cloud"
    df["calls_today"] = np.where(is_cloud, 1_258_345, 45_678).astype(int)
    df["blocked_count"] = np.where(is_cloud, 12_456, 1_234).astype(int)

    # avg_latency_ms — proportional to cost (expensive = more compute)
    df["avg_latency_ms"] = (df["cost_per_call"] * 5_000).round(1)
    df.loc[df["avg_latency_ms"] < 12, "avg_latency_ms"] = 12.0

    # estimated_cost — calls_today × cost_per_call
    df["estimated_cost"] = (df["calls_today"] * df["cost_per_call"]).round(2)

    # hour_label — 8 fixed buckets cycling by LineId (matches screenshot exactly)
    df["hour_label"] = df["LineId"].apply(lambda x: _HOUR_LABELS[x % len(_HOUR_LABELS)])

    # actual_calls / predicted_calls for time-series charts
    base = df["calls_today"] // 8
    jitter = np.random.default_rng(seed=3).integers(-500, 500, size=len(df))
    df["actual_calls"]    = (base + jitter).clip(lower=0).astype(int)
    df["predicted_calls"] = (base * 0.9).astype(int)

    # source_ip — synthesised from suspicious + internal pool
    all_ips = _SUSPICIOUS_IPS + _INTERNAL_IPS
    df["source_ip"] = df["LineId"].apply(lambda x: all_ips[x % len(all_ips)])

    # Apache EventId → level signal (E3 = error, E2 = notice/warn, E1 = info)
    _apache_level_map = {"E3": "High", "E2": "Info", "E1": "Info", "E4": "Medium",
                          "E5": "Low",  "E6": "Low"}
    # Don't overwrite the already-weighted severity; use apache level only as a
    # nudge for the action column (E3/error events more likely blocked).
    apache_high = df["EventId"].isin(["E3", "E4"])
    df.loc[apache_high & (df["action"] == "OK"), "action"] = "Rate-Limited"

    _cache_set("api_df", df)
    logger.info("API DataFrame loaded: %d rows from %s", len(df), csv_path)
    return df


# ─────────────────────────────────────────────────────────────────────────────
# OpenSSH  →  Network Traffic telemetry
# ─────────────────────────────────────────────────────────────────────────────

_IP_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")

def _extract_ip(content: str, occurrence: int = 0) -> str:
    """Pull the Nth IP address from a free-text Content field."""
    hits = _IP_RE.findall(content or "")
    if hits and len(hits) > occurrence:
        return hits[occurrence]
    return ""


def _build_network_df() -> pd.DataFrame:
    """
    Load OpenSSH_2k.log_structured.csv and synthesise network anomaly columns:
      source_ip, dest_ip, app, port, anomaly_type, bandwidth_pct,
      active_connections, dropped_packets, target_app, severity, env.

    EventId → anomaly_type semantic mapping:
      E27 → Possible Break-In Attempt
      E13 → Invalid User Authentication
      E10 → Failed Password (Invalid User)
      E9  → Failed Password (Valid User)
      E19 → Authentication Failure
      E20 → Authentication Failure with user
      E2  → Connection Closed
      E24 → Disconnect (Bye Bye)
      Others → Suspicious Outbound Connection
    """
    cached = _cache_get("network_df")
    if cached is not None:
        return cached

    csv_path = _csv("OpenSSH/OpenSSH_2k.log_structured.csv")
    if not csv_path.exists():
        logger.warning("OpenSSH CSV not found at %s — returning empty DataFrame", csv_path)
        return pd.DataFrame()

    df = pd.read_csv(csv_path, dtype=str).fillna("")
    df["LineId"] = pd.to_numeric(df["LineId"], errors="coerce").fillna(0).astype(int)

    df = _assign_env(df)
    df = _assign_severity_weighted(df)
    df = _assign_target_app(df)

    # Map EventId → anomaly type
    _event_to_anomaly = {
        "E27": "Possible Break-In Attempt",
        "E13": "SSH Brute Force – Invalid User",
        "E10": "Failed Password for Invalid User",
        "E9":  "Failed Password Attack",
        "E19": "Authentication Failure",
        "E20": "Authentication Failure (user exposed)",
        "E14": "Repeated Root Login Failures",
        "E2":  "Connection Closed (preauth)",
        "E24": "Received Disconnect – Bye Bye",
        "E5":  "Too Many Auth Failures for Root",
        "E7":  "No Auth Method Available",
        "E21": "PAM Check Pass – User Unknown",
    }
    df["anomaly_type"] = df["EventId"].map(_event_to_anomaly).fillna("Suspicious Outbound Connection")

    # Override Critical/High rows with more alarming anomaly types
    df.loc[df["severity"] == "Critical", "anomaly_type"] = "SSH Brute Force Attack"
    df.loc[df["severity"] == "High",     "anomaly_type"] = "Possible Break-In Attempt"

    # source_ip — extract real IP from Content when present, fallback to pool
    df["source_ip"] = df["Content"].apply(lambda c: _extract_ip(c, 0))
    fallback_ips = df["source_ip"] == ""
    df.loc[fallback_ips, "source_ip"] = df.loc[fallback_ips, "LineId"].apply(
        lambda x: _SUSPICIOUS_IPS[x % len(_SUSPICIOUS_IPS)]
    )

    # dest_ip — always an internal address
    df["dest_ip"] = df["LineId"].apply(lambda x: _INTERNAL_IPS[x % len(_INTERNAL_IPS)])

    # app — use the network-specific app pool
    df["app"] = df["LineId"].apply(lambda x: _NETWORK_APPS[x % len(_NETWORK_APPS)])

    # port — SSH-centric with variety
    df["port"] = df["LineId"].apply(lambda x: _PORTS[x % len(_PORTS)])

    # Override: if EventId is SSH-related, use port 22
    ssh_events = {"E27", "E13", "E10", "E9", "E19", "E20", "E14", "E2", "E24", "E5", "E7", "E21"}
    df.loc[df["EventId"].isin(ssh_events), "port"] = 22

    # KPI scalars — synthesised but realistic
    df["bandwidth_pct"]      = (df["LineId"] % 80 + 20).astype(int)  # 20–100 %
    df["active_connections"] = (df["LineId"] % 950 + 50).astype(int)
    df["dropped_packets"]    = (df["LineId"] % 500).astype(int)

    _cache_set("network_df", df)
    logger.info("Network DataFrame loaded: %d rows from %s", len(df), csv_path)
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Linux + Windows + Mac  →  Endpoint Security telemetry
# ─────────────────────────────────────────────────────────────────────────────

def _build_endpoint_df() -> pd.DataFrame:
    """
    Concatenate Linux, Windows, and Mac CSVs and synthesise all columns
    required by EndpointSecurityData and FigmaEndpointSecurityResponse:
      workstation_id, employee, avatar, alert_message, alert_category,
      os_name, is_offline, is_malware, severity, target_app, env.

    Source tagging:
      Linux  → Ubuntu/Fedora OS pool
      Windows → Windows 10/11 pool
      Mac    → macOS pool
    """
    cached = _cache_get("endpoint_df")
    if cached is not None:
        return cached

    sources = [
        ("Linux/Linux_2k.log_structured.csv",   ["Ubuntu 22.04 LTS", "Fedora 39"]),
        ("Windows/Windows_2k.log_structured.csv", ["Windows 11 Pro", "Windows 10 Enterprise"]),
        ("Mac/Mac_2k.log_structured.csv",         ["macOS Sonoma 14", "macOS Ventura 13"]),
    ]

    frames: List[pd.DataFrame] = []
    for rel_path, os_choices in sources:
        csv_path = _csv(rel_path)
        if not csv_path.exists():
            logger.warning("Endpoint CSV not found: %s", csv_path)
            continue
        sub = pd.read_csv(csv_path, dtype=str).fillna("")
        sub["LineId"] = pd.to_numeric(sub["LineId"], errors="coerce").fillna(0).astype(int)
        sub["_os_pool"] = str(os_choices)  # store as string for later use
        sub["os_name"] = sub["LineId"].apply(lambda x: os_choices[x % len(os_choices)])
        frames.append(sub)

    if not frames:
        return pd.DataFrame()

    df = pd.concat(frames, ignore_index=True)
    # Re-index LineId globally so env / app assignments don't clash
    df["LineId"] = range(1, len(df) + 1)

    df = _assign_env(df)
    df = _assign_severity_weighted(df)
    df = _assign_target_app(df)

    # workstation_id — cycling over realistic hostnames
    df["workstation_id"] = df["LineId"].apply(lambda x: _WORKSTATION_POOL[x % len(_WORKSTATION_POOL)])

    # employee — realistic username pool
    df["employee"] = df["LineId"].apply(lambda x: _EMPLOYEE_POOL[x % len(_EMPLOYEE_POOL)])

    # avatar — empty string (frontend uses initials fallback)
    df["avatar"] = ""

    # alert_message — Content field when available, else synthetic
    content_col = "Content" if "Content" in df.columns else None
    if content_col:
        df["alert_message"] = df[content_col].apply(
            lambda c: (c[:120] + "…") if c and len(c) > 120 else c
        )
        # Replace empty content with synthetic alert
        empty_mask = df["alert_message"].str.strip() == ""
        df.loc[empty_mask, "alert_message"] = df.loc[empty_mask, "LineId"].apply(
            lambda x: _ALERT_MESSAGES[x % len(_ALERT_MESSAGES)]
        )
    else:
        df["alert_message"] = df["LineId"].apply(lambda x: _ALERT_MESSAGES[x % len(_ALERT_MESSAGES)])

    # alert_category
    df["alert_category"] = df["LineId"].apply(lambda x: _ALERT_CATEGORIES[x % len(_ALERT_CATEGORIES)])

    # is_malware — ~8 % of rows
    df["is_malware"] = (df["LineId"] % 13 == 0).astype(bool)

    # is_offline — ~5 % of endpoints
    df["is_offline"] = (df["LineId"] % 20 == 0).astype(bool)

    # Escalate severity for malware rows
    df.loc[df["is_malware"], "severity"] = "Critical"

    # anomaly_score — used by high-anomaly-user widget (0–100)
    df["anomaly_score"] = (df["LineId"] % 60 + 40).astype(int)  # 40–99
    df.loc[df["severity"] == "Critical", "anomaly_score"] = (
        df.loc[df["severity"] == "Critical", "LineId"] % 10 + 90  # 90–99
    )
    df.loc[df["severity"] == "High", "anomaly_score"] = (
        df.loc[df["severity"] == "High", "LineId"] % 10 + 80  # 80–89
    )

    _cache_set("endpoint_df", df)
    logger.info("Endpoint DataFrame loaded: %d rows (Linux+Win+Mac)", len(df))
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Synthesised DB Activity  (no dedicated Loghub source; derived from Apache)
# ─────────────────────────────────────────────────────────────────────────────

def _build_db_df() -> pd.DataFrame:
    """
    Derive a DB-activity DataFrame from the Apache CSV by re-interpreting
    log events as database operations.  This keeps the system working without
    a dedicated DB-activity CSV while remaining easy to replace with a real
    source (e.g. pgAudit logs or a Wazuh index).
    """
    cached = _cache_get("db_df")
    if cached is not None:
        return cached

    api_df = _build_api_df()
    if api_df.empty:
        return pd.DataFrame()

    df = api_df[["LineId", "env", "severity", "target_app", "source_ip",
                 "hour_label", "calls_today", "avg_latency_ms", "EventId"]].copy()

    # Rename for DB context
    df["app"]          = df["target_app"]
    df["db_user"]      = df["LineId"].apply(lambda x: _DB_USERS[x % len(_DB_USERS)])
    df["query_type"]   = df["LineId"].apply(lambda x: _QUERY_TYPES[x % len(_QUERY_TYPES)])
    df["target_table"] = df["LineId"].apply(lambda x: _DB_TABLES[x % len(_DB_TABLES)])

    # is_suspicious — High/Critical severity + non-SELECT query
    df["is_suspicious"] = (
        df["severity"].isin(["High", "Critical"]) &
        df["query_type"].isin(["INSERT", "UPDATE", "DELETE"])
    )

    # reason — meaningful explanation
    _reasons = {
        "INSERT": "Bulk insert outside business hours from non-application user",
        "UPDATE": "Mass UPDATE with no WHERE clause detected",
        "DELETE": "Bulk DELETE on sensitive table — DLP alert triggered",
        "SELECT": "Unusual SELECT * on PII table from external IP",
    }
    df["reason"] = df["query_type"].map(_reasons)

    # Active connections / latency / export volume KPIs
    df["active_connections"]    = (df["calls_today"] // 1000).clip(upper=500).astype(int)
    df["avg_latency_ms"]        = df["avg_latency_ms"]
    df["data_export_volume_tb"] = (df["LineId"] % 10 * 0.1).round(2)

    # Operation counts per row — SELECT-heavy as expected
    df["select_count"] = (df["calls_today"] * 0.70).astype(int)
    df["insert_count"] = (df["calls_today"] * 0.15).astype(int)
    df["update_count"] = (df["calls_today"] * 0.10).astype(int)
    df["delete_count"] = (df["calls_today"] * 0.05).astype(int)

    _cache_set("db_df", df)
    logger.info("DB activity DataFrame derived: %d rows", len(df))
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Synthesised Alerts  (for Header notification bell)
# ─────────────────────────────────────────────────────────────────────────────

def _synth_alerts(env: str, limit: int = 10) -> List[RecentAlert]:
    """
    Derive recent alerts from the top-severity endpoint + network rows.
    Returns at most `limit` alerts for the notification bell.
    """
    ep = _build_endpoint_df()
    if ep.empty:
        return []

    df = ep[ep["env"] == env].copy()
    df = df[df["severity"].isin(["Critical", "High"])].sort_values("LineId").head(limit)

    alerts: List[RecentAlert] = []
    for i, row in enumerate(df.itertuples()):
        mins_ago = (i + 1) * 3
        ts_label = f"{mins_ago}m ago" if mins_ago < 60 else f"{mins_ago // 60}h ago"
        alerts.append(RecentAlert(
            id=f"ALERT-{row.LineId:05d}",
            app=row.target_app,
            message=row.alert_message[:100],
            severity=row.severity,
            timestamp=ts_label,
        ))
    return alerts


# ═══════════════════════════════════════════════════════════════════════════════
# Helper utilities
# ═══════════════════════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════════════════════
# Startup hook  — call from app lifespan to warm the cache
# ═══════════════════════════════════════════════════════════════════════════════

def warm_cache() -> None:
    """
    Pre-load all DataFrames into the in-memory cache.
    Call this from your FastAPI lifespan startup handler:

        from app.services.query_service import warm_cache

        @asynccontextmanager
        async def lifespan(app: FastAPI):
            warm_cache()
            yield

    If a CSV is missing the loader logs a warning and returns an empty
    DataFrame — the API still responds with empty-but-valid JSON.
    """
    logger.info("Warming Pandas log cache …")
    _build_api_df()
    _build_network_df()
    _build_endpoint_df()
    _build_db_df()
    logger.info("Cache warm — all DataFrames ready.")


# ═══════════════════════════════════════════════════════════════════════════════
# Header / Notification Bell
# ═══════════════════════════════════════════════════════════════════════════════

async def get_header_data(env: str, db: AsyncSession) -> HeaderData:
    user_row = (
        await db.execute(
            select(AtlasUser).where(AtlasUser.env == env).order_by(AtlasUser.id.asc()).limit(1)
        )
    ).scalars().first()

    # Fallback reads from Settings so the displayed email always matches
    # what was seeded — no more "analyst@atlas.local" phantom address.
    _fallback_email = get_settings().seed_analyst_email
    user = User(
        name=user_row.name   if user_row else "SOC Analyst",
        email=user_row.email if user_row else _fallback_email,
        avatar=user_row.avatar if user_row else "",
    )

    apps_rows = (
        await db.execute(
            select(ApplicationRow).where(ApplicationRow.env == env).order_by(ApplicationRow.id.asc())
        )
    ).scalars().all()
    applications = [Application(id=a.app_id, name=a.name) for a in apps_rows]

    # Alerts now come from Pandas, not from the deleted Alert table
    recent_alerts = _synth_alerts(env, limit=10)

    return HeaderData(user=user, applications=applications, recentAlerts=recent_alerts)


# ═══════════════════════════════════════════════════════════════════════════════
# Team Users  (Settings page — still PostgreSQL)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_team_users(env: str, db: AsyncSession) -> List[TeamUser]:
    rows = (
        await db.execute(
            select(AtlasUser).where(AtlasUser.env == env).order_by(AtlasUser.id.asc())
        )
    ).scalars().all()
    return [
        TeamUser(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            avatar=u.avatar or "",
            is_active=u.is_active,
            invite_pending=u.invite_pending,
        )
        for u in rows
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# Overview
# ═══════════════════════════════════════════════════════════════════════════════

async def get_overview(env: str, db: AsyncSession) -> OverviewData:
    """
    Assemble Overview page payload from:
      • Pandas API df  (request counts, error rate, cost risk)
      • Pandas endpoint df  (app anomaly counts)
      • PostgreSQL  (microservices topology, incidents)
    """
    api_df = _build_api_df()
    ep_df  = _build_endpoint_df()

    # Filter by env
    a = api_df[api_df["env"] == env] if not api_df.empty else pd.DataFrame()
    e = ep_df[ep_df["env"] == env]   if not ep_df.empty else pd.DataFrame()

    # ── KPIs ──────────────────────────────────────────────────────────────────
    api_requests = int(a["calls_today"].sum()) if not a.empty else 0

    active_alerts = int(
        (a["severity"].isin(["Critical", "High"])).sum()
    ) if not a.empty else 0

    total_calls = len(a)
    blocked     = int((a["action"] == "Blocked").sum()) if not a.empty else 0
    error_rate  = round((blocked / max(total_calls, 1)) * 100, 1)
    cost_risk   = min(10, int((blocked / max(total_calls, 1)) * 100))

    # ── App anomaly chart ──────────────────────────────────────────────────────
    if not e.empty:
        anom_counts = (
            e.groupby("target_app")
            .size()
            .reset_index(name="anomalies")
            .sort_values("anomalies", ascending=False)
            .head(8)
        )
        app_anomalies = [
            AppAnomaly(name=row["target_app"], anomalies=int(row["anomalies"]))
            for _, row in anom_counts.iterrows()
        ]
    else:
        app_anomalies = []

    # ── API requests by app bar chart ─────────────────────────────────────────
    if not a.empty:
        rpm_counts = (
            a.groupby("target_app")
            .size()
            .reset_index(name="requests")
            .sort_values("requests", ascending=False)
            .head(12)
        )
        api_requests_by_app = [
            ApiRequestsByApp(app=row["target_app"], requests=int(row["requests"]))
            for _, row in rpm_counts.iterrows()
        ]
    else:
        api_requests_by_app = []

    # ── Microservices topology (PostgreSQL) ───────────────────────────────────
    svc_rows = (
        await db.execute(
            select(MicroserviceRow).where(MicroserviceRow.env == env).order_by(MicroserviceRow.id.asc())
        )
    ).scalars().all()
    microservices = [
        Microservice(
            id=s.service_id,
            name=s.name,
            type="Gateway" if "gateway" in s.name.lower() else "Service",
            status=s.status,
            position={"top": s.position_top, "left": s.position_left},
            connections=[c for c in (s.connections_csv or "").split(",") if c],
        )
        for s in svc_rows
    ]

    # ── System anomalies from Incidents table (PostgreSQL) ────────────────────
    inc_result = await db.execute(
        select(Incident)
        .where(Incident.env == env, Incident.status.in_(["Active", "Contained"]))
        .order_by(Incident.timestamp.desc())
        .limit(5)
    )
    incidents = inc_result.scalars().all()
    system_anomalies = [
        SystemAnomaly(
            id=inc.incident_id,
            service=inc.target_app,
            type=inc.event_name,
            severity=inc.severity,
            timestamp=inc.timestamp,
        )
        for inc in incidents
    ]

    # ── Failing endpoints map ─────────────────────────────────────────────────
    failing_endpoints: Dict[str, str] = {}
    if not a.empty:
        fe = (
            a[a["severity"].isin(["High", "Critical"])]
            .groupby("path")
            .size()
            .reset_index(name="cnt")
            .sort_values("cnt", ascending=False)
            .head(10)
        )
        for _, row in fe.iterrows():
            if row["cnt"] > 0:
                failing_endpoints[row["path"]] = str(int(row["cnt"]))

    return OverviewData(
        apiRequests=api_requests,
        errorRate=error_rate,
        activeAlerts=active_alerts,
        costRisk=cost_risk,
        appAnomalies=app_anomalies,
        microservices=microservices,
        failingEndpoints=failing_endpoints,
        apiRequestsByApp=api_requests_by_app,
        systemAnomalies=system_anomalies,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# API Monitoring
# ═══════════════════════════════════════════════════════════════════════════════

async def get_api_monitoring(env: str, db: AsyncSession) -> ApiMonitoringData:
    """Assemble API Monitoring page payload entirely from Pandas."""
    df = _build_api_df()
    if df.empty:
        return ApiMonitoringData(
            apiCallsToday=0, blockedRequests=0, avgLatency=0.0,
            estimatedCost=0.0, apiConsumptionByApp=[], apiRouting=[],
        )

    a = df[df["env"] == env]

    total     = int(a["calls_today"].sum())
    blocked   = int((a["action"] == "Blocked").sum())
    avg_lat   = float(a["avg_latency_ms"].mean().round(1))
    est_cost  = float(a["estimated_cost"].sum().round(2))

    # ── API consumption by app (bar chart: actual vs limit) ───────────────────
    agg = (
        a.groupby("target_app")
        .agg(actual=("calls_today", "mean"), limit_raw=("calls_today", "mean"))
        .reset_index()
    )
    # actual = mean calls today; limit = 120 % of actual (rate-limit headroom)
    agg["actual"] = agg["actual"].astype(int)
    agg["limit"]  = (agg["actual"] * 1.2).astype(int)
    # Apps with Blocked actions are over their limit
    blocked_apps = a[a["action"] == "Blocked"]["target_app"].unique()
    agg.loc[agg["target_app"].isin(blocked_apps), "limit"] = (
        agg.loc[agg["target_app"].isin(blocked_apps), "actual"] * 0.9
    ).astype(int)

    api_consumption = [
        ApiConsumptionByApp(app=row["target_app"], actual=int(row["actual"]), limit=int(row["limit"]))
        for _, row in agg.sort_values("actual", ascending=False).head(12).iterrows()
    ]

    # ── API routing table (deduplicated path × app) ───────────────────────────
    route_agg = (
        a.groupby(["target_app", "path"])
        .agg(
            method=("method", "first"),
            cost=("cost_per_call", "first"),
            trend=("trend_pct", "first"),
            action=("action", lambda x: x.mode()[0] if len(x) > 0 else "OK"),
        )
        .reset_index()
        .sort_values("cost", ascending=False)
        .head(50)
    )
    api_routing = [
        ApiRoute(
            id=i + 1,
            app=row["target_app"],
            path=row["path"],
            method=row["method"],
            cost=float(row["cost"]),
            trend=int(row["trend"]),
            action=row["action"],
        )
        for i, (_, row) in enumerate(route_agg.iterrows())
    ]

    return ApiMonitoringData(
        apiCallsToday=total,
        blockedRequests=blocked,
        avgLatency=avg_lat,
        estimatedCost=est_cost,
        apiConsumptionByApp=api_consumption,
        apiRouting=api_routing,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Network Traffic
# ═══════════════════════════════════════════════════════════════════════════════

async def get_network_traffic(env: str, db: AsyncSession) -> NetworkTrafficData:
    """Assemble Network Traffic page payload from the OpenSSH Pandas DataFrame."""
    df = _build_network_df()
    if df.empty:
        return NetworkTrafficData(bandwidth=0, activeConnections=0, droppedPackets=0, networkAnomalies=[])

    n = df[df["env"] == env]
    if n.empty:
        return NetworkTrafficData(bandwidth=0, activeConnections=0, droppedPackets=0, networkAnomalies=[])

    # KPI scalars — take values from first row (seeded so deterministic)
    first    = n.iloc[0]
    bw       = int(first["bandwidth_pct"])
    active   = int(n["active_connections"].mean())
    dropped  = int(n["dropped_packets"].sum())

    # Top anomaly rows — deduplicate by source_ip × app
    top_n = (
        n[n["severity"].isin(["Critical", "High", "Medium"])]
        .drop_duplicates(subset=["source_ip", "app"])
        .sort_values("severity", key=lambda s: s.map({"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}))
        .head(15)
    )

    anomalies = [
        NetworkAnomaly(
            id=i + 1,
            sourceIp=row["source_ip"],
            destIp=row["dest_ip"],
            app=row["app"],
            port=int(row["port"]),
            type=row["anomaly_type"],
        )
        for i, (_, row) in enumerate(top_n.iterrows())
    ]

    return NetworkTrafficData(
        bandwidth=bw,
        activeConnections=active,
        droppedPackets=dropped,
        networkAnomalies=anomalies,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Endpoint Security
# ═══════════════════════════════════════════════════════════════════════════════

async def get_endpoint_security(env: str, db: AsyncSession) -> EndpointSecurityData:
    """Assemble Endpoint Security page payload from Linux+Windows+Mac DataFrames."""
    df = _build_endpoint_df()
    if df.empty:
        return EndpointSecurityData(
            monitoredLaptops=0, offlineDevices=0, malwareAlerts=0,
            osDistribution=[], alertTypes=[], wazuhEvents=[],
        )

    e = df[df["env"] == env]

    monitored = int(e["workstation_id"].nunique())
    offline   = int(e["is_offline"].sum())
    malware   = int(e["is_malware"].sum())

    # OS distribution pie chart
    os_counts = (
        e.groupby("os_name").size().reset_index(name="value")
        .sort_values("value", ascending=False)
    )
    os_distribution = [
        OsDistribution(
            name=row["os_name"],
            value=int(row["value"]),
            fill=_CHART_FILLS[i % len(_CHART_FILLS)],
        )
        for i, (_, row) in enumerate(os_counts.iterrows())
    ]

    # Alert type distribution pie chart
    cat_counts = (
        e.groupby("alert_category").size().reset_index(name="value")
        .sort_values("value", ascending=False)
    )
    alert_types = [
        AlertTypeDistribution(
            name=row["alert_category"],
            value=int(row["value"]),
            fill=_CHART_FILLS[(i + 2) % len(_CHART_FILLS)],
        )
        for i, (_, row) in enumerate(cat_counts.iterrows())
    ]

    # Wazuh event log — top 10 by severity
    top_events = (
        e.sort_values(
            "severity",
            key=lambda s: s.map({"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}),
        )
        .head(10)
    )
    wazuh_events = [
        WazuhEvent(
            id=i + 1,
            workstationId=row["workstation_id"],
            employee=row["employee"],
            avatar=row["avatar"],
            alert=row["alert_message"],
            severity=row["severity"],
        )
        for i, (_, row) in enumerate(top_events.iterrows())
    ]

    return EndpointSecurityData(
        monitoredLaptops=monitored,
        offlineDevices=offline,
        malwareAlerts=malware,
        osDistribution=os_distribution,
        alertTypes=alert_types,
        wazuhEvents=wazuh_events,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Database Monitoring
# ═══════════════════════════════════════════════════════════════════════════════

async def get_db_monitoring(env: str, db: AsyncSession) -> DbMonitoringData:
    """Assemble DB Monitoring page payload from the synthesised DB DataFrame."""
    df = _build_db_df()
    if df.empty:
        return DbMonitoringData(
            activeConnections=0, avgQueryLatency=0.0, dataExportVolume=0.0,
            operationsByApp=[], dlpByTargetApp=[], suspiciousActivity=[],
        )

    d = df[df["env"] == env]
    if d.empty:
        return DbMonitoringData(
            activeConnections=0, avgQueryLatency=0.0, dataExportVolume=0.0,
            operationsByApp=[], dlpByTargetApp=[], suspiciousActivity=[],
        )

    active_connections = int(d["active_connections"].mean())
    avg_latency        = float(d["avg_latency_ms"].mean().round(1))
    export_volume      = float(d["data_export_volume_tb"].sum().round(2))

    # Operations by app
    ops_agg = (
        d.groupby("app")
        .agg(
            SELECT=("select_count", "sum"),
            INSERT=("insert_count", "sum"),
            UPDATE=("update_count", "sum"),
            DELETE=("delete_count", "sum"),
        )
        .reset_index()
    )
    ops_agg["total"] = ops_agg[["SELECT", "INSERT", "UPDATE", "DELETE"]].sum(axis=1)
    operations_by_app = [
        OperationsByApp(
            app=row["app"],
            SELECT=int(row["SELECT"]),
            INSERT=int(row["INSERT"]),
            UPDATE=int(row["UPDATE"]),
            DELETE=int(row["DELETE"]),
        )
        for _, row in ops_agg.sort_values("total", ascending=False).head(12).iterrows()
    ]

    # DLP / suspicious activity counts
    susp = d[d["is_suspicious"]]
    dlp_agg = (
        susp.groupby("app").size().reset_index(name="count")
        .sort_values("count", ascending=False)
    )
    dlp_by_target_app = [
        DlpByTargetApp(app=row["app"], count=int(row["count"]))
        for _, row in dlp_agg.iterrows()
    ]

    suspicious_activity = [
        SuspiciousActivity(
            id=i + 1,
            app=row["app"],
            user=row["db_user"],
            type=row["query_type"],
            table=row["target_table"],
            reason=row["reason"],
        )
        for i, (_, row) in enumerate(susp.head(25).iterrows())
    ]

    return DbMonitoringData(
        activeConnections=active_connections,
        avgQueryLatency=avg_latency,
        dataExportVolume=export_volume,
        operationsByApp=operations_by_app,
        dlpByTargetApp=dlp_by_target_app,
        suspiciousActivity=suspicious_activity,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Incidents  (PostgreSQL — stateful case management)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_incidents(env: str, db: AsyncSession) -> List[IncidentSchema]:
    result = await db.execute(
        select(Incident).where(Incident.env == env).order_by(Incident.timestamp.desc())
    )
    return [
        IncidentSchema(
            id=inc.incident_id,
            eventName=inc.event_name,
            timestamp=inc.timestamp,
            severity=inc.severity,
            sourceIp=inc.source_ip,
            destIp=inc.dest_ip,
            targetApp=inc.target_app,
            status=inc.status,
            eventDetails=inc.event_details,
        )
        for inc in result.scalars().all()
    ]


async def update_incident_status(
    incident_id: str, new_status: str, db: AsyncSession
) -> Optional[IncidentSchema]:
    result = await db.execute(select(Incident).where(Incident.incident_id == incident_id))
    inc = result.scalar_one_or_none()
    if not inc:
        return None
    inc.status = new_status
    await db.commit()
    await db.refresh(inc)
    return _to_incident_schema(inc)


def _to_incident_schema(inc: Incident) -> IncidentSchema:
    return IncidentSchema(
        id=inc.incident_id,
        eventName=inc.event_name,
        timestamp=inc.timestamp,
        severity=inc.severity,
        sourceIp=inc.source_ip,
        destIp=inc.dest_ip,
        targetApp=inc.target_app,
        status=inc.status,
        eventDetails=inc.event_details,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# App Config  (PostgreSQL)
# ═══════════════════════════════════════════════════════════════════════════════

async def _get_or_create_app_config(env: str, app_id: str, db: AsyncSession) -> AppConfigRow:
    existing = (
        await db.execute(
            select(AppConfigRow).where(AppConfigRow.env == env, AppConfigRow.app_id == app_id)
        )
    ).scalars().first()
    if existing:
        return existing
    cfg = AppConfigRow(env=env, app_id=app_id)
    db.add(cfg)
    await db.flush()
    return cfg


def _cfg_to_schema(cfg: AppConfigRow) -> AppConfigResponse:
    return AppConfigResponse(
        env=cfg.env,
        appId=cfg.app_id,
        warningAnomalyScore=cfg.warning_anomaly_score,
        criticalAnomalyScore=cfg.critical_anomaly_score,
        softRateLimitCallsPerMin=cfg.soft_rate_limit_calls_per_min,
        hardBlockThresholdCallsPerMin=cfg.hard_block_threshold_calls_per_min,
        autoQuarantineLaptops=cfg.auto_quarantine_laptops,
        trainingWindowDays=cfg.training_window_days,
        modelSensitivityPct=cfg.model_sensitivity_pct,
        autoUpdateBaselinesWeekly=cfg.auto_update_baselines_weekly,
        baselineModelName=cfg.baseline_model_name,
        baselineLastUpdatedAt=cfg.baseline_last_updated_at,
    )


async def get_app_config(env: str, app_id: str, db: AsyncSession) -> AppConfigResponse:
    return _cfg_to_schema(await _get_or_create_app_config(env, app_id, db))


async def update_app_config(
    env: str, app_id: str, body: AppConfigUpdateRequest, db: AsyncSession
) -> AppConfigResponse:
    cfg = await _get_or_create_app_config(env, app_id, db)
    data = body.model_dump(exclude_none=True)
    _field_map = {
        "warningAnomalyScore":          ("warning_anomaly_score",          int),
        "criticalAnomalyScore":         ("critical_anomaly_score",         int),
        "softRateLimitCallsPerMin":     ("soft_rate_limit_calls_per_min",  int),
        "hardBlockThresholdCallsPerMin":("hard_block_threshold_calls_per_min", int),
        "autoQuarantineLaptops":        ("auto_quarantine_laptops",        bool),
        "trainingWindowDays":           ("training_window_days",           int),
        "modelSensitivityPct":          ("model_sensitivity_pct",          int),
        "autoUpdateBaselinesWeekly":    ("auto_update_baselines_weekly",   bool),
        "baselineModelName":            ("baseline_model_name",            str),
    }
    for api_key, (db_attr, cast) in _field_map.items():
        if api_key in data:
            setattr(cfg, db_attr, cast(data[api_key]))
    db.add(cfg)
    await db.flush()
    return _cfg_to_schema(cfg)


# ═══════════════════════════════════════════════════════════════════════════════
# Quarantine  (PostgreSQL)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_quarantined_endpoints(
    env: str, app_id: str, db: AsyncSession
) -> QuarantinedEndpointsResponse:
    cfg = await _get_or_create_app_config(env, app_id, db)
    rows = (
        await db.execute(
            select(QuarantinedEndpointRow)
            .where(
                QuarantinedEndpointRow.env == env,
                QuarantinedEndpointRow.app_id == app_id,
                QuarantinedEndpointRow.status == "Active",
            )
            .order_by(QuarantinedEndpointRow.id.desc())
            .limit(50)
        )
    ).scalars().all()
    quarantined = [
        QuarantinedEndpointSchema(
            workstationId=r.workstation_id,
            user=r.user_name,
            timeQuarantined=r.quarantined_at,
            action="Lift Quarantine",
        )
        for r in rows
    ]
    return QuarantinedEndpointsResponse(
        autoQuarantineLaptops=cfg.auto_quarantine_laptops,
        quarantined=quarantined,
    )


async def lift_quarantine(
    env: str, app_id: str, workstation_id: str, db: AsyncSession
) -> LiftQuarantineResponse:
    row = (
        await db.execute(
            select(QuarantinedEndpointRow)
            .where(
                QuarantinedEndpointRow.env == env,
                QuarantinedEndpointRow.app_id == app_id,
                QuarantinedEndpointRow.workstation_id == workstation_id,
                QuarantinedEndpointRow.status == "Active",
            )
            .order_by(QuarantinedEndpointRow.id.desc())
            .limit(1)
        )
    ).scalars().first()
    if not row:
        return LiftQuarantineResponse(success=False, message="No active quarantine found for that workstation.")
    row.status = "Lifted"
    db.add(row)
    await db.flush()
    return LiftQuarantineResponse(success=True, message=f"Quarantine lifted for {workstation_id}.")


# ═══════════════════════════════════════════════════════════════════════════════
# Case Management  (PostgreSQL — stateful)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_case_management(env: str, db: AsyncSession) -> CaseManagementResponse:
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

    # ── Compute MTTR from real resolved_at timestamps ─────────────────────────
    # Pull all incidents that have both a timestamp (opened) and resolved_at
    # (closed) so we can compute a real mean time-to-resolve.
    closed_result = await db.execute(
        select(Incident.timestamp, Incident.resolved_at)
        .where(
            Incident.env == env,
            Incident.status == "Closed",
            Incident.resolved_at.isnot(None),
        )
        .limit(200)
    )
    closed_rows = closed_result.all()

    def _parse_iso(s: str) -> Optional[datetime]:
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None

    deltas_seconds = []
    for opened_str, resolved_str in closed_rows:
        opened   = _parse_iso(opened_str)   if opened_str   else None
        resolved = _parse_iso(resolved_str) if resolved_str else None
        if opened and resolved and resolved > opened:
            deltas_seconds.append((resolved - opened).total_seconds())

    if deltas_seconds:
        avg_s  = sum(deltas_seconds) / len(deltas_seconds)
        mins   = int(avg_s // 60)
        secs   = int(avg_s % 60)
        mttr_label = f"{mins}m {secs:02d}s"
    else:
        # No resolved incidents yet — show a clear "no data" label
        # rather than the old static "14m 22s" that was never real.
        mttr_label = "N/A"

    kpis = CaseManagementKpis(
        criticalOpenCases=int(row.critical or 0),
        mttr=mttr_label,
        unassignedEscalations=int(row.unassigned or 0),
    )

    incidents = (
        await db.execute(
            select(Incident).where(Incident.env == env).order_by(Incident.timestamp.desc()).limit(25)
        )
    ).scalars().all()

    cases: List[CaseManagementCase] = []
    for inc in incidents:
        raw       = inc.raw_payload if isinstance(inc.raw_payload, dict) else {}
        narrative = raw.get("aiThreatNarrative") or (
            f"Correlated Attack: External IP brute-forced the {inc.target_app} service, "
            "then triggered anomalous lateral movement activity."
        )
        assignee  = raw.get("assigneeName") or "Unassigned"
        initials  = "".join([p[0] for p in assignee.split()[:2]]).upper() if assignee != "Unassigned" else ""
        scope_tags = raw.get("scopeTags") if isinstance(raw.get("scopeTags"), list) else [inc.target_app]
        cases.append(CaseManagementCase(
            caseId=inc.incident_id,
            scopeTags=[str(x) for x in scope_tags if x],
            aiThreatNarrative=str(narrative),
            assigneeName=str(assignee),
            assigneeInitials=str(initials),
            status=inc.status,
            playbookActions=[
                "View AI Timeline",
                "Execute Total Lockdown Playbook",
                "Assign to Me",
                "Quarantine Endpoint & Drop MAC",
            ],
            targetApp=inc.target_app,
        ))

    return CaseManagementResponse(kpis=kpis, cases=cases)


# ═══════════════════════════════════════════════════════════════════════════════
# Reports  (PostgreSQL)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_reports_overview(env: str, db: AsyncSession) -> ReportsOverviewResponse:
    scheduled = (
        await db.execute(
            select(ScheduledReportRow)
            .where(ScheduledReportRow.env == env)
            .order_by(ScheduledReportRow.id.asc())
            .limit(50)
        )
    ).scalars().all()

    downloads = (
        await db.execute(
            select(ReportDownloadRow)
            .where(ReportDownloadRow.env == env)
            .order_by(ReportDownloadRow.id.desc())
            .limit(20)
        )
    ).scalars().all()

    return ReportsOverviewResponse(
        scheduledReports=[
            ScheduledReportSchema(
                id=r.id, title=r.title, description=r.description,
                schedule=r.schedule, active=bool(r.enabled), configureLabel="Configure",
            )
            for r in scheduled
        ],
        recentDownloads=[
            RecentDownloadRow(
                id=d.id, fileName=d.file_name, targetAppScope=d.target_app_scope,
                generated=d.generated_at_label, size=d.size_label, downloadUrl=d.download_url,
            )
            for d in downloads
        ],
    )


async def generate_report(env: str, body: GenerateReportRequest, db: AsyncSession) -> GenerateReportResponse:
    ext  = "pdf" if body.exportFormat.upper() == "PDF" else "csv"
    name = f"{body.dataSource}_{body.template}_Audit.{ext}".replace(" ", "_")
    d = ReportDownloadRow(
        env=env, file_name=name, target_app_scope=body.dataSource,
        generated_at_label="Today",
        size_label="2.4 MB" if ext == "pdf" else "1.8 MB",
        download_url=f"/reports/download/{name}",
    )
    db.add(d)
    await db.flush()
    return GenerateReportResponse(
        success=True,
        message="Report generated.",
        download=RecentDownloadRow(
            id=d.id, fileName=d.file_name, targetAppScope=d.target_app_scope,
            generated=d.generated_at_label, size=d.size_label, downloadUrl=d.download_url,
        ),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Figma Widget Endpoints  (pixel-perfect contracts)
# ═══════════════════════════════════════════════════════════════════════════════

async def get_figma_dashboard(env: str, db: AsyncSession) -> FigmaDashboardResponse:
    overview = await get_overview(env, db)
    api_mon  = await get_api_monitoring(env, db)

    failing   = [s.name for s in overview.microservices if s.status == "Failing"][:3]
    top_anoms = [f"{a.service}: {a.type}" for a in overview.systemAnomalies[:3]]
    ai_briefing = (
        "Detected abnormal API consumption on high-cost services. "
        + (f"Failing nodes: {', '.join(failing)}. " if failing else "")
        + (f"Recent anomalies: {', '.join(top_anoms)}." if top_anoms else "")
    )

    app_health: List[FigmaDashboardAppHealth] = []
    for row in api_mon.apiConsumptionByApp[:3]:
        if row.actual >= row.limit:
            status, action_label = "critical", "Apply Hard Limit"
        elif row.actual >= int(row.limit * 0.8):
            status, action_label = "warning", "Isolate DB"
        else:
            status, action_label = "healthy", "View Traffic"

        app_health.append(FigmaDashboardAppHealth(
            targetApp=row.app,
            currentLoadLabel=f"{row.actual:,} Requests per Minute",
            rateLimitLabel=f"Limit: {row.limit:,} Requests per Minute",
            status=status,
            actionLabel=action_label,
            tooltip=(
                f"This widget shows the current API request rate for {row.app} "
                "against its configured rate limit. A Critical status means the app "
                "is actively exceeding its limit — consider applying a hard block."
            ),
        ))
    return FigmaDashboardResponse(aiBriefing=ai_briefing, appHealth=app_health)


async def get_figma_api_monitoring(env: str, db: AsyncSession) -> FigmaApiMonitoringResponse:
    df = _build_api_df()
    if df.empty:
        return FigmaApiMonitoringResponse(
            totalApiCallsLabel="0", blockedThreatsLabel="0",
            globalAvailabilityLabel="100%", activeIncidentsLabel="0 Critical",
            apiOveruseByTargetApp=[], mostAbusedEndpoints=[],
            topConsumersByTargetApp=[], activeMitigationFeed=[],
        )

    a = df[df["env"] == env]

    total_calls = int(a["calls_today"].sum())
    blocked     = int((a["action"] == "Blocked").sum())

    # Active incidents still come from PostgreSQL
    active_incidents = int(
        (await db.execute(
            select(func.count(Incident.id)).where(
                Incident.env == env,
                Incident.severity.in_(["Critical", "High"]),
                Incident.status.in_(["Active", "Investigating", "Open"]),
            )
        )).scalar() or 0
    )

    api_mon = await get_api_monitoring(env, db)

    # ── API overuse (current RPM vs configured limit) ─────────────────────────
    overuse: List[FigmaApiOveruseByApp] = []
    for row in api_mon.apiConsumptionByApp[:8]:
        current_rpm  = row.actual
        limit_rpm    = row.limit
        baseline_rpm = int(limit_rpm * 0.6)
        spike_label  = (
            f"+{int(((current_rpm - baseline_rpm) / max(baseline_rpm, 1)) * 100)}%"
            if current_rpm > baseline_rpm else "Normal"
        )
        overuse.append(FigmaApiOveruseByApp(
            targetApp=row.app, currentRpm=current_rpm, limitRpm=limit_rpm,
            baselineRpm=baseline_rpm, spikeLabel=spike_label,
        ))

    # ── Most abused endpoints ─────────────────────────────────────────────────
    top_routes = sorted(
        api_mon.apiRouting,
        key=lambda r: (1 if r.action == "Blocked" else 0, abs(r.trend), r.cost),
        reverse=True,
    )[:8]

    abused: List[FigmaAbusedEndpointRow] = []
    for r in top_routes:
        if r.action == "Blocked":
            sev = "critical"
        elif r.trend >= 20:
            sev = "high"
        else:
            sev = "medium"
        abused.append(FigmaAbusedEndpointRow(
            endpoint=f"[{r.app}] {r.path}",
            violations=max(1, abs(int(r.trend)) * 50),
            severity=sev,
        ))

    # ── Top consumers ─────────────────────────────────────────────────────────
    consumer_agg = (
        a.groupby("source_ip")
        .agg(
            calls=("actual_calls", "sum"),
            cost=("estimated_cost", "sum"),
            app=("target_app", "first"),
        )
        .reset_index()
        .sort_values("calls", ascending=False)
        .head(8)
    )

    top_consumers: List[FigmaTopConsumerRow] = []
    for _, row in consumer_agg.iterrows():
        ip       = row["source_ip"]
        app_name = row["app"]
        calls    = int(row["calls"])
        cost     = float(row["cost"])
        is_over  = any(o.targetApp == app_name and o.currentRpm > o.limitRpm for o in overuse)
        if _is_external_ip(ip):
            a_type, a_label = "critical", "Revoke Key"
        elif is_over:
            a_type, a_label = "warning", "Throttle Limits"
        else:
            a_type, a_label = "neutral", "Audit Logs"
        top_consumers.append(FigmaTopConsumerRow(
            consumer=_format_external_ip(ip),
            targetApp=f"[{app_name}]",
            callsLabel=_k_label(calls),
            costLabel=_usd_label(cost),
            isOveruse=bool(is_over),
            actionLabel=a_label,
            actionType=a_type,
        ))

    # ── Mitigation feed ───────────────────────────────────────────────────────
    mitigation_feed: List[FigmaApiMitigationFeedRow] = []
    for r in top_routes[:4]:
        # Find the first matching source IP from the DataFrame
        match = a[a["target_app"] == r.app]["source_ip"]
        offender = _format_external_ip(match.iloc[0] if len(match) > 0 else "185.220.101.45")
        mitigation_feed.append(FigmaApiMitigationFeedRow(
            target=f"[{r.app}]",
            offender=offender,
            violation="Rate Limit Exceeded" if r.action != "OK" else "Schema Validation Fail",
            details=f"Trend {r.trend:+d}% — Cost/call: ${r.cost:.4f}",
            actionLabel="Enforce Hard Block" if r.action != "OK" else "Notify Team",
            actionColor="red" if r.action != "OK" else "blue",
        ))

    return FigmaApiMonitoringResponse(
        totalApiCallsLabel=_k_label(total_calls),
        blockedThreatsLabel=f"{blocked:,}",
        globalAvailabilityLabel=(
            # Availability = percentage of calls that were NOT blocked.
            # Clamped to [0, 100] and displayed to 2 decimal places.
            f"{max(0.0, min(100.0, round((1 - blocked / max(total_calls, 1)) * 100, 2))):.2f}%"
        ),
        activeIncidentsLabel=f"{active_incidents} Critical",
        apiOveruseByTargetApp=overuse,
        mostAbusedEndpoints=abused,
        topConsumersByTargetApp=top_consumers,
        activeMitigationFeed=mitigation_feed,
    )


async def get_figma_network_traffic(env: str, db: AsyncSession) -> FigmaNetworkTrafficResponse:
    df = _build_network_df()
    if df.empty:
        return FigmaNetworkTrafficResponse(activeAnomalies=[])

    n = df[df["env"] == env].sort_values(
        "severity",
        key=lambda s: s.map({"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}),
    ).head(50)

    rows: List[FigmaNetworkAnomalyRow] = []
    for _, row in n.iterrows():
        atype = str(row["anomaly_type"])
        if "scan" in atype.lower():
            controls = [{"label": "Drop Connection", "type": "warning"},
                        {"label": "Quarantine Laptop", "type": "critical"}]
        elif "ssh" in atype.lower() or "brute" in atype.lower():
            controls = [{"label": "Block Source IP", "type": "critical"},
                        {"label": "Trace IP Origin", "type": "trace"}]
        else:
            controls = [{"label": "Throttle Endpoint", "type": "orange"}]

        rows.append(FigmaNetworkAnomalyRow(
            timestamp=str(row.get("Time", ""))[-8:] or "—",
            source=_format_external_ip(str(row["source_ip"])),
            targetApp=str(row["app"]),
            port=str(int(row["port"])),
            anomalyType=atype,
            firewallBlockActive=(row["severity"] == "Low" and "block" in atype.lower()),
            controls=controls,
        ))
    return FigmaNetworkTrafficResponse(activeAnomalies=rows)


async def get_figma_endpoint_security(env: str, db: AsyncSession) -> FigmaEndpointSecurityResponse:
    df = _build_endpoint_df()
    if df.empty:
        return FigmaEndpointSecurityResponse(
            vulnerableEndpoints=[], policyViolators=[], activeMalware=[],
            criticalPolicyViolations=[], highAnomalyUsers=[], endpointEvents=[],
        )

    e = df[df["env"] == env]

    # ── Vulnerable endpoints (CVE count proxy = alert count per workstation) ──
    ws_counts = e.groupby("workstation_id").size().reset_index(name="cves")
    ws_top_issue = e.groupby("workstation_id")["alert_message"].first().reset_index()
    ws_merged = ws_counts.merge(ws_top_issue, on="workstation_id")

    vuln: List[FigmaEndpointVulnerableRow] = []
    for _, row in ws_merged.sort_values("cves", ascending=False).head(8).iterrows():
        cnt = int(row["cves"])
        risk = "Critical" if cnt >= 10 else "High" if cnt >= 7 else "Medium" if cnt >= 4 else "Low"
        vuln.append(FigmaEndpointVulnerableRow(
            workstationId=row["workstation_id"],
            cves=cnt,
            riskLevel=risk,
            topIssue=str(row["alert_message"])[:80],
        ))

    # ── Policy violators (violation count per employee) ───────────────────────
    user_v = e.groupby("employee").size().reset_index(name="violations")
    user_top = e.groupby("employee")["alert_message"].first().reset_index()
    user_merged = user_v.merge(user_top, on="employee")

    violators: List[FigmaEndpointPolicyViolatorRow] = []
    for _, row in user_merged.sort_values("violations", ascending=False).head(8).iterrows():
        violators.append(FigmaEndpointPolicyViolatorRow(
            user=row["employee"],
            violations=int(row["violations"]),
            topViolation=str(row["alert_message"])[:80],
        ))

    # ── Active malware ────────────────────────────────────────────────────────
    malware_rows: List[FigmaActiveMalwareRow] = [
        FigmaActiveMalwareRow(
            device=row["workstation_id"],
            threat=row["alert_message"][:100],
            actionLabel="Isolate Device",
        )
        for _, row in e[e["is_malware"]].head(5).iterrows()
    ]

    # ── Critical policy violations ────────────────────────────────────────────
    policy_kw = ["policy", "firewall", "antivirus", "disabled", "bypass"]
    policy_mask = e["alert_message"].str.lower().str.contains("|".join(policy_kw), na=False)
    policy_rows: List[FigmaCriticalPolicyViolationRow] = [
        FigmaCriticalPolicyViolationRow(
            device=row["workstation_id"],
            violation=row["alert_message"][:100],
            actionLabel="Force Enable",
        )
        for _, row in e[policy_mask].head(5).iterrows()
    ]

    # ── High anomaly users (score > 75) ──────────────────────────────────────
    user_scores = (
        e.groupby("employee")["anomaly_score"]
        .max()
        .reset_index()
        .sort_values("anomaly_score", ascending=False)
    )
    user_reason = (
        e.sort_values("anomaly_score", ascending=False)
        .drop_duplicates(subset=["employee"])
        .set_index("employee")["alert_message"]
    )

    high_anomaly_users: List[FigmaHighAnomalyUserRow] = [
        FigmaHighAnomalyUserRow(
            user=row["employee"],
            score=int(row["anomaly_score"]),
            reason=str(user_reason.get(row["employee"], "Multiple security alerts detected"))[:100],
        )
        for _, row in user_scores[user_scores["anomaly_score"] > 75].head(5).iterrows()
    ]

    # ── Endpoint event log ────────────────────────────────────────────────────
    top_events = (
        e.sort_values(
            "severity",
            key=lambda s: s.map({"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}),
        )
        .head(15)
    )
    events: List[FigmaEndpointEventRow] = []
    for i, (_, row) in enumerate(top_events.iterrows()):
        sev_norm = {"Critical": "critical", "High": "high"}.get(row["severity"], "warning")
        msg      = str(row["alert_message"]).lower()
        if "usb" in msg:
            actions = [FigmaEndpointEventAction(label="Lock USB Ports", actionType="Lock USB Ports")]
        elif "process" in msg or "malware" in msg or "cryptominer" in msg:
            actions = [
                FigmaEndpointEventAction(label="Kill Process",     actionType="Kill Process"),
                FigmaEndpointEventAction(label="Quarantine Device", actionType="Quarantine Device"),
                FigmaEndpointEventAction(label="Lock USB",         actionType="Lock USB Ports"),
            ]
        else:
            actions = [FigmaEndpointEventAction(label="Quarantine Device", actionType="Quarantine Device")]

        events.append(FigmaEndpointEventRow(
            id=str(i + 1),
            endpoint=row["workstation_id"],
            user=row["employee"],
            threat=row["alert_message"][:120],
            severity=sev_norm,
            timestamp=str(row.get("Time", ""))[-8:] or f"14:{i:02d}:{(i*7)%60:02d}",
            actions=actions,
        ))

    return FigmaEndpointSecurityResponse(
        vulnerableEndpoints=vuln,
        policyViolators=violators,
        activeMalware=malware_rows,
        criticalPolicyViolations=policy_rows,
        highAnomalyUsers=high_anomaly_users,
        endpointEvents=events,
    )


async def get_figma_database_monitoring(env: str, db: AsyncSession) -> FigmaDatabaseMonitoringResponse:
    data = await get_db_monitoring(env, db)

    # Exfiltration risk bar chart
    _colors = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#8b5cf6"]
    exfil = [
        FigmaDbExfiltrationRow(
            targetDb=row.app,
            volumeGb=float(row.count),
            color=_colors[i % len(_colors)],
        )
        for i, row in enumerate(data.dlpByTargetApp[:8])
    ]

    # Top suspicious query sources
    src_counts: Dict[str, int] = defaultdict(int)
    for s in data.suspiciousActivity:
        src_counts[s.user] += 1
    suspicious_sources = [
        FigmaDbSuspiciousSourceRow(name=name, queries=count)
        for name, count in sorted(src_counts.items(), key=lambda x: -x[1])[:8]
    ]

    suspicious_activity = [
        FigmaDbSuspiciousActivityRow(
            id=s.id,
            timestamp="—",
            actor=s.user,
            targetDb=s.app,
            targetTable=s.table,
            risk=f"{s.type}: {s.reason}",
        )
        for s in data.suspiciousActivity[:25]
    ]

    return FigmaDatabaseMonitoringResponse(
        dataExfiltrationRiskByDatabase=exfil,
        topSuspiciousQuerySources=suspicious_sources,
        suspiciousDbActivity=suspicious_activity,
    )
