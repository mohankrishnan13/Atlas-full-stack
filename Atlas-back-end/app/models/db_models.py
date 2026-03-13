"""
models/db_models.py — SQLAlchemy ORM Models (PostgreSQL, stateful data only)

Architecture note (v2 — Pandas Migration):
  PostgreSQL is now used EXCLUSIVELY for stateful, mutable data:
    - User accounts and sessions (AtlasUser, UserSession)
    - Application and service registry (Application, Microservice)
    - Security configuration (AppConfig)
    - Quarantine ledger (QuarantinedEndpoint)
    - Case management (Incident)
    - Report scheduling and downloads (ScheduledReport, ReportDownload)
    - S3 ingest cursor (S3IngestCursor)

  REMOVED tables (migrated to Pandas in-memory engine):
    - ApiLog          → app/services/query_service.py  _build_api_df()
    - NetworkLog      → app/services/query_service.py  _build_network_df()
    - EndpointLog     → app/services/query_service.py  _build_endpoint_df()
    - DbActivityLog   → app/services/query_service.py  _build_db_df()
    - Alert           → app/services/query_service.py  _synth_alerts()

  Telemetry data is read from Loghub _structured.csv files at startup,
  enriched with enterprise context columns, and held in RAM.
  This architecture is forward-compatible with a future Elasticsearch/Wazuh
  migration — swap _build_*_df() loaders with ES client calls, zero
  schema or route changes required.

Naming convention:
  - Table names:  plural snake_case
  - Column names: snake_case matching Python attribute names
"""

from datetime import datetime, timezone

from sqlalchemy import (
    ForeignKey,
    BigInteger,
    Boolean,
    Float,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# Application & Service Registry
# ─────────────────────────────────────────────────────────────────────────────

class Application(Base):
    """
    Registered protected application.
    One row = one monitored application (e.g. Naukri Portal, GenAI Service).
    Drives the application selector in the header and scopes all API calls.
    """
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    app_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)

    __table_args__ = (
        Index("uq_applications_env_app_id", "env", "app_id", unique=True),
    )


class Microservice(Base):
    """
    Individual microservice node within a protected application.
    Drives the Attack Surface Topology diagram on the Overview page.
    `connections_csv` is a comma-separated list of service_ids this node
    connects to, serialised for cheap storage and fast deserialization.
    """
    __tablename__ = "microservices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    service_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Healthy")
    position_top: Mapped[str] = mapped_column(String(16), nullable=False, default="50%")
    position_left: Mapped[str] = mapped_column(String(16), nullable=False, default="50%")
    connections_csv: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (
        Index("uq_microservices_env_service_id", "env", "service_id", unique=True),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Security Configuration
# ─────────────────────────────────────────────────────────────────────────────

class AppConfig(Base):
    """
    Per-application security tuning parameters.
    All thresholds, rate limits, and ML baseline settings live here.
    Updated via the Settings → App Configuration page.
    """
    __tablename__ = "app_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    app_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)

    # Alert tuning
    warning_anomaly_score: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    critical_anomaly_score: Mapped[int] = mapped_column(Integer, nullable=False, default=80)

    # Progressive containment
    soft_rate_limit_calls_per_min: Mapped[int] = mapped_column(Integer, nullable=False, default=800)
    hard_block_threshold_calls_per_min: Mapped[int] = mapped_column(Integer, nullable=False, default=3000)
    auto_quarantine_laptops: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # ML baselines
    training_window_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    model_sensitivity_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=58)
    auto_update_baselines_weekly: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    baseline_model_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    baseline_last_updated_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)

    updated_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)

    __table_args__ = (
        Index("uq_app_configs_env_app", "env", "app_id", unique=True),
    )


class QuarantinedEndpoint(Base):
    """
    Active quarantine ledger.
    One row per quarantine action; status transitions from 'Active' → 'Lifted'.
    `raw_payload` stores the original Velociraptor/Wazuh event that triggered
    the quarantine for audit and forensics purposes.
    """
    __tablename__ = "quarantined_endpoints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    app_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    workstation_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    user_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    quarantined_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)
    lifted_at: Mapped[str] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Active", index=True)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_quarantined_endpoints_env_app", "env", "app_id"),
        Index("ix_quarantined_endpoints_env_status", "env", "status"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Report Management
# ─────────────────────────────────────────────────────────────────────────────

class ScheduledReport(Base):
    """
    Report schedule definitions (Reports page, left panel).
    Each row is a recurring export job: its cadence, template, and format.
    """
    __tablename__ = "scheduled_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    target_app_scope: Mapped[str] = mapped_column(String(256), nullable=False, default="All Sources")
    schedule: Mapped[str] = mapped_column(String(128), nullable=False, default="Every Monday at 8:00 AM")
    template: Mapped[str] = mapped_column(String(256), nullable=False, default="General Security Summary")
    export_format: Mapped[str] = mapped_column(String(32), nullable=False, default="PDF")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)

    __table_args__ = (
        Index("ix_scheduled_reports_env_enabled", "env", "enabled"),
    )


class ReportDownload(Base):
    """
    Generated report download manifest (Reports page, right panel).
    Created on-demand when an analyst triggers a report export.
    """
    __tablename__ = "report_downloads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    target_app_scope: Mapped[str] = mapped_column(String(256), nullable=False, default="All Sources")
    generated_at_label: Mapped[str] = mapped_column(String(64), nullable=False, default="Today")
    size_label: Mapped[str] = mapped_column(String(64), nullable=False, default="0 KB")
    download_url: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    created_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)

    __table_args__ = (
        Index("ix_report_downloads_env_created", "env", "created_at"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Atlas Users (Unified Authentication & RBAC)
# ─────────────────────────────────────────────────────────────────────────────

class AtlasUser(Base):
    """
    Unified user table. One row = one ATLAS platform user.
    Handles login, RBAC, MFA, and Profile settings.
    `sessions` is a back-populated relationship used for the
    Recent Activity table on the Profile page.
    """
    __tablename__ = "atlas_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True, default="cloud")
    email: Mapped[str] = mapped_column(String(256), nullable=False, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="Analyst")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    phone: Mapped[str] = mapped_column(String(64), nullable=True)
    avatar: Mapped[str] = mapped_column(String(512), nullable=True, default="")
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    totp_secret: Mapped[str] = mapped_column(String(128), nullable=True)
    invite_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)

    sessions: Mapped[list["UserSession"]] = relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_atlas_users_role", "role"),
        Index("uq_atlas_users_env_email", "env", "email", unique=True),
    )


class UserSession(Base):
    """
    Login session log. One row = one login attempt (success or failure).
    Retained for the last N sessions per user (enforced in app layer).
    Shown in the Profile → Recent Account Activity table.
    """
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("atlas_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown")
    location: Mapped[str] = mapped_column(String(128), nullable=False, default="Unknown")
    device_info: Mapped[str] = mapped_column(String(256), nullable=False, default="Unknown Device")
    status: Mapped[str] = mapped_column(String(128), nullable=False, default="Success")
    logged_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)

    user: Mapped["AtlasUser"] = relationship("AtlasUser", back_populates="sessions")

    __table_args__ = (
        Index("ix_user_sessions_user_logged", "user_id", "logged_at"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Case Management
# ─────────────────────────────────────────────────────────────────────────────

class Incident(Base):
    """
    Security incident case. One row = one confirmed security case.

    `incident_id` is a human-readable identifier (e.g. INC-2405-001)
    that is stable throughout the case lifecycle.

    `status` lifecycle: 'Active' → 'Contained' → 'Closed'
    `severity` tiers:   'Critical' | 'High' | 'Medium' | 'Low'

    `raw_payload` stores AI-generated narrative, assignee info, and
    scope tags from the Case Management widget. Using JSONB allows the
    schema to evolve without migrations.
    """
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    incident_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    line_id: Mapped[int] = mapped_column(BigInteger, nullable=True, index=True)
    level: Mapped[str] = mapped_column(String(32), nullable=True)
    component: Mapped[str] = mapped_column(String(128), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=True)
    event_id: Mapped[str] = mapped_column(String(64), nullable=True, index=True)
    event_template: Mapped[str] = mapped_column(Text, nullable=True)
    event_name: Mapped[str] = mapped_column(String(512), nullable=False)
    timestamp: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_ip: Mapped[str] = mapped_column(String(64), nullable=False)
    dest_ip: Mapped[str] = mapped_column(String(64), nullable=False)
    target_app: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Active", index=True)
    event_details: Mapped[str] = mapped_column(Text, nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_incidents_env_severity", "env", "severity"),
        Index("ix_incidents_env_status", "env", "status"),
        Index("ix_incidents_jsonb", "raw_payload", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# S3 Ingest Cursor  (cold-storage backfill tracker)
# ─────────────────────────────────────────────────────────────────────────────

class S3IngestCursor(Base):
    """
    Idempotency ledger for the S3 background ingest task.
    One row = one S3 object that has been processed.

    Before downloading an object the task checks this table;
    if (bucket, key) already exists, the object is skipped.

    `status` values:
      'completed'  — all records parsed and written
      'partial'    — some parse failures; good rows were saved
      'failed'     — object could not be downloaded or decompressed
    """
    __tablename__ = "s3_ingest_cursor"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bucket: Mapped[str] = mapped_column(String(256), nullable=False)
    object_key: Mapped[str] = mapped_column(String(1024), nullable=False, index=True)
    etag: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    records_ingested: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    parse_errors: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    ingested_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)

    __table_args__ = (
        Index("uq_s3_cursor_bucket_key", "bucket", "object_key", unique=True),
    )
