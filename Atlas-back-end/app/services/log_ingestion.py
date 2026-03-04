"""
services/log_ingestion.py — Local Log File Parser & Database Ingestion Engine

This module is the bridge between raw log files on disk and the PostgreSQL
database that powers all dashboard API queries.

Architecture:
  - Each log file is JSONL (JSON Lines) format: one JSON object per line.
  - The ingestor is idempotent: re-running it clears old data and reloads,
    making it safe for development restarts. Set reingest_on_startup=False
    in .env to preserve data across restarts.
  - On startup, ingest_all_logs() is called from the FastAPI lifespan manager.
  - Future evolution: replace file reading with a Kafka consumer or syslog
    listener (see FUTURE_IMPLEMENTATION.md for the exact steps).

Log file locations (relative to project root):
  data/logs/network_logs.jsonl
  data/logs/api_logs.jsonl
  data/logs/endpoint_logs.jsonl
  data/logs/db_activity_logs.jsonl
  data/logs/incidents.jsonl
  data/logs/alerts.jsonl
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from sqlalchemy import delete, text
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


# ─── Low-level helpers ─────────────────────────────────────────────────────────

def _read_jsonl(file_path: Path) -> List[Dict[str, Any]]:
    """
    Reads a JSON Lines file and returns a list of parsed dicts.
    Skips blank lines and lines that fail to parse (logged as warnings).
    """
    if not file_path.exists():
        logger.warning(f"Log file not found, skipping: {file_path}")
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
                logger.warning(f"Skipping malformed JSON at {file_path}:{line_no} — {exc}")

    logger.info(f"Read {len(records)} records from {file_path.name}")
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


# ─── Per-type parsers ──────────────────────────────────────────────────────────

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
    return EndpointLog(
        env=row.get("env", "local"),
        workstation_id=str(row.get("workstation_id", "UNKNOWN")),
        employee=str(row.get("employee", "Unknown")),
        avatar=str(row.get("avatar", "")),
        alert_message=str(row.get("alert_message", "")),
        alert_category=str(row.get("alert_category", "Unknown")),
        severity=str(row.get("severity", "Low")),
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


# ─── Main Ingestion Orchestrator ───────────────────────────────────────────────

async def ingest_all_logs(db: AsyncSession) -> Dict[str, int]:
    """
    Orchestrates the full log ingestion pipeline:
      1. Truncate all log tables (idempotent re-ingest pattern).
      2. Read each JSONL file from data/logs/.
      3. Parse and bulk-insert into PostgreSQL.

    Returns a dict of table_name → records_inserted for observability.

    This is safe to call on every startup in development. In production,
    set reingest_on_startup=False and trigger ingestion via the background
    task scheduler instead (see FUTURE_IMPLEMENTATION.md).
    """
    log_dir = get_log_data_dir()
    stats: Dict[str, int] = {}

    logger.info(f"Starting log ingestion from: {log_dir}")

    # ── Step 1: Clear existing data ───────────────────────────────────────────
    # Using TRUNCATE ... RESTART IDENTITY for fast full-table clears.
    # In production with incremental ingestion, use upsert patterns instead.
    tables_to_truncate = [
        "network_logs", "api_logs", "endpoint_logs",
        "db_activity_logs", "incidents", "alerts"
    ]
    for tname in tables_to_truncate:
        await db.execute(
            text(f"TRUNCATE TABLE {tname} RESTART IDENTITY CASCADE")
        )
    await db.commit()
    logger.info("All log tables truncated for re-ingestion.")

    # ── Step 2: Ingest network logs ───────────────────────────────────────────
    rows = _read_jsonl(log_dir / "network_logs.jsonl")
    network_objs = [_parse_network_log(r) for r in rows]
    db.add_all(network_objs)
    await db.commit()
    stats["network_logs"] = len(network_objs)

    # ── Step 3: Ingest API logs ───────────────────────────────────────────────
    rows = _read_jsonl(log_dir / "api_logs.jsonl")
    api_objs = [_parse_api_log(r) for r in rows]
    db.add_all(api_objs)
    await db.commit()
    stats["api_logs"] = len(api_objs)

    # ── Step 4: Ingest endpoint logs ──────────────────────────────────────────
    rows = _read_jsonl(log_dir / "endpoint_logs.jsonl")
    endpoint_objs = [_parse_endpoint_log(r) for r in rows]
    db.add_all(endpoint_objs)
    await db.commit()
    stats["endpoint_logs"] = len(endpoint_objs)

    # ── Step 5: Ingest DB activity logs ──────────────────────────────────────
    rows = _read_jsonl(log_dir / "db_activity_logs.jsonl")
    db_objs = [_parse_db_activity_log(r) for r in rows]
    db.add_all(db_objs)
    await db.commit()
    stats["db_activity_logs"] = len(db_objs)

    # ── Step 6: Ingest incidents ──────────────────────────────────────────────
    rows = _read_jsonl(log_dir / "incidents.jsonl")
    incident_objs = [_parse_incident(r) for r in rows]
    db.add_all(incident_objs)
    await db.commit()
    stats["incidents"] = len(incident_objs)

    # ── Step 7: Ingest alerts (header feed) ───────────────────────────────────
    rows = _read_jsonl(log_dir / "alerts.jsonl")
    alert_objs = [_parse_alert(r) for r in rows]
    db.add_all(alert_objs)
    await db.commit()
    stats["alerts"] = len(alert_objs)

    total = sum(stats.values())
    logger.info(f"Log ingestion complete. Total records: {total}. Breakdown: {stats}")
    return stats


async def ingest_velociraptor_event(
    payload: Dict[str, Any],
    db: AsyncSession,
) -> EndpointLog:
    """
    Processes a single live Velociraptor webhook event and persists it
    as an EndpointLog row.

    This is the live equivalent of the JSONL ingestion above — same schema,
    same ORM model, but driven by a real-time webhook instead of a file.

    Called by: POST /webhooks/velociraptor (routes_webhooks.py)
    """
    artifact_name: str = payload.get("artifact", "Unknown")
    client_id: str = payload.get("client_id", "UNKNOWN")

    rows = payload.get("rows", [])
    if not rows:
        logger.warning(f"Velociraptor event from {client_id} has no rows, skipping.")
        return None

    # Use the first row as the primary event data
    event_row = rows[0] if isinstance(rows[0], dict) else {}

    endpoint_log = EndpointLog(
        env="cloud",   # Velociraptor is always the cloud/enterprise environment
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
    logger.info(f"Velociraptor event persisted: {client_id} / {artifact_name}")
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
