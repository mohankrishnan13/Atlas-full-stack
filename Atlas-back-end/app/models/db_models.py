"""
models/db_models.py — SQLAlchemy ORM Models (PostgreSQL)

Architecture:
  PostgreSQL is used for two categories of data:

  A) Stateful / mutable:
       AtlasUser, UserSession, Application, Microservice, AppConfig,
       QuarantinedEndpoint, Incident, AnomalyEvent, ScheduledReport,
       ReportDownload, S3IngestCursor, MitigationAuditLog

  B) Telemetry write-store (written by log_ingestion, ingest_loghub,
     and the new Simulator):
       NetworkLog, ApiLog, EndpointLog, DbActivityLog, Alert

  AnomalyEvent is the new table written exclusively by the Anomaly Engine
  background worker. It stores computed detections + Gemini AI explanations.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Float, ForeignKey,
    Index, Integer, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utcnow_dt() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# Telemetry Write-Store  (Category B)
# ─────────────────────────────────────────────────────────────────────────────

class NetworkLog(Base):
    """
    Network anomaly / intrusion detection events.
    Enriched with `bytes_transferred` and `detected_at` (native DateTime)
    for the anomaly engine's 5-minute window queries.
    """
    __tablename__ = "network_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Core classification
    env: Mapped[str] = mapped_column(String(16),  nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="Info", index=True)

    # Network identifiers
    source_ip: Mapped[str]  = mapped_column(String(64), nullable=False, default="")
    dest_ip: Mapped[str]    = mapped_column(String(64), nullable=False, default="")
    app: Mapped[str]        = mapped_column(String(256), nullable=False, default="Unknown")
    target_app: Mapped[str] = mapped_column(String(256), nullable=False, default="Unknown")
    port: Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    anomaly_type: Mapped[str] = mapped_column(String(256), nullable=False, default="Unknown")

    # KPI scalars
    bandwidth_pct: Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    active_connections: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dropped_packets: Mapped[int]    = mapped_column(Integer, nullable=False, default=0)

    # ── NEW: used by anomaly engine and simulator ──────────────────────────
    bytes_transferred: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # Native DateTime for efficient range queries (WHERE detected_at > NOW()-5min)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow_dt, index=True
    )

    # Loghub structured CSV fields (optional)
    line_id: Mapped[int]          = mapped_column(BigInteger, nullable=True)
    level: Mapped[str]            = mapped_column(String(32),  nullable=True)
    component: Mapped[str]        = mapped_column(String(256), nullable=True)
    content: Mapped[str]          = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]         = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str]   = mapped_column(Text,        nullable=True)

    timestamp: Mapped[str]    = mapped_column(String(64),  nullable=False, default="")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_network_logs_env_severity",  "env", "severity"),
        Index("ix_network_logs_source_ip",     "source_ip"),
        Index("ix_network_logs_detected_at",   "detected_at"),
    )


class ApiLog(Base):
    """
    API call telemetry — rate limiting, latency, cost.
    Enriched with `endpoint`, `status_code`, `response_time_ms`, and
    `logged_at` (native DateTime) for the anomaly engine's window queries.
    """
    __tablename__ = "api_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Core classification
    env: Mapped[str]        = mapped_column(String(16),  nullable=False, index=True)
    severity: Mapped[str]   = mapped_column(String(32),  nullable=False, default="Info", index=True)
    app: Mapped[str]        = mapped_column(String(256), nullable=False, default="Unknown")
    target_app: Mapped[str] = mapped_column(String(256), nullable=False, default="Unknown")
    source_ip: Mapped[str]  = mapped_column(String(64),  nullable=False, default="")

    # API metadata
    path: Mapped[str]   = mapped_column(String(512), nullable=False, default="/")
    method: Mapped[str] = mapped_column(String(16),  nullable=False, default="GET")
    action: Mapped[str] = mapped_column(String(64),  nullable=False, default="OK")

    # ── NEW: granular per-request fields for anomaly detection ────────────
    # `endpoint` mirrors `path` but is kept separately so old rows are intact
    endpoint: Mapped[str]         = mapped_column(String(512), nullable=False, default="/")
    status_code: Mapped[int]      = mapped_column(Integer,     nullable=False, default=200, index=True)
    response_time_ms: Mapped[float] = mapped_column(Float,     nullable=False, default=0.0)
    # Native DateTime for efficient range queries
    logged_at: Mapped[datetime]   = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow_dt, index=True
    )

    # Cost / rate metrics (existing)
    cost_per_call: Mapped[float]  = mapped_column(Float,   nullable=False, default=0.0)
    trend_pct: Mapped[int]        = mapped_column(Integer, nullable=False, default=0)
    calls_today: Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    blocked_count: Mapped[int]    = mapped_column(Integer, nullable=False, default=0)
    avg_latency_ms: Mapped[float] = mapped_column(Float,   nullable=False, default=0.0)
    estimated_cost: Mapped[float] = mapped_column(Float,   nullable=False, default=0.0)
    hour_label: Mapped[str]       = mapped_column(String(16), nullable=False, default="")
    actual_calls: Mapped[int]     = mapped_column(Integer, nullable=False, default=0)
    predicted_calls: Mapped[int]  = mapped_column(Integer, nullable=False, default=0)

    # Loghub structured CSV fields (optional)
    line_id: Mapped[int]        = mapped_column(BigInteger, nullable=True)
    level: Mapped[str]          = mapped_column(String(32),  nullable=True)
    component: Mapped[str]      = mapped_column(String(256), nullable=True)
    content: Mapped[str]        = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]       = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str] = mapped_column(Text,        nullable=True)

    timestamp: Mapped[str]    = mapped_column(String(64),  nullable=False, default="")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_api_logs_env_severity",  "env", "severity"),
        Index("ix_api_logs_env_action",    "env", "action"),
        Index("ix_api_logs_status_code",   "status_code"),
        Index("ix_api_logs_logged_at",     "logged_at"),
    )


class EndpointLog(Base):
    """
    Endpoint security events — workstation alerts, malware, policy violations.
    """
    __tablename__ = "endpoint_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    env: Mapped[str]      = mapped_column(String(16),  nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(32),  nullable=False, default="Low", index=True)

    workstation_id: Mapped[str] = mapped_column(String(128), nullable=False, default="UNKNOWN")
    employee: Mapped[str]       = mapped_column(String(128), nullable=False, default="Unknown")
    avatar: Mapped[str]         = mapped_column(String(512), nullable=False, default="")
    os_name: Mapped[str]        = mapped_column(String(128), nullable=False, default="Unknown")
    target_app: Mapped[str]     = mapped_column(String(256), nullable=False, default="Unknown")

    alert_message: Mapped[str]  = mapped_column(Text, nullable=False, default="")
    alert_category: Mapped[str] = mapped_column(String(128), nullable=False, default="Unknown")

    is_offline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_malware: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    line_id: Mapped[int]        = mapped_column(BigInteger, nullable=True)
    level: Mapped[str]          = mapped_column(String(32),  nullable=True)
    component: Mapped[str]      = mapped_column(String(256), nullable=True)
    content: Mapped[str]        = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]       = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str] = mapped_column(Text,        nullable=True)

    timestamp: Mapped[str]    = mapped_column(String(64),  nullable=False, default="")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_endpoint_logs_env_severity", "env", "severity"),
        Index("ix_endpoint_logs_env_malware",  "env", "is_malware"),
        Index("ix_endpoint_logs_workstation",  "workstation_id"),
    )


class DbActivityLog(Base):
    """Database operation audit logs."""
    __tablename__ = "db_activity_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    env: Mapped[str]        = mapped_column(String(16),  nullable=False, index=True)
    severity: Mapped[str]   = mapped_column(String(32),  nullable=False, default="Info", index=True)
    app: Mapped[str]        = mapped_column(String(256), nullable=False, default="Unknown")
    target_app: Mapped[str] = mapped_column(String(256), nullable=False, default="Unknown")

    db_user: Mapped[str]      = mapped_column(String(128), nullable=False, default="unknown")
    query_type: Mapped[str]   = mapped_column(String(32),  nullable=False, default="SELECT")
    target_table: Mapped[str] = mapped_column(String(256), nullable=False, default="unknown")
    reason: Mapped[str]       = mapped_column(Text, nullable=False, default="")
    is_suspicious: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)

    active_connections: Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    avg_latency_ms: Mapped[float]        = mapped_column(Float,   nullable=False, default=0.0)
    data_export_volume_tb: Mapped[float] = mapped_column(Float,   nullable=False, default=0.0)
    hour_label: Mapped[str]              = mapped_column(String(16), nullable=False, default="")

    select_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    insert_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    update_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delete_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    line_id: Mapped[int]        = mapped_column(BigInteger, nullable=True)
    level: Mapped[str]          = mapped_column(String(32),  nullable=True)
    component: Mapped[str]      = mapped_column(String(256), nullable=True)
    content: Mapped[str]        = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]       = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str] = mapped_column(Text,        nullable=True)

    timestamp: Mapped[str]    = mapped_column(String(64),  nullable=False, default="")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_db_activity_logs_env_severity",   "env", "severity"),
        Index("ix_db_activity_logs_env_suspicious", "env", "is_suspicious"),
    )


class Alert(Base):
    """Notification bell alerts."""
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    alert_id: Mapped[str]        = mapped_column(String(128), nullable=False, default="", index=True)
    env: Mapped[str]             = mapped_column(String(16),  nullable=False, index=True)
    app: Mapped[str]             = mapped_column(String(256), nullable=False, default="Unknown")
    message: Mapped[str]         = mapped_column(Text, nullable=False, default="")
    severity: Mapped[str]        = mapped_column(String(32),  nullable=False, default="Low", index=True)
    timestamp_label: Mapped[str] = mapped_column(String(128), nullable=False, default="recently")
    raw_payload: Mapped[dict]    = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_alerts_env_severity", "env", "severity"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# AnomalyEvent — written by the Anomaly Engine, displayed in Case Management
# ─────────────────────────────────────────────────────────────────────────────

class AnomalyEvent(Base):
    """
    A detected anomaly produced by the background Anomaly Engine worker.

    One row = one detected threshold breach. The engine computes metrics
    over the last 5 minutes of ApiLog / NetworkLog / EndpointLog data and
    writes here when a threshold is exceeded.

    `ai_explanation` is populated by the Google Gemini API immediately after
    detection. It contains a structured SOC analyst explanation including
    likely cause, attack vector, and 2 recommended mitigation steps.

    Lifecycle: 'Active' → 'Acknowledged' → 'Resolved'
    """
    __tablename__ = "anomaly_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # ── Classification ────────────────────────────────────────────────────
    env: Mapped[str]      = mapped_column(String(16),  nullable=False, index=True, default="cloud")
    anomaly_type: Mapped[str] = mapped_column(
        String(64), nullable=False, index=True
        # e.g. "HIGH_LATENCY" | "API_SPIKE" | "BRUTE_FORCE" | "NETWORK_SPIKE"
        #      "HIGH_ERROR_RATE" | "MALWARE_OUTBREAK" | "PORT_SCAN"
    )
    severity: Mapped[str] = mapped_column(
        String(16), nullable=False, default="High", index=True
        # "Critical" | "High" | "Medium" | "Low"
    )

    # ── Context ───────────────────────────────────────────────────────────
    target_app: Mapped[str]  = mapped_column(String(256), nullable=False, default="Unknown")
    source_ip: Mapped[str]   = mapped_column(String(64),  nullable=False, default="")
    endpoint: Mapped[str]    = mapped_column(String(512), nullable=False, default="")

    # Human-readable one-line description, e.g.:
    # "API spike: 1,243 req/min on /api/login (baseline 200)"
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # ── Metric snapshot (the raw numbers that triggered detection) ────────
    # Stored as JSONB so any shape of metrics can be persisted without migration
    # e.g. {"call_count": 1243, "error_rate": 0.47, "avg_latency_ms": 4200}
    metrics_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # ── AI Explanation (Gemini) ────────────────────────────────────────────
    # Full text of the Gemini SOC analyst response.
    # NULL until the Gemini call completes (async enrichment).
    ai_explanation: Mapped[str] = mapped_column(Text, nullable=True)

    # ── Lifecycle ─────────────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="Active", index=True
    )
    # Native DateTime for UI display and ordering
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow_dt, index=True
    )
    resolved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_anomaly_events_env_type",     "env", "anomaly_type"),
        Index("ix_anomaly_events_env_status",   "env", "status"),
        Index("ix_anomaly_events_env_severity", "env", "severity"),
        Index("ix_anomaly_events_detected_at",  "detected_at"),
        # GIN index for metrics_snapshot JSONB forensic queries
        Index("ix_anomaly_events_metrics",      "metrics_snapshot", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Mitigation Audit Log
# ─────────────────────────────────────────────────────────────────────────────

class MitigationAuditLog(Base):
    """Immutable audit trail for every SOC action triggered via the dashboard."""
    __tablename__ = "mitigation_audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    env: Mapped[str]           = mapped_column(String(16),  nullable=False, index=True)
    analyst_email: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    analyst_role: Mapped[str]  = mapped_column(String(32),  nullable=False, default="Analyst")

    action_type: Mapped[str]       = mapped_column(String(64),  nullable=False, index=True)
    target_identifier: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    outcome: Mapped[str]           = mapped_column(String(32),  nullable=False, default="success")
    details: Mapped[dict]          = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[str]        = mapped_column(String(64),  nullable=False, default=_utcnow, index=True)

    __table_args__ = (
        Index("ix_mitigation_audit_env_action", "env", "action_type"),
        Index("ix_mitigation_audit_analyst",    "analyst_email", "created_at"),
        Index("ix_mitigation_audit_jsonb",      "details", postgresql_using="gin"),
    )

# ─────────────────────────────────────────────────────────────────────────────
# BlockedEntity — Kill Switch ledger (enforced by AtlasMiddleware)
# ─────────────────────────────────────────────────────────────────────────────

class BlockedEntity(Base):
    """
    Persistent kill-switch ledger.

    The AtlasMiddleware reads this table (via an in-process cache that refreshes
    every 30 seconds) on every incoming request. If the request's source IP
    matches a row with entity_type='ip', or the request path matches a row with
    entity_type='route', the middleware returns 403 Forbidden immediately without
    forwarding the request to any route handler.

    entity_type values:
        'ip'    — blocks a source IP address (e.g. "203.0.113.42")
        'route' — blocks a URL path prefix  (e.g. "/api/v1/export")

    Rows are inserted by the kill-switch endpoints in routes_actions.py.
    Rows are soft-deleted (is_active=False) via POST /api-monitoring/unblock/{id}.
    """
    __tablename__ = "blocked_entities"

    id: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )

    # ── Classification ────────────────────────────────────────────────────────
    env: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True, default="cloud"
    )
    entity_type: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True
        # "ip" | "route"
    )

    # The actual value being blocked.
    # For entity_type='ip':    "203.0.113.42"
    # For entity_type='route': "/api/v1/export"  (prefix-matched by middleware)
    value: Mapped[str] = mapped_column(
        String(512), nullable=False, index=True
    )

    # Human-readable reason, shown in the kill-switch UI.
    reason: Mapped[str] = mapped_column(
        Text, nullable=False, default=""
    )

    # Who triggered the block and when.
    blocked_by: Mapped[str] = mapped_column(
        String(256), nullable=False, default="system"
    )
    blocked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow_dt, index=True
    )

    # Soft-delete: set to False to stop enforcement without losing audit history.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, index=True
    )

    __table_args__ = (
        Index("ix_blocked_entities_env_type",   "env", "entity_type"),
        Index("ix_blocked_entities_env_active",  "env", "is_active"),
        # Prevents the same value being blocked twice in the same env.
        Index("uq_blocked_entities_env_value",   "env", "value", unique=True),
    )

# ─────────────────────────────────────────────────────────────────────────────
# Application & Service Registry
# ─────────────────────────────────────────────────────────────────────────────

class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int]     = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]    = mapped_column(String(16),  nullable=False, index=True)
    app_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    name: Mapped[str]   = mapped_column(String(256), nullable=False)

    __table_args__ = (
        Index("uq_applications_env_app_id", "env", "app_id", unique=True),
    )


class Microservice(Base):
    __tablename__ = "microservices"

    id: Mapped[int]          = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]         = mapped_column(String(16),  nullable=False, index=True)
    service_id: Mapped[str]  = mapped_column(String(128), nullable=False, index=True)
    name: Mapped[str]        = mapped_column(String(256), nullable=False)
    status: Mapped[str]      = mapped_column(String(32),  nullable=False, default="Healthy")
    position_top: Mapped[str]  = mapped_column(String(16), nullable=False, default="50%")
    position_left: Mapped[str] = mapped_column(String(16), nullable=False, default="50%")
    connections_csv: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (
        Index("uq_microservices_env_service_id", "env", "service_id", unique=True),
    )


class AppConfig(Base):
    """Per-application security tuning parameters."""
    __tablename__ = "app_configs"

    id: Mapped[int]     = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]    = mapped_column(String(16),  nullable=False, index=True)
    app_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)

    warning_anomaly_score: Mapped[int]  = mapped_column(Integer, nullable=False, default=60)
    critical_anomaly_score: Mapped[int] = mapped_column(Integer, nullable=False, default=80)

    soft_rate_limit_calls_per_min: Mapped[int]     = mapped_column(Integer, nullable=False, default=800)
    hard_block_threshold_calls_per_min: Mapped[int] = mapped_column(Integer, nullable=False, default=3000)
    auto_quarantine_laptops: Mapped[bool]           = mapped_column(Boolean, nullable=False, default=True)

    training_window_days: Mapped[int]         = mapped_column(Integer, nullable=False, default=30)
    model_sensitivity_pct: Mapped[int]        = mapped_column(Integer, nullable=False, default=58)
    auto_update_baselines_weekly: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    baseline_model_name: Mapped[str]          = mapped_column(String(256), nullable=False, default="")
    baseline_last_updated_at: Mapped[str]     = mapped_column(String(64),  nullable=False, default=_utcnow)
    updated_at: Mapped[str]                   = mapped_column(String(64),  nullable=False, default=_utcnow)

    __table_args__ = (
        Index("uq_app_configs_env_app", "env", "app_id", unique=True),
    )


class QuarantinedEndpoint(Base):
    """Active quarantine ledger."""
    __tablename__ = "quarantined_endpoints"

    id: Mapped[int]             = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]            = mapped_column(String(16),  nullable=False, index=True)
    app_id: Mapped[str]         = mapped_column(String(128), nullable=False, index=True)
    workstation_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    user_name: Mapped[str]      = mapped_column(String(128), nullable=False, default="")
    quarantined_at: Mapped[str] = mapped_column(String(64),  nullable=False, default=_utcnow)
    lifted_at: Mapped[str]      = mapped_column(String(64),  nullable=True)
    status: Mapped[str]         = mapped_column(String(32),  nullable=False, default="Active", index=True)
    raw_payload: Mapped[dict]   = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_quarantined_endpoints_env_app",    "env", "app_id"),
        Index("ix_quarantined_endpoints_env_status", "env", "status"),
    )


class ScheduledReport(Base):
    """Report schedule definitions."""
    __tablename__ = "scheduled_reports"

    id: Mapped[int]               = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]              = mapped_column(String(16),  nullable=False, index=True)
    title: Mapped[str]            = mapped_column(String(256), nullable=False)
    description: Mapped[str]      = mapped_column(Text, nullable=False, default="")
    target_app_scope: Mapped[str] = mapped_column(String(256), nullable=False, default="All Sources")
    schedule: Mapped[str]         = mapped_column(String(128), nullable=False, default="Every Monday at 8:00 AM")
    template: Mapped[str]         = mapped_column(String(256), nullable=False, default="General Security Summary")
    export_format: Mapped[str]    = mapped_column(String(32),  nullable=False, default="PDF")
    enabled: Mapped[bool]         = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[str]       = mapped_column(String(64),  nullable=False, default=_utcnow)

    __table_args__ = (
        Index("ix_scheduled_reports_env_enabled", "env", "enabled"),
    )


class ReportDownload(Base):
    """Generated report download manifest."""
    __tablename__ = "report_downloads"

    id: Mapped[int]                = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]               = mapped_column(String(16),  nullable=False, index=True)
    file_name: Mapped[str]         = mapped_column(String(512), nullable=False)
    target_app_scope: Mapped[str]  = mapped_column(String(256), nullable=False, default="All Sources")
    generated_at_label: Mapped[str] = mapped_column(String(64), nullable=False, default="Today")
    size_label: Mapped[str]        = mapped_column(String(64),  nullable=False, default="0 KB")
    download_url: Mapped[str]      = mapped_column(String(1024), nullable=False, default="")
    created_at: Mapped[str]        = mapped_column(String(64),  nullable=False, default=_utcnow)

    __table_args__ = (
        Index("ix_report_downloads_env_created", "env", "created_at"),
    )


class AtlasUser(Base):
    """Unified user table — login, RBAC, MFA, profile."""
    __tablename__ = "atlas_users"

    id: Mapped[int]              = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]             = mapped_column(String(16),  nullable=False, index=True, default="cloud")
    email: Mapped[str]           = mapped_column(String(256), nullable=False, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    name: Mapped[str]            = mapped_column(String(128), nullable=False)
    role: Mapped[str]            = mapped_column(String(32),  nullable=False, default="Analyst")
    is_active: Mapped[bool]      = mapped_column(Boolean, nullable=False, default=True)
    phone: Mapped[str]           = mapped_column(String(64),  nullable=True)
    avatar: Mapped[str]          = mapped_column(String(512), nullable=True, default="")
    totp_enabled: Mapped[bool]   = mapped_column(Boolean, nullable=False, default=False)
    totp_secret: Mapped[str]     = mapped_column(String(128), nullable=True)
    invite_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[str]      = mapped_column(String(64),  nullable=False, default=_utcnow)

    sessions: Mapped[list["UserSession"]] = relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_atlas_users_role",      "role"),
        Index("uq_atlas_users_env_email", "env", "email", unique=True),
    )


class UserSession(Base):
    """Login session audit log."""
    __tablename__ = "user_sessions"

    id: Mapped[int]          = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int]     = mapped_column(
        Integer, ForeignKey("atlas_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ip_address: Mapped[str]  = mapped_column(String(64),  nullable=False, default="unknown")
    location: Mapped[str]    = mapped_column(String(128), nullable=False, default="Unknown")
    device_info: Mapped[str] = mapped_column(String(256), nullable=False, default="Unknown Device")
    status: Mapped[str]      = mapped_column(String(128), nullable=False, default="Success")
    logged_at: Mapped[str]   = mapped_column(String(64),  nullable=False, default=_utcnow)

    user: Mapped["AtlasUser"] = relationship("AtlasUser", back_populates="sessions")

    __table_args__ = (
        Index("ix_user_sessions_user_logged", "user_id", "logged_at"),
    )


class Incident(Base):
    """
    Security incident case.
    `resolved_at` is set when status transitions to 'Closed' — used for MTTR.
    """
    __tablename__ = "incidents"

    id: Mapped[int]             = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    incident_id: Mapped[str]    = mapped_column(String(64),  nullable=False, unique=True, index=True)
    env: Mapped[str]            = mapped_column(String(16),  nullable=False, index=True)
    line_id: Mapped[int]        = mapped_column(BigInteger,  nullable=True,  index=True)
    level: Mapped[str]          = mapped_column(String(32),  nullable=True)
    component: Mapped[str]      = mapped_column(String(128), nullable=True)
    content: Mapped[str]        = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]       = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str] = mapped_column(Text,        nullable=True)
    event_name: Mapped[str]     = mapped_column(String(512), nullable=False)
    timestamp: Mapped[str]      = mapped_column(String(64),  nullable=False)
    severity: Mapped[str]       = mapped_column(String(32),  nullable=False, index=True)
    source_ip: Mapped[str]      = mapped_column(String(64),  nullable=False)
    dest_ip: Mapped[str]        = mapped_column(String(64),  nullable=False)
    target_app: Mapped[str]     = mapped_column(String(256), nullable=False)
    status: Mapped[str]         = mapped_column(String(32),  nullable=False, default="Active", index=True)
    event_details: Mapped[str]  = mapped_column(Text,        nullable=False)
    resolved_at: Mapped[str]    = mapped_column(String(64),  nullable=True)
    raw_payload: Mapped[dict]   = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_incidents_env_severity", "env", "severity"),
        Index("ix_incidents_env_status",   "env", "status"),
        Index("ix_incidents_jsonb",        "raw_payload", postgresql_using="gin"),
    )


class S3IngestCursor(Base):
    """Idempotency ledger for the S3 background ingest task."""
    __tablename__ = "s3_ingest_cursor"

    id: Mapped[int]               = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bucket: Mapped[str]           = mapped_column(String(256),  nullable=False)
    object_key: Mapped[str]       = mapped_column(String(1024), nullable=False, index=True)
    etag: Mapped[str]             = mapped_column(String(64),   nullable=False, default="")
    size_bytes: Mapped[int]       = mapped_column(BigInteger,   nullable=False, default=0)
    records_ingested: Mapped[int] = mapped_column(Integer,      nullable=False, default=0)
    parse_errors: Mapped[int]     = mapped_column(Integer,      nullable=False, default=0)
    status: Mapped[str]           = mapped_column(String(32),   nullable=False, default="completed")
    ingested_at: Mapped[str]      = mapped_column(String(64),   nullable=False, default=_utcnow)

    __table_args__ = (
        Index("uq_s3_cursor_bucket_key", "bucket", "object_key", unique=True),
    )
