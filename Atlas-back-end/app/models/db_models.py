"""
models/db_models.py — SQLAlchemy ORM Models (PostgreSQL + JSONB)

Architecture decisions:
  - Every table has a `raw_payload` JSONB column to store the original log
    entry verbatim. This is the "append-only raw log" pattern — structured
    columns are indexes into this payload, not copies of it.
  - JSONB (not JSON) is used because PostgreSQL can index JSONB with GIN,
    enabling fast `@>` containment queries on arbitrary log keys.
  - `env` column on every table disambiguates Cloud vs Local environments,
    which is a first-class concept in the ATLAS frontend.
  - Timestamps are stored as UTC strings (ISO-8601) for direct JSON serialisation
    without tz-conversion overhead in the API layer.

Naming convention:
  - Table names: plural snake_case (network_logs, api_logs, etc.)
  - Column names: snake_case matching the Python attribute name
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
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# Network Traffic Logs
# ─────────────────────────────────────────────────────────────────────────────

class NetworkLog(Base):
    """
    One row = one observed network anomaly or traffic event.

    Indexed on (env, timestamp) for fast time-range queries and
    on (env, source_ip) for per-IP investigation queries.
    """
    __tablename__ = "network_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)       # "cloud" | "local"
    source_ip: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    dest_ip: Mapped[str] = mapped_column(String(64), nullable=False)
    app: Mapped[str] = mapped_column(String(128), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    anomaly_type: Mapped[str] = mapped_column(String(256), nullable=False)
    bandwidth_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active_connections: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    dropped_packets: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    timestamp: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_network_logs_env_ts", "env", "timestamp"),
        Index("ix_network_logs_jsonb", "raw_payload", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# API Monitoring Logs
# ─────────────────────────────────────────────────────────────────────────────

class ApiLog(Base):
    """
    One row = one API endpoint telemetry snapshot (or abusive call event).

    `action` mirrors the frontend's action column: 'OK' | 'Rate-Limited' | 'Blocked'
    `trend`  is a signed integer representing % change in call volume (7d).
    """
    __tablename__ = "api_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    app: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False, default="GET")
    cost_per_call: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    trend_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    action: Mapped[str] = mapped_column(String(32), nullable=False, default="OK")
    calls_today: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    blocked_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    avg_latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    estimated_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hour_label: Mapped[str] = mapped_column(String(16), nullable=False)  # e.g. "9am"
    actual_calls: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    predicted_calls: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    timestamp: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_api_logs_env_ts", "env", "timestamp"),
        Index("ix_api_logs_jsonb", "raw_payload", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint Security (Velociraptor / Wazuh-compatible events)
# ─────────────────────────────────────────────────────────────────────────────

class EndpointLog(Base):
    """
    One row = one endpoint security event (malware alert, policy violation, etc.).

    `workstation_id` is the Velociraptor client ID or hostname.
    `os_name` feeds the OS Distribution pie chart.
    `alert_category` feeds the Alert Types pie chart.
    """
    __tablename__ = "endpoint_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    workstation_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    employee: Mapped[str] = mapped_column(String(256), nullable=False)
    avatar: Mapped[str] = mapped_column(Text, nullable=False, default="")
    alert_message: Mapped[str] = mapped_column(Text, nullable=False)
    alert_category: Mapped[str] = mapped_column(String(128), nullable=False)  # Malware | Policy Violation | etc.
    severity: Mapped[str] = mapped_column(String(32), nullable=False)          # Critical | High | Medium | Low
    os_name: Mapped[str] = mapped_column(String(128), nullable=False)          # Windows 11 | Ubuntu 22.04 | etc.
    is_offline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_malware: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    timestamp: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_endpoint_logs_env_ts", "env", "timestamp"),
        Index("ix_endpoint_logs_env_severity", "env", "severity"),
        Index("ix_endpoint_logs_jsonb", "raw_payload", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Database Activity Monitoring
# ─────────────────────────────────────────────────────────────────────────────

class DbActivityLog(Base):
    """
    One row = one database operation event or snapshot.

    `is_suspicious` triggers inclusion in the Suspicious Activity table.
    `hour_label` maps to the operationsChart time-series labels.
    """
    __tablename__ = "db_activity_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    app: Mapped[str] = mapped_column(String(128), nullable=False)
    db_user: Mapped[str] = mapped_column(String(128), nullable=False)
    query_type: Mapped[str] = mapped_column(String(32), nullable=False)   # SELECT | INSERT | UPDATE | DELETE
    target_table: Mapped[str] = mapped_column(String(256), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_suspicious: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    active_connections: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avg_latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    data_export_volume_tb: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hour_label: Mapped[str] = mapped_column(String(16), nullable=False)
    select_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    insert_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    update_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    delete_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    timestamp: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_db_logs_env_ts", "env", "timestamp"),
        Index("ix_db_logs_env_suspicious", "env", "is_suspicious"),
        Index("ix_db_logs_jsonb", "raw_payload", postgresql_using="gin"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Incidents (Case Management)
# ─────────────────────────────────────────────────────────────────────────────

class Incident(Base):
    """
    One row = one security incident case.

    `incident_id` is a human-readable string (e.g., "INC-2405-001")
    that is stable across the lifecycle of the case.
    `status` follows the frontend's: 'Active' | 'Contained' | 'Closed'
    `severity` follows the frontend's: 'Critical' | 'High' | 'Medium' | 'Low'
    """
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    incident_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
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
# Alert Feed (Header / Notification Bell)
# ─────────────────────────────────────────────────────────────────────────────

class Alert(Base):
    """
    One row = one recent alert shown in the header notification dropdown.

    `timestamp_label` is a human-readable relative string (e.g., "2m ago")
    that is computed at ingestion time and stored for direct frontend use.
    """
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    alert_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    env: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    app: Mapped[str] = mapped_column(String(256), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False)
    timestamp_label: Mapped[str] = mapped_column(String(64), nullable=False)  # "2m ago"
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_alerts_env_severity", "env", "severity"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# S3 Ingest Cursor  (cold-storage backfill tracker)
# ─────────────────────────────────────────────────────────────────────────────

class S3IngestCursor(Base):
    """
    One row = one S3 object that has been successfully ingested.

    This table is the idempotency ledger for the S3 background task.
    Before downloading an object, the task checks this table; if a row
    already exists for that (bucket, key) pair, the object is skipped.

    `status` values:
      - "completed"  — all records in the object were parsed and inserted
      - "partial"    — some records failed parsing; good rows were still saved
      - "failed"     — the object could not be downloaded or decompressed

    `records_ingested` is 0 for failed objects, enabling easy audit queries:
        SELECT * FROM s3_ingest_cursor WHERE status != 'completed';
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
        # The unique constraint prevents concurrent workers from double-ingesting
        # the same object if multiple ATLAS instances run simultaneously.
        Index("uq_s3_cursor_bucket_key", "bucket", "object_key", unique=True),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Atlas Users  (authentication & RBAC)
# ─────────────────────────────────────────────────────────────────────────────

class AtlasUser(Base):
    """
    One row = one ATLAS platform user.

    Roles:
      - "Admin"     — full access including user management and settings writes
      - "Analyst"   — read/write on incidents, quarantine, remediation
      - "Read-Only" — dashboard read access only; cannot trigger mitigations

    `totp_secret` is stored encrypted at the application layer (future).
    For the MVP it is stored in plaintext; add Fernet encryption before prod.

    `phone` and `avatar` are optional profile fields surfaced in the profile page.
    """
    __tablename__ = "atlas_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(256), nullable=False, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="Analyst")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    phone: Mapped[str] = mapped_column(String(64), nullable=True)
    avatar: Mapped[str] = mapped_column(String(512), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    totp_secret: Mapped[str] = mapped_column(String(128), nullable=True)
    invite_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False, default=_utcnow)

    # Relationship to sessions
    sessions: Mapped[list["UserSession"]] = relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_atlas_users_role", "role"),
    )


class UserSession(Base):
    """
    One row = one login attempt (success or failure).

    Used to populate the "Recent Account Activity" table on the profile page.
    Stored for the last N sessions per user (app layer enforces the cap).
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
