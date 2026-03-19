"""
models/db_models.py — SQLAlchemy ORM Models (PostgreSQL)

Architecture:
  PostgreSQL is used for two categories of data:

  A) Stateful / mutable (never in Pandas):
       AtlasUser, UserSession, Application, Microservice, AppConfig,
       QuarantinedEndpoint, Incident, ScheduledReport, ReportDownload,
       S3IngestCursor, MitigationAuditLog

  B) Telemetry write-store (written by log_ingestion + ingest_loghub,
     read by Pandas / log_loader for hot-path dashboard queries):
       NetworkLog, ApiLog, EndpointLog, DbActivityLog, Alert

  The Pandas in-memory engine (log_loader.py) reads from
  CSV files at startup — PostgreSQL telemetry tables serve as the
  cold audit/replay store and are never directly queried by the
  dashboard route handlers.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, Float, ForeignKey,
    Index, Integer, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# Telemetry Write-Store  (Category B)
# ─────────────────────────────────────────────────────────────────────────────

class NetworkLog(Base):
    """
    Network anomaly / intrusion detection events.
    Populated by log_ingestion.ingest_all_logs() and ingest_loghub.py.
    Hot-path reads served by Pandas (_build_network_df).
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

    # Loghub structured CSV fields (optional — null when sourced from JSONL)
    line_id: Mapped[int]          = mapped_column(BigInteger, nullable=True)
    level: Mapped[str]            = mapped_column(String(32),  nullable=True)
    component: Mapped[str]        = mapped_column(String(256), nullable=True)
    content: Mapped[str]          = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]         = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str]   = mapped_column(Text,        nullable=True)

    timestamp: Mapped[str]   = mapped_column(String(64),  nullable=False, default="")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_network_logs_env_severity", "env", "severity"),
        Index("ix_network_logs_source_ip",    "source_ip"),
    )


class ApiLog(Base):
    """
    API call telemetry — rate limiting, latency, cost.
    Populated by log_ingestion and ingest_loghub.py (Apache/Spark/OpenStack).
    Hot-path reads served by Pandas (_build_api_df).
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

    # Cost / rate metrics
    cost_per_call: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    trend_pct: Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    calls_today: Mapped[int]     = mapped_column(Integer, nullable=False, default=0)
    blocked_count: Mapped[int]   = mapped_column(Integer, nullable=False, default=0)
    avg_latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    estimated_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
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
    raw_payload: Mapped[dict]  = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_api_logs_env_severity", "env", "severity"),
        Index("ix_api_logs_env_action",   "env", "action"),
    )


class EndpointLog(Base):
    """
    Endpoint security events — workstation alerts, malware, policy violations.
    Populated by log_ingestion (JSONL), ingest_loghub (Linux/Windows/Mac CSV),
    and live Velociraptor webhooks.
    Hot-path reads served by Pandas (_build_endpoint_df).
    """
    __tablename__ = "endpoint_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Core classification
    env: Mapped[str]      = mapped_column(String(16),  nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(32),  nullable=False, default="Low", index=True)

    # Endpoint identity
    workstation_id: Mapped[str] = mapped_column(String(128), nullable=False, default="UNKNOWN")
    employee: Mapped[str]       = mapped_column(String(128), nullable=False, default="Unknown")
    avatar: Mapped[str]         = mapped_column(String(512), nullable=False, default="")
    os_name: Mapped[str]        = mapped_column(String(128), nullable=False, default="Unknown")
    target_app: Mapped[str]     = mapped_column(String(256), nullable=False, default="Unknown")

    # Alert details
    alert_message: Mapped[str]  = mapped_column(Text, nullable=False, default="")
    alert_category: Mapped[str] = mapped_column(String(128), nullable=False, default="Unknown")

    # Boolean flags
    is_offline: Mapped[bool]  = mapped_column(Boolean, nullable=False, default=False)
    is_malware: Mapped[bool]  = mapped_column(Boolean, nullable=False, default=False)

    # Loghub structured CSV fields (optional)
    line_id: Mapped[int]        = mapped_column(BigInteger, nullable=True)
    level: Mapped[str]          = mapped_column(String(32),  nullable=True)
    component: Mapped[str]      = mapped_column(String(256), nullable=True)
    content: Mapped[str]        = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]       = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str] = mapped_column(Text,        nullable=True)

    timestamp: Mapped[str]    = mapped_column(String(64),  nullable=False, default="")
    raw_payload: Mapped[dict]  = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_endpoint_logs_env_severity",  "env", "severity"),
        Index("ix_endpoint_logs_env_malware",   "env", "is_malware"),
        Index("ix_endpoint_logs_workstation",   "workstation_id"),
    )


class DbActivityLog(Base):
    """
    Database operation audit logs — query types, suspicious activity, DLP.
    Populated by log_ingestion (JSONL) and ingest_loghub (Hadoop CSV).
    Hot-path reads served by Pandas (_build_db_df).
    """
    __tablename__ = "db_activity_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Core classification
    env: Mapped[str]        = mapped_column(String(16),  nullable=False, index=True)
    severity: Mapped[str]   = mapped_column(String(32),  nullable=False, default="Info", index=True)
    app: Mapped[str]        = mapped_column(String(256), nullable=False, default="Unknown")
    target_app: Mapped[str] = mapped_column(String(256), nullable=False, default="Unknown")

    # DB identity
    db_user: Mapped[str]      = mapped_column(String(128), nullable=False, default="unknown")
    query_type: Mapped[str]   = mapped_column(String(32),  nullable=False, default="SELECT")
    target_table: Mapped[str] = mapped_column(String(256), nullable=False, default="unknown")
    reason: Mapped[str]       = mapped_column(Text, nullable=False, default="")
    is_suspicious: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)

    # KPI scalars
    active_connections: Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    avg_latency_ms: Mapped[float]        = mapped_column(Float,   nullable=False, default=0.0)
    data_export_volume_tb: Mapped[float] = mapped_column(Float,   nullable=False, default=0.0)
    hour_label: Mapped[str]              = mapped_column(String(16), nullable=False, default="")

    # Operation counts
    select_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    insert_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    update_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delete_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Loghub structured CSV fields (optional)
    line_id: Mapped[int]        = mapped_column(BigInteger, nullable=True)
    level: Mapped[str]          = mapped_column(String(32),  nullable=True)
    component: Mapped[str]      = mapped_column(String(256), nullable=True)
    content: Mapped[str]        = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]       = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str] = mapped_column(Text,        nullable=True)

    timestamp: Mapped[str]    = mapped_column(String(64),  nullable=False, default="")
    raw_payload: Mapped[dict]  = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_db_activity_logs_env_severity",    "env", "severity"),
        Index("ix_db_activity_logs_env_suspicious",  "env", "is_suspicious"),
    )


class Alert(Base):
    """
    Notification bell alerts — aggregated from endpoint and network events.
    Populated by log_ingestion (alerts.jsonl).
    """
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    alert_id: Mapped[str]       = mapped_column(String(128), nullable=False, default="", index=True)
    env: Mapped[str]            = mapped_column(String(16),  nullable=False, index=True)
    app: Mapped[str]            = mapped_column(String(256), nullable=False, default="Unknown")
    message: Mapped[str]        = mapped_column(Text, nullable=False, default="")
    severity: Mapped[str]       = mapped_column(String(32),  nullable=False, default="Low", index=True)
    timestamp_label: Mapped[str] = mapped_column(String(128), nullable=False, default="recently")
    raw_payload: Mapped[dict]    = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_alerts_env_severity", "env", "severity"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Mitigation Audit Log  (new — tracks every analyst action)
# ─────────────────────────────────────────────────────────────────────────────

class MitigationAuditLog(Base):
    """
    Immutable audit trail for every SOC action triggered via the dashboard.
    One row = one analyst action (block, quarantine, kill-query, remediate, etc.)

    Never deleted — use PostgreSQL partitioning or archival for retention.
    `details` stores the full action payload so nothing is ever lost.
    """
    __tablename__ = "mitigation_audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    env: Mapped[str]            = mapped_column(String(16),  nullable=False, index=True)
    analyst_email: Mapped[str]  = mapped_column(String(256), nullable=False, index=True)
    analyst_role: Mapped[str]   = mapped_column(String(32),  nullable=False, default="Analyst")

    # Action classification
    action_type: Mapped[str]       = mapped_column(String(64),  nullable=False, index=True)
    # e.g. "block_api_route" | "block_network_source" | "quarantine_device"
    #      "kill_db_query"   | "remediate_incident"   | "lift_quarantine"

    target_identifier: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    # e.g. IP address, workstation_id, incident_id, app+path

    outcome: Mapped[str] = mapped_column(String(32), nullable=False, default="success")
    # "success" | "failed" | "partial"

    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Full request payload for forensics

    created_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow, index=True)

    __table_args__ = (
        Index("ix_mitigation_audit_env_action",  "env", "action_type"),
        Index("ix_mitigation_audit_analyst",     "analyst_email", "created_at"),
        Index("ix_mitigation_audit_jsonb",       "details", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Application & Service Registry
# ─────────────────────────────────────────────────────────────────────────────

class Application(Base):
    """
    Registered protected application.
    Drives the application selector in the header and scopes all API calls.
    """
    __tablename__ = "applications"

    id: Mapped[int]     = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]    = mapped_column(String(16),  nullable=False, index=True)
    app_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    name: Mapped[str]   = mapped_column(String(256), nullable=False)

    __table_args__ = (
        Index("uq_applications_env_app_id", "env", "app_id", unique=True),
    )


class Microservice(Base):
    """
    Individual microservice node — drives the Attack Surface Topology diagram.
    `connections_csv` is a comma-separated list of service_ids this node links to.
    """
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


# ─────────────────────────────────────────────────────────────────────────────
# Security Configuration
# ─────────────────────────────────────────────────────────────────────────────

class AppConfig(Base):
    """Per-application security tuning parameters."""
    __tablename__ = "app_configs"

    id: Mapped[int]     = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]    = mapped_column(String(16),  nullable=False, index=True)
    app_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)

    warning_anomaly_score: Mapped[int]   = mapped_column(Integer, nullable=False, default=60)
    critical_anomaly_score: Mapped[int]  = mapped_column(Integer, nullable=False, default=80)

    soft_rate_limit_calls_per_min: Mapped[int]      = mapped_column(Integer, nullable=False, default=800)
    hard_block_threshold_calls_per_min: Mapped[int]  = mapped_column(Integer, nullable=False, default=3000)
    auto_quarantine_laptops: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    training_window_days: Mapped[int]      = mapped_column(Integer, nullable=False, default=30)
    model_sensitivity_pct: Mapped[int]     = mapped_column(Integer, nullable=False, default=58)
    auto_update_baselines_weekly: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    baseline_model_name: Mapped[str]       = mapped_column(String(256), nullable=False, default="")
    baseline_last_updated_at: Mapped[str]  = mapped_column(String(64),  nullable=False, default=_utcnow)
    updated_at: Mapped[str]                = mapped_column(String(64),  nullable=False, default=_utcnow)

    __table_args__ = (
        Index("uq_app_configs_env_app", "env", "app_id", unique=True),
    )


class QuarantinedEndpoint(Base):
    """Active quarantine ledger — status: Active → Lifted."""
    __tablename__ = "quarantined_endpoints"

    id: Mapped[int]            = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]           = mapped_column(String(16),  nullable=False, index=True)
    app_id: Mapped[str]        = mapped_column(String(128), nullable=False, index=True)
    workstation_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    user_name: Mapped[str]     = mapped_column(String(128), nullable=False, default="")
    quarantined_at: Mapped[str] = mapped_column(String(64),  nullable=False, default=_utcnow)
    lifted_at: Mapped[str]     = mapped_column(String(64),  nullable=True)
    status: Mapped[str]        = mapped_column(String(32),  nullable=False, default="Active", index=True)
    raw_payload: Mapped[dict]   = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_quarantined_endpoints_env_app",    "env", "app_id"),
        Index("ix_quarantined_endpoints_env_status", "env", "status"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Report Management
# ─────────────────────────────────────────────────────────────────────────────

class ScheduledReport(Base):
    """Report schedule definitions — recurring export jobs."""
    __tablename__ = "scheduled_reports"

    id: Mapped[int]                = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str]               = mapped_column(String(16),  nullable=False, index=True)
    title: Mapped[str]             = mapped_column(String(256), nullable=False)
    description: Mapped[str]       = mapped_column(Text, nullable=False, default="")
    target_app_scope: Mapped[str]  = mapped_column(String(256), nullable=False, default="All Sources")
    schedule: Mapped[str]          = mapped_column(String(128), nullable=False, default="Every Monday at 8:00 AM")
    template: Mapped[str]          = mapped_column(String(256), nullable=False, default="General Security Summary")
    export_format: Mapped[str]     = mapped_column(String(32),  nullable=False, default="PDF")
    enabled: Mapped[bool]          = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[str]        = mapped_column(String(64),  nullable=False, default=_utcnow)

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


# ─────────────────────────────────────────────────────────────────────────────
# Atlas Users & Sessions
# ─────────────────────────────────────────────────────────────────────────────

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
        Index("ix_atlas_users_role",            "role"),
        Index("uq_atlas_users_env_email",       "env", "email", unique=True),
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


# ─────────────────────────────────────────────────────────────────────────────
# Case Management
# ─────────────────────────────────────────────────────────────────────────────

class Incident(Base):
    """
    Security incident case.
    `resolved_at` is set when status transitions to 'Closed' — used for MTTR.
    `status` lifecycle: 'Active' → 'Contained' → 'Closed'
    """
    __tablename__ = "incidents"

    id: Mapped[int]             = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    incident_id: Mapped[str]    = mapped_column(String(64),  nullable=False, unique=True, index=True)
    env: Mapped[str]            = mapped_column(String(16),  nullable=False, index=True)
    line_id: Mapped[int]        = mapped_column(BigInteger,  nullable=True,  index=True)
    level: Mapped[str]          = mapped_column(String(32),  nullable=True)
    component: Mapped[str]      = mapped_column(String(128), nullable=True)
    content: Mapped[str]        = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]       = mapped_column(String(64),  nullable=True,  index=True)
    event_template: Mapped[str] = mapped_column(Text,        nullable=True)
    event_name: Mapped[str]     = mapped_column(String(512), nullable=False)
    timestamp: Mapped[str]      = mapped_column(String(64),  nullable=False)
    severity: Mapped[str]       = mapped_column(String(32),  nullable=False, index=True)
    source_ip: Mapped[str]      = mapped_column(String(64),  nullable=False)
    dest_ip: Mapped[str]        = mapped_column(String(64),  nullable=False)
    target_app: Mapped[str]     = mapped_column(String(256), nullable=False)
    status: Mapped[str]         = mapped_column(String(32),  nullable=False, default="Active", index=True)
    event_details: Mapped[str]  = mapped_column(Text,        nullable=False)
    # ── NEW: set when status → 'Closed'; used for dynamic MTTR computation ──
    resolved_at: Mapped[str]    = mapped_column(String(64),  nullable=True)
    raw_payload: Mapped[dict]   = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_incidents_env_severity", "env", "severity"),
        Index("ix_incidents_env_status",   "env", "status"),
        Index("ix_incidents_jsonb",        "raw_payload", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# S3 Ingest Cursor
# ─────────────────────────────────────────────────────────────────────────────

class S3IngestCursor(Base):
    """Idempotency ledger for the S3 background ingest task."""
    __tablename__ = "s3_ingest_cursor"

    id: Mapped[int]              = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bucket: Mapped[str]          = mapped_column(String(256),  nullable=False)
    object_key: Mapped[str]      = mapped_column(String(1024), nullable=False, index=True)
    etag: Mapped[str]            = mapped_column(String(64),   nullable=False, default="")
    size_bytes: Mapped[int]      = mapped_column(BigInteger,   nullable=False, default=0)
    records_ingested: Mapped[int] = mapped_column(Integer,     nullable=False, default=0)
    parse_errors: Mapped[int]    = mapped_column(Integer,      nullable=False, default=0)
    status: Mapped[str]          = mapped_column(String(32),   nullable=False, default="completed")
    ingested_at: Mapped[str]     = mapped_column(String(64),   nullable=False, default=_utcnow)

    __table_args__ = (
        Index("uq_s3_cursor_bucket_key", "bucket", "object_key", unique=True),
    )
