"""
models/db_models.py — SQLAlchemy ORM Models (PostgreSQL)

Architecture after Anomaly Command Center pivot:

  A) Stateful / mutable:
       AtlasUser, UserSession, Incident, MitigationAuditLog,
       QuarantinedEndpoint, S3IngestCursor

  B) Telemetry write-store (Wazuh + Zeek only):
       EndpointLog   — written by wazuh_service.WazuhCollector.sync_alerts()
       NetworkLog    — written by log_ingestion (Zeek routed through Wazuh)
       Alert         — aggregated bell-notification events

  C) Anomaly Engine output:
       TrafficAnomaly — written by anomaly_detection.run_anomaly_engine()
                        Consumed by /overview endpoint and future AI phase.

REMOVED from previous version:
  - ApiLog           (API Monitoring domain — retired)
  - DbActivityLog    (DB Monitoring domain — retired)
  - Application      (driven app registry — retired, header uses EndpointLog)
  - Microservice     (topology diagram — retired)
  - AppConfig        (per-app config tuning — retired)
  - QuarantinedEndpoint (moved to MitigationAuditLog audit trail)
  - ScheduledReport  (reports domain — retired)
  - ReportDownload   (reports domain — retired)
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


# ─────────────────────────────────────────────────────────────────────────────
# Telemetry Write-Store  (Category B)
# ─────────────────────────────────────────────────────────────────────────────

class NetworkLog(Base):
    """
    Zeek-sourced network anomaly / intrusion detection events.
    Populated by log_ingestion and wazuh_service (Zeek routed through Wazuh).
    """
    __tablename__ = "network_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    env: Mapped[str]          = mapped_column(String(16),  nullable=False, index=True)
    severity: Mapped[str]     = mapped_column(String(32),  nullable=False, default="Info", index=True)

    source_ip: Mapped[str]    = mapped_column(String(64),  nullable=False, default="")
    dest_ip: Mapped[str]      = mapped_column(String(64),  nullable=False, default="")
    app: Mapped[str]          = mapped_column(String(256), nullable=False, default="Unknown")
    target_app: Mapped[str]   = mapped_column(String(256), nullable=False, default="Unknown")
    port: Mapped[int]         = mapped_column(Integer,     nullable=False, default=0)
    anomaly_type: Mapped[str] = mapped_column(String(256), nullable=False, default="Unknown")

    bandwidth_pct: Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    active_connections: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dropped_packets: Mapped[int]    = mapped_column(Integer, nullable=False, default=0)

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
        Index("ix_network_logs_env_severity", "env", "severity"),
        Index("ix_network_logs_source_ip",    "source_ip"),
    )


class EndpointLog(Base):
    """
    Wazuh endpoint security events — workstation alerts, malware, policy violations.
    Populated by wazuh_service.WazuhCollector.sync_alerts() (the background poller)
    and log_ingestion for bulk historical imports.

    This is the primary data source for:
      - endpoint_service.get_endpoint_security()
      - anomaly_detection.run_anomaly_engine() (spike detection)
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

    # Loghub structured CSV fields (optional)
    line_id: Mapped[int]        = mapped_column(BigInteger, nullable=True)
    level: Mapped[str]          = mapped_column(String(32),  nullable=True)
    component: Mapped[str]      = mapped_column(String(256), nullable=True)
    content: Mapped[str]        = mapped_column(Text,        nullable=True)
    event_id: Mapped[str]       = mapped_column(String(64),  nullable=True, index=True)
    event_template: Mapped[str] = mapped_column(Text,        nullable=True)

    # ISO-8601 string — used for lexicographic time-window comparisons
    # in run_anomaly_engine() and endpoint_service.
    timestamp: Mapped[str]    = mapped_column(String(64),  nullable=False, default="")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_endpoint_logs_env_severity",  "env", "severity"),
        Index("ix_endpoint_logs_env_malware",   "env", "is_malware"),
        Index("ix_endpoint_logs_workstation",   "workstation_id"),
        # Covering index for time-window queries in the anomaly engine.
        Index("ix_endpoint_logs_env_timestamp", "env", "timestamp"),
    )


class Alert(Base):
    """
    Bell-notification alerts — aggregated from endpoint and network events.
    Populated by log_ingestion (alerts.jsonl).
    """
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
# Anomaly Engine Output  (Category C)
# ─────────────────────────────────────────────────────────────────────────────

class TrafficAnomaly(Base):
    """
    Statistical anomaly records written by run_anomaly_engine().

    One row = one detected spike event.  Never mutated after insert —
    use status-only updates via a separate audit if you need lifecycle tracking.

    Column notes
    ─────────────
    anomaly_type  : Human-readable classification e.g. "Endpoint Alert Spike",
                    "Network Volume Spike".  Use consistent names — the frontend
                    groups and filters on this field.

    severity      : Derived from the spike magnitude ratio at detection time.
                    "Critical" (≥ 5× baseline), "High" (≥ 3×), "Medium" (< 3×
                    but above count threshold).

    details       : JSON-encoded context snapshot captured at detection:
                    { "current_count": int, "baseline_avg": float,
                      "spike_ratio": float, "env": str }
                    Stored as Text to keep schema simple; parse at call-site.

    ai_explanation: Reserved for Phase 3 — the AI investigator flow will
                    populate this column via a background enrichment pass.
                    Nullable intentionally; do not block inserts waiting for it.

    timestamp     : Proper timezone-aware DateTime (not a String like the legacy
                    telemetry tables) so the anomaly feed can use BETWEEN and
                    ORDER BY natively without lexicographic tricks.
    """
    __tablename__ = "traffic_anomalies"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    env: Mapped[str]          = mapped_column(String(16),   nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    anomaly_type: Mapped[str] = mapped_column(String(128),  nullable=False, index=True)
    severity: Mapped[str]     = mapped_column(String(32),   nullable=False, default="High", index=True)
    details: Mapped[str]      = mapped_column(Text,         nullable=False, default="")
    ai_explanation: Mapped[str] = mapped_column(Text,       nullable=True)

    __table_args__ = (
        Index("ix_traffic_anomalies_env_ts",       "env", "timestamp"),
        Index("ix_traffic_anomalies_env_severity", "env", "severity"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Mitigation Audit Log
# ─────────────────────────────────────────────────────────────────────────────

class MitigationAuditLog(Base):
    """
    Immutable audit trail for every SOC analyst action.
    One row = one action (block, quarantine, remediate, etc.).
    Never deleted — archive via PostgreSQL partitioning for retention.
    """
    __tablename__ = "mitigation_audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    env: Mapped[str]            = mapped_column(String(16),  nullable=False, index=True)
    analyst_email: Mapped[str]  = mapped_column(String(256), nullable=False, index=True)
    analyst_role: Mapped[str]   = mapped_column(String(32),  nullable=False, default="Analyst")

    # e.g. "block_network_source" | "quarantine_device" | "remediate_incident"
    action_type: Mapped[str]       = mapped_column(String(64),  nullable=False, index=True)
    target_identifier: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    outcome: Mapped[str]           = mapped_column(String(32),  nullable=False, default="success")
    details: Mapped[dict]          = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[str]        = mapped_column(String(64),  nullable=False, default=_utcnow, index=True)

    __table_args__ = (
        Index("ix_mitigation_audit_env_action",  "env", "action_type"),
        Index("ix_mitigation_audit_analyst",     "analyst_email", "created_at"),
        Index("ix_mitigation_audit_jsonb",       "details", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Case Management
# ─────────────────────────────────────────────────────────────────────────────

class Incident(Base):
    """
    Security incident case.
    `resolved_at` is set when status → 'Closed' — drives MTTR calculation.
    Lifecycle: 'Active' → 'Contained' → 'Closed'
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


# ─────────────────────────────────────────────────────────────────────────────
# S3 Ingest Cursor
# ─────────────────────────────────────────────────────────────────────────────

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
