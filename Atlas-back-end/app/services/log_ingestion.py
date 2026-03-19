"""
services/log_ingestion.py — Local Log File Parser & Database Ingestion Engine

Architecture (v3 — Dynamic CSV + JSONL Ingestion):
═══════════════════════════════════════════════════════════════════════════════
REFACTOR SUMMARY
────────────────
This module retains its original JSONL-based ingestion pipeline (which feeds
PostgreSQL for stateful data) and gains two new capabilities:

1. Dynamic CSV Discovery  — ingest_loghub_csvs() recursively scans
   data/logs/**/*_structured.csv and converts every discovered CSV row
   into an EndpointLog or NetworkLog ORM record.  No filename or directory
   is hardcoded.

2. Dynamic Severity Mapping  — _map_csv_level_to_severity() maps raw log
   level strings from any Loghub CSV (FATAL, ERROR, WARN, INFO, DEBUG,
   notice, error, emerg, …) to the standardised severity values used by the
   Pydantic schemas and the new modular services: Critical / High / Medium / Low / Info.

JSONL ingestion (Steps 1-7 in ingest_all_logs) is unchanged — PostgreSQL
tables for network_logs, api_logs, endpoint_logs, etc. are still populated
from their respective *.jsonl files.  The CSV pipeline supplements this with
additional structured-log records that the Pandas query layer can use even
when JSONL files are sparse or missing.

Log file locations (relative to project root):
  data/logs/network_logs.jsonl      ← stateful DB ingestion (unchanged)
  data/logs/api_logs.jsonl
  data/logs/endpoint_logs.jsonl
  data/logs/db_activity_logs.jsonl
  data/logs/incidents.jsonl
  data/logs/alerts.jsonl
  data/logs/<Service>/*_structured.csv  ← new: CSV bulk ingestion
═══════════════════════════════════════════════════════════════════════════════
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_log_data_dir, get_settings
from app.models.db_models import (
    Alert,
    ApiLog,
    DbActivityLog,
    EndpointLog,
    Incident,
    NetworkLog,
)

logger = logging.getLogger(__name__)

# ─── Path constant (mirrors log_loader.py structure) ──────────────────────────
_LOG_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "logs"


# ═══════════════════════════════════════════════════════════════════════════════
# ▌PART 1 — Dynamic Severity Mapping
# ═══════════════════════════════════════════════════════════════════════════════

# Comprehensive map covering every level token found across the full Loghub
# corpus plus Apache/syslog variants.
_LEVEL_TO_SEVERITY: Dict[str, str] = {
    # Highest severity
    "fatal":     "Critical",
    "critical":  "Critical",
    "emerg":     "Critical",
    "emergency": "Critical",
    "panic":     "Critical",
    "alert":     "Critical",   # syslog ALERT (above CRIT)
    # Error class
    "error":     "High",
    "err":       "High",
    "crit":      "High",       # syslog CRIT
    "severe":    "High",       # BGL supercomputer
    # Warning class
    "warn":      "Medium",
    "warning":   "Medium",
    # Informational
    "notice":    "Low",
    "info":      "Low",
    "information": "Low",
    # Debug / trace
    "debug":     "Info",
    "trace":     "Info",
    "verbose":   "Info",
    "fine":      "Info",
    "finer":     "Info",
    "finest":    "Info",
    # Numeric syslog levels (0 = most severe)
    "0": "Critical", "1": "Critical", "2": "Critical",
    "3": "High",     "4": "High",
    "5": "Medium",
    "6": "Low",      "7": "Info",
}


def _map_csv_level_to_severity(raw_level: Any) -> str:
    """
    Convert a raw CSV 'Level' field value to a standardised severity string.

    Accepts any type — returns 'Info' for None / empty / unrecognised values.
    """
    if raw_level is None or (isinstance(raw_level, float)):
        return "Info"
    return _LEVEL_TO_SEVERITY.get(str(raw_level).strip().lower(), "Info")


# ═══════════════════════════════════════════════════════════════════════════════
# ▌PART 2 — Low-level helpers (unchanged from v2)
# ═══════════════════════════════════════════════════════════════════════════════

def _read_jsonl(file_path: Path) -> List[Dict[str, Any]]:
    """
    Reads a JSON Lines file and returns a list of parsed dicts.
    Skips blank lines and malformed lines (logged as warnings).
    """
    if not file_path.exists():
        logger.warning("Log file not found, skipping: %s", file_path)
        return []

    records = []
    with open(file_path, "r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                logger.warning("Skipping malformed JSON at %s:%d — %s", file_path, line_no, exc)

    logger.info("Read %d records from %s", len(records), file_path.name)
    return records


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_bool(val: Any, default: bool = False) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ("true", "1", "yes")
    return default


# ═══════════════════════════════════════════════════════════════════════════════
# ▌PART 3 — Dynamic CSV Discovery & Bulk Ingestion
# ═══════════════════════════════════════════════════════════════════════════════

# Which CSV source directories map to which telemetry domain.
# This drives which ORM model is used when bulk-ingesting CSVs.
_NETWORK_DIRS  = {"openssh", "hdfs", "hadoop", "zookeeper", "bgl", "proxifier"}
_ENDPOINT_DIRS = {"linux", "windows", "mac", "android", "healthapp", "thunderbird"}
# All remaining directories default to EndpointLog (safest schema)

# OS label map for the OS-distribution chart in Endpoint Security page
_DIR_TO_OS: Dict[str, str] = {
    "linux":       "Linux (Ubuntu/Fedora)",
    "windows":     "Windows 10/11",
    "mac":         "macOS",
    "android":     "Android",
    "healthapp":   "Mobile (iOS/Android)",
    "thunderbird": "Linux (Desktop)",
}

# # Synthetic enterprise apps — cycling assignment so every row gets a value
# _TARGET_APPS = [
#     "Naukri Portal", "GenAI Service", "Flipkart DB", "Payment-GW",
#     "Auth-Svc", "Shipping-API", "IP-Intel-API", "Product-Catalog",
# ]
# _SUSPICIOUS_IPS = [
#     "185.220.101.45", "91.108.4.177", "45.33.32.156", "198.51.100.22",
#     "203.0.113.78",   "159.89.49.123", "194.165.16.11", "116.203.90.41",
# ]
# _INTERNAL_IPS = [
#     "10.0.1.42", "10.0.2.15", "10.0.3.88", "192.168.1.101",
#     "192.168.1.202", "192.168.2.10", "172.16.0.55", "172.16.1.12",
# ]
# _ANOMALY_TYPES = [
#     "SSH Brute Force Attack", "Port Scan Detected",
#     "Invalid User Authentication", "Possible Break-In Attempt",
#     "Data Exfiltration via SFTP", "Suspicious Outbound Connection",
# ]
# _WORKSTATION_POOL = [
#     "WKST-2088", "WKST-1523", "WKST-0741", "WKST-3391",
#     "LAPTOP-DEV-04", "LAPTOP-HR-02", "SRV-DB-02", "SRV-WEB-01",
# ]
# _EMPLOYEE_POOL = [
#     "sarah.smith", "john.doe", "mike.johnson", "admin_temp",
#     "priya.kumar", "raj.patel", "anita.singh", "dev.user01",
# ]
# _ALERT_MSGS = [
#     "Suspicious process detected (cryptominer.exe)",
#     "Unauthorized remote session established",
#     "Antivirus disabled by local user",
#     "Firewall policy bypassed",
#     "Unusual large file transfer outside business hours",
#     "USB storage device connected without authorization",
#     "Multiple failed login attempts from different locations",
#     "Ransomware-like file encryption activity detected",
# ]
# _ALERT_CATS = [
#     "Malware", "Policy Violation", "Unauthorized Access",
#     "Data Exfiltration", "Anomalous Behaviour", "Lateral Movement",
# ]
# _PORTS = [22, 443, 80, 3306, 5432, 8080, 6379, 27017]


def _discover_structured_csvs() -> List[Tuple[str, str, Path]]:
    """
    Recursively scan _LOG_ROOT for every *_structured.csv file.

    Returns a list of (domain, dir_name, csv_path) tuples.
    Lock files (names starting with '.') are excluded.

    domain is one of: "network", "endpoint", "api", "other"
    """
    if not _LOG_ROOT.exists():
        logger.warning("Log root directory not found: %s", _LOG_ROOT)
        return []

    results: List[Tuple[str, str, Path]] = []
    for csv_path in sorted(_LOG_ROOT.rglob("*_structured.csv")):
        if csv_path.name.startswith("."):
            continue
        dir_name = csv_path.parent.name.lower()
        if dir_name in _NETWORK_DIRS:
            domain = "network"
        elif dir_name in _ENDPOINT_DIRS:
            domain = "endpoint"
        else:
            domain = "other"   # Apache, Spark, OpenStack, HPC, etc.
        results.append((domain, dir_name, csv_path))

    logger.info(
        "CSV discovery: found %d structured CSV files under %s", len(results), _LOG_ROOT
    )
    return results


def _csv_row_to_network_log(
    row: pd.Series,
    line_id: int,
    dir_name: str,
) -> NetworkLog:
    """
    Convert a single CSV row from a network-domain source to a NetworkLog ORM object.
    Synthesises all required columns that are not present in raw CSV data.
    """
    severity = _map_csv_level_to_severity(row.get("Level", ""))

    # Try to extract a real source IP from the Content field
    content = str(row.get("Content", ""))
    import re as _re
    ip_hits = _re.findall(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b", content)
    source_ip = ip_hits[0] if ip_hits else _SUSPICIOUS_IPS[line_id % len(_SUSPICIOUS_IPS)]
    dest_ip   = _INTERNAL_IPS[line_id % len(_INTERNAL_IPS)]

    app          = _TARGET_APPS[line_id % len(_TARGET_APPS)]
    port         = _PORTS[line_id % len(_PORTS)]
    anomaly_type = _ANOMALY_TYPES[line_id % len(_ANOMALY_TYPES)]

    # Escalate anomaly type for higher severities
    if severity == "Critical":
        anomaly_type = "SSH Brute Force Attack"
    elif severity == "High":
        anomaly_type = "Possible Break-In Attempt"

    env = "cloud" if line_id % 2 == 0 else "local"

    # Build a lightweight raw_payload from the CSV row
    raw = {k: v for k, v in row.items() if pd.notna(v) and v != ""}
    raw.update({"_source": dir_name, "_csv_ingested": True})

    timestamp = ""
    for tcol in ("Time", "Date", "timestamp"):
        if tcol in row and row[tcol]:
            timestamp = str(row[tcol])
            break

    return NetworkLog(
        env=env,
        source_ip=source_ip,
        dest_ip=dest_ip,
        app=app,
        port=port,
        anomaly_type=anomaly_type,
        bandwidth_pct=line_id % 80 + 20,
        active_connections=line_id % 950 + 50,
        dropped_packets=line_id % 500,
        timestamp=timestamp,
        raw_payload=raw,
    )


def _csv_row_to_endpoint_log(
    row: pd.Series,
    line_id: int,
    dir_name: str,
) -> EndpointLog:
    """
    Convert a single CSV row from an endpoint or api-domain source to an
    EndpointLog ORM object.  Synthesises required columns that are absent.
    """
    severity = _map_csv_level_to_severity(row.get("Level", ""))

    # Content field → alert message
    content = str(row.get("Content", "")).strip()
    if content:
        alert_message = (content[:120] + "…") if len(content) > 120 else content
    else:
        alert_message = _ALERT_MSGS[line_id % len(_ALERT_MSGS)]

    workstation_id = _WORKSTATION_POOL[line_id % len(_WORKSTATION_POOL)]
    employee       = _EMPLOYEE_POOL[line_id % len(_EMPLOYEE_POOL)]
    os_name        = _DIR_TO_OS.get(dir_name, "Linux (Other)")
    alert_category = _ALERT_CATS[line_id % len(_ALERT_CATS)]
    is_malware     = (line_id % 13 == 0)
    is_offline     = (line_id % 20 == 0)

    if is_malware:
        severity = "Critical"

    env = "cloud" if line_id % 2 == 0 else "local"

    raw = {k: v for k, v in row.items() if pd.notna(v) and v != ""}
    raw.update({"_source": dir_name, "_csv_ingested": True, "os_name": os_name})

    timestamp = ""
    for tcol in ("Time", "Date", "timestamp"):
        if tcol in row and row[tcol]:
            timestamp = str(row[tcol])
            break

    return EndpointLog(
        env=env,
        workstation_id=workstation_id,
        employee=employee,
        avatar="",
        alert_message=alert_message,
        alert_category=alert_category,
        severity=severity,
        os_name=os_name,
        is_offline=is_offline,
        is_malware=is_malware,
        timestamp=timestamp,
        raw_payload=raw,
    )


async def ingest_loghub_csvs(
    db: AsyncSession,
    batch_size: int = 500,
) -> Dict[str, int]:
    """
    Discover and ingest all *_structured.csv files from data/logs/ into
    PostgreSQL.

    • Network-domain CSVs → NetworkLog rows.
    • Endpoint/OS-domain CSVs → EndpointLog rows.
    • Other-domain CSVs (Apache, Spark, etc.) → EndpointLog rows (safest
      common schema).

    Uses batched inserts (default: 500 rows per commit) to avoid memory spikes
    on large CSV files.

    Returns a dict of csv_filename → rows_inserted for observability.

    This is called AFTER the standard JSONL ingestion so JSONL records always
    take precedence in the stateful PostgreSQL layer; the CSVs supplement the
    Pandas in-memory layer (via log_loader.py).

    To trigger CSV ingestion on startup add this after ingest_all_logs():
        await ingest_loghub_csvs(db)
    """
    discovered = _discover_structured_csvs()
    if not discovered:
        logger.info("No *_structured.csv files found — CSV ingestion skipped.")
        return {}

    stats: Dict[str, int] = {}

    for domain, dir_name, csv_path in discovered:
        try:
            df = pd.read_csv(csv_path, dtype=str).fillna("")
        except Exception as exc:
            logger.warning("Could not read %s: %s", csv_path, exc)
            stats[csv_path.name] = 0
            continue

        if df.empty:
            stats[csv_path.name] = 0
            continue

        # Normalise LineId
        if "LineId" in df.columns:
            df["LineId"] = pd.to_numeric(df["LineId"], errors="coerce").fillna(0).astype(int)
        else:
            df["LineId"] = range(1, len(df) + 1)

        inserted = 0
        batch: List[Any] = []

        for _, row in df.iterrows():
            line_id = int(row.get("LineId", 0))

            if domain == "network":
                obj = _csv_row_to_network_log(row, line_id, dir_name)
            else:
                # endpoint domain AND other/api domain → EndpointLog
                obj = _csv_row_to_endpoint_log(row, line_id, dir_name)

            batch.append(obj)

            if len(batch) >= batch_size:
                db.add_all(batch)
                await db.commit()
                inserted += len(batch)
                batch = []

        if batch:
            db.add_all(batch)
            await db.commit()
            inserted += len(batch)

        stats[csv_path.name] = inserted
        logger.info("CSV ingested: %s → %d rows (%s domain)", csv_path.name, inserted, domain)

    total = sum(stats.values())
    logger.info("CSV ingestion complete. Total rows: %d. Breakdown: %s", total, stats)
    return stats


# ═══════════════════════════════════════════════════════════════════════════════
# ▌PART 4 — Per-type JSONL parsers (unchanged from v2)
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_network_log(row: Dict[str, Any]) -> NetworkLog:
    return NetworkLog(
        env=row.get("env", "cloud"),
        source_ip=str(row.get("source_ip", "0.0.0.0")),
        dest_ip=str(row.get("dest_ip", "0.0.0.0")),
        app=str(row.get("app", "Unknown")),
        port=_safe_int(row.get("port", 0)),
        anomaly_type=str(row.get("anomaly_type", "Unknown")),
        bandwidth_pct=_safe_int(row.get("bandwidth_pct", 0)),
        active_connections=_safe_int(row.get("active_connections", 0)),
        dropped_packets=_safe_int(row.get("dropped_packets", 0)),
        timestamp=str(row.get("timestamp", "")),
        raw_payload=row,
    )


def _parse_api_log(row: Dict[str, Any]) -> ApiLog:
    return ApiLog(
        env=row.get("env", "cloud"),
        app=str(row.get("app", "Unknown")),
        path=str(row.get("path", "/")),
        method=str(row.get("method", "GET")),
        cost_per_call=_safe_float(row.get("cost_per_call", 0.0)),
        trend_pct=_safe_int(row.get("trend_pct", 0)),
        action=str(row.get("action", "OK")),
        calls_today=_safe_int(row.get("calls_today", 0)),
        blocked_count=_safe_int(row.get("blocked_count", 0)),
        avg_latency_ms=_safe_float(row.get("avg_latency_ms", 0.0)),
        estimated_cost=_safe_float(row.get("estimated_cost", 0.0)),
        hour_label=str(row.get("hour_label", "12am")),
        actual_calls=_safe_int(row.get("actual_calls", 0)),
        predicted_calls=_safe_int(row.get("predicted_calls", 0)),
        timestamp=str(row.get("timestamp", "")),
        raw_payload=row,
    )


def _parse_endpoint_log(row: Dict[str, Any]) -> EndpointLog:
    # Map JSONL severity through the standard mapper for consistency
    raw_sev = str(row.get("severity", "Low"))
    severity = _map_csv_level_to_severity(raw_sev) if raw_sev.lower() not in {
        "info", "low", "medium", "high", "critical"
    } else raw_sev

    return EndpointLog(
        env=row.get("env", "local"),
        workstation_id=str(row.get("workstation_id", "UNKNOWN")),
        employee=str(row.get("employee", "Unknown")),
        avatar=str(row.get("avatar", "")),
        alert_message=str(row.get("alert_message", "")),
        alert_category=str(row.get("alert_category", "Unknown")),
        severity=severity,
        os_name=str(row.get("os_name", "Unknown")),
        is_offline=_safe_bool(row.get("is_offline", False)),
        is_malware=_safe_bool(row.get("is_malware", False)),
        timestamp=str(row.get("timestamp", "")),
        raw_payload=row,
    )


def _parse_db_activity_log(row: Dict[str, Any]) -> DbActivityLog:
    return DbActivityLog(
        env=row.get("env", "cloud"),
        app=str(row.get("app", "Unknown")),
        db_user=str(row.get("db_user", "unknown")),
        query_type=str(row.get("query_type", "SELECT")),
        target_table=str(row.get("target_table", "unknown")),
        reason=str(row.get("reason", "")),
        is_suspicious=_safe_bool(row.get("is_suspicious", False)),
        active_connections=_safe_int(row.get("active_connections", 0)),
        avg_latency_ms=_safe_float(row.get("avg_latency_ms", 0.0)),
        data_export_volume_tb=_safe_float(row.get("data_export_volume_tb", 0.0)),
        hour_label=str(row.get("hour_label", "12am")),
        select_count=_safe_int(row.get("select_count", 0)),
        insert_count=_safe_int(row.get("insert_count", 0)),
        update_count=_safe_int(row.get("update_count", 0)),
        delete_count=_safe_int(row.get("delete_count", 0)),
        timestamp=str(row.get("timestamp", "")),
        raw_payload=row,
    )


def _parse_incident(row: Dict[str, Any]) -> Incident:
    return Incident(
        incident_id=str(row.get("incident_id", "")),
        env=row.get("env", "cloud"),
        event_name=str(row.get("event_name", "Unknown Event")),
        timestamp=str(row.get("timestamp", "")),
        severity=str(row.get("severity", "Medium")),
        source_ip=str(row.get("source_ip", "0.0.0.0")),
        dest_ip=str(row.get("dest_ip", "0.0.0.0")),
        target_app=str(row.get("target_app", "Unknown")),
        status=str(row.get("status", "Active")),
        event_details=str(row.get("event_details", "")),
        raw_payload=row,
    )


def _parse_alert(row: Dict[str, Any]) -> Alert:
    return Alert(
        alert_id=str(row.get("alert_id", "")),
        env=row.get("env", "cloud"),
        app=str(row.get("app", "Unknown")),
        message=str(row.get("message", "")),
        severity=str(row.get("severity", "Low")),
        timestamp_label=str(row.get("timestamp_label", "recently")),
        raw_payload=row,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# ▌PART 5 — Main Ingestion Orchestrator
# ═══════════════════════════════════════════════════════════════════════════════

# async def ingest_all_logs(db: AsyncSession) -> Dict[str, int]:
#     """
#     Orchestrates the full log ingestion pipeline:
#       1. Truncate all log tables (idempotent re-ingest pattern).
#       2. Read each JSONL file from data/logs/ → parse → bulk-insert into PG.
#       3. Optionally ingest discovered *_structured.csv files as supplementary
#          NetworkLog / EndpointLog records.

#     Returns a dict of table_name / csv_filename → records_inserted.
#     """
#     log_dir = get_log_data_dir()
#     stats: Dict[str, int] = {}

#     logger.info("Starting log ingestion from: %s", log_dir)

#     # ── Step 1: Clear existing data ───────────────────────────────────────────
#     tables_to_truncate = [
#         "network_logs", "api_logs", "endpoint_logs",
#         "db_activity_logs", "incidents", "alerts",
#     ]
#     # for tname in tables_to_truncate:
#         # await db.execute(text(f"TRUNCATE TABLE {tname} RESTART IDENTITY CASCADE"))
#     await db.commit()
#     logger.info("All log tables truncated for re-ingestion.")

#     # ── Step 2: Network logs ──────────────────────────────────────────────────
#     rows = _read_jsonl(log_dir / "network_logs.jsonl")
#     if rows:
#         network_objs = [_parse_network_log(r) for r in rows]
#         db.add_all(network_objs)
#         await db.commit()
#         stats["network_logs"] = len(network_objs)
#     else:
#         stats["network_logs"] = 0
#         logger.info("network_logs.jsonl empty or missing — will rely on CSV fallback.")

#     # ── Step 3: API logs ──────────────────────────────────────────────────────
#     rows = _read_jsonl(log_dir / "api_logs.jsonl")
#     if rows:
#         api_objs = [_parse_api_log(r) for r in rows]
#         db.add_all(api_objs)
#         await db.commit()
#         stats["api_logs"] = len(api_objs)
#     else:
#         stats["api_logs"] = 0
#         logger.info("api_logs.jsonl empty or missing — will rely on CSV fallback.")

#     # ── Step 4: Endpoint logs ─────────────────────────────────────────────────
#     rows = _read_jsonl(log_dir / "endpoint_logs.jsonl")
#     if rows:
#         endpoint_objs = [_parse_endpoint_log(r) for r in rows]
#         db.add_all(endpoint_objs)
#         await db.commit()
#         stats["endpoint_logs"] = len(endpoint_objs)
#     else:
#         stats["endpoint_logs"] = 0
#         logger.info("endpoint_logs.jsonl empty or missing — will rely on CSV fallback.")

#     # ── Step 5: DB activity logs ──────────────────────────────────────────────
#     rows = _read_jsonl(log_dir / "db_activity_logs.jsonl")
#     if rows:
#         db_objs = [_parse_db_activity_log(r) for r in rows]
#         db.add_all(db_objs)
#         await db.commit()
#         stats["db_activity_logs"] = len(db_objs)
#     else:
#         stats["db_activity_logs"] = 0

#     # ── Step 6: Incidents ─────────────────────────────────────────────────────
#     rows = _read_jsonl(log_dir / "incidents.jsonl")
#     if rows:
#         incident_objs = [_parse_incident(r) for r in rows]
#         db.add_all(incident_objs)
#         await db.commit()
#         stats["incidents"] = len(incident_objs)
#     else:
#         stats["incidents"] = 0

#     # ── Step 7: Alerts ────────────────────────────────────────────────────────
#     rows = _read_jsonl(log_dir / "alerts.jsonl")
#     if rows:
#         alert_objs = [_parse_alert(r) for r in rows]
#         db.add_all(alert_objs)
#         await db.commit()
#         stats["alerts"] = len(alert_objs)
#     else:
#         stats["alerts"] = 0

#     # ── Step 8: CSV bulk ingestion (Smarter Logic) ────────────────────────────
    
#     # Check if we already have a significant amount of "Real" data
#     async with db.begin():
#         network_count = (await db.execute(text("SELECT count(*) FROM network_logs"))).scalar()
#         endpoint_count = (await db.execute(text("SELECT count(*) FROM endpoint_logs"))).scalar()

#     # If the DB is mostly empty (less than 10 rows), bring in the CSVs to populate the charts.
#     # If Wazuh is actively feeding the DB, skip the CSVs to keep the data "Pure".
#     if network_count < 10 or endpoint_count < 10:
#         logger.info("Database appears low on data. Triggering CSV ingestion for demo stability.")
#         csv_stats = await ingest_loghub_csvs(db)
#         stats.update(csv_stats)
#     else:
#         logger.info(f"Active data detected (Net: {network_count}, End: {endpoint_count}). Skipping mock CSVs.")

#     total = sum(stats.values())
#     logger.info("Log ingestion complete. Total records: %d.", total)
#     return stats

async def ingest_all_logs(db: AsyncSession) -> Dict[str, int]:
    """
    MODIFIED FOR REAL DATA: 
    We no longer ingest mock JSONL or CSV files on startup.
    The database remains empty until real Wazuh/Velociraptor agents report in.
    """
    logger.info("REAL DATA MODE: Skipping mock JSONL and CSV ingestion.")
    
    # We return an empty stats dict because we are not 'injecting' anything manually.
    # The 'WazuhCollector' in main.py will handle real-time data flow.
    return {"real_mode_active": 1}

# ═══════════════════════════════════════════════════════════════════════════════
# ▌PART 6 — Live Velociraptor webhook handler (unchanged)
# ═══════════════════════════════════════════════════════════════════════════════

async def ingest_velociraptor_event(
    payload: Dict[str, Any],
    db: AsyncSession,
) -> Optional[EndpointLog]:
    """
    Processes a single live Velociraptor webhook event and persists it as
    an EndpointLog row.
    """
    artifact_name: str = payload.get("artifact", "Unknown")
    client_id: str = payload.get("client_id", "UNKNOWN")

    rows = payload.get("rows", [])
    if not rows:
        logger.warning("Velociraptor event from %s has no rows, skipping.", client_id)
        return None

    event_row = rows[0] if isinstance(rows[0], dict) else {}

    endpoint_log = EndpointLog(
        env="cloud",
        workstation_id=client_id,
        employee=event_row.get("Username", "N/A (Server)"),
        avatar="",
        alert_message=event_row.get("Message", artifact_name),
        alert_category=_classify_velociraptor_artifact(artifact_name),
        severity=event_row.get("Severity", "Medium"),
        os_name=event_row.get("OS", "Unknown"),
        is_offline=False,
        is_malware="malware" in artifact_name.lower() or "ransomware" in artifact_name.lower(),
        timestamp=payload.get("timestamp", ""),
        raw_payload=payload,
    )

    db.add(endpoint_log)
    await db.commit()
    await db.refresh(endpoint_log)
    logger.info("Velociraptor event persisted: %s / %s", client_id, artifact_name)
    return endpoint_log


def _classify_velociraptor_artifact(artifact_name: str) -> str:
    """Maps Velociraptor artifact names to ATLAS alert categories."""
    name = artifact_name.lower()
    if "brute" in name or "ssh" in name:
        return "SSH Brute Force"
    if "malware" in name or "yara" in name or "ransomware" in name:
        return "Malware"
    if "rootkit" in name or "diamorphine" in name:
        return "Rootkit Detected"
    if "network" in name or "connection" in name or "dns" in name:
        return "Anomalous outbound"
    if "policy" in name or "usb" in name or "removable" in name:
        return "Policy Violation"
    return "Anomalous Activity"
