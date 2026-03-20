"""Initial schema — creates all ATLAS tables

Revision ID: 91a3cd468007
Revises:
Create Date: 2026-03-20 12:15:50.358283

This is the COMPLETE initial migration. It creates all 17 tables defined in
app/models/db_models.py. The previous version of this file contained only
`pass` statements and created nothing, which caused the
`UndefinedTableError: relation "endpoint_logs" does not exist` error at startup.

Tables created (in dependency order):
  atlas_users         — users, RBAC, MFA
  user_sessions       — login audit (FK → atlas_users)
  applications        — registered apps
  microservices       — service topology
  app_configs         — per-app security tuning
  quarantined_endpoints
  scheduled_reports
  report_downloads
  incidents
  s3_ingest_cursor
  mitigation_audit_logs
  network_logs        — telemetry (anomaly engine)
  api_logs            — telemetry (anomaly engine)
  endpoint_logs       — telemetry (anomaly engine)
  db_activity_logs    — telemetry
  alerts              — notification bell
  anomaly_events      — AI-detected anomalies
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "91a3cd468007"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:

    # ── atlas_users ───────────────────────────────────────────────────────────
    op.create_table(
        "atlas_users",
        sa.Column("id",              sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column("env",             sa.String(16),    nullable=False, server_default="cloud"),
        sa.Column("email",           sa.String(256),   nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(256),   nullable=False),
        sa.Column("name",            sa.String(128),   nullable=False),
        sa.Column("role",            sa.String(32),    nullable=False, server_default="Analyst"),
        sa.Column("is_active",       sa.Boolean(),     nullable=False, server_default=sa.true()),
        sa.Column("phone",           sa.String(64),    nullable=True),
        sa.Column("avatar",          sa.String(512),   nullable=True,  server_default=""),
        sa.Column("totp_enabled",    sa.Boolean(),     nullable=False, server_default=sa.false()),
        sa.Column("totp_secret",     sa.String(128),   nullable=True),
        sa.Column("invite_pending",  sa.Boolean(),     nullable=False, server_default=sa.false()),
        sa.Column("created_at",      sa.String(64),    nullable=False, server_default=""),
    )
    op.create_index("ix_atlas_users_env",       "atlas_users", ["env"])
    op.create_index("ix_atlas_users_email",     "atlas_users", ["email"], unique=True)
    op.create_index("ix_atlas_users_role",      "atlas_users", ["role"])
    op.create_index("uq_atlas_users_env_email", "atlas_users", ["env", "email"], unique=True)

    # ── user_sessions ─────────────────────────────────────────────────────────
    op.create_table(
        "user_sessions",
        sa.Column("id",          sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("user_id",     sa.Integer(),   sa.ForeignKey("atlas_users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("ip_address",  sa.String(64),  nullable=False, server_default="unknown"),
        sa.Column("location",    sa.String(128), nullable=False, server_default="Unknown"),
        sa.Column("device_info", sa.String(256), nullable=False, server_default="Unknown Device"),
        sa.Column("status",      sa.String(128), nullable=False, server_default="Success"),
        sa.Column("logged_at",   sa.String(64),  nullable=False, server_default=""),
    )
    op.create_index("ix_user_sessions_user_id",     "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_user_logged", "user_sessions", ["user_id", "logged_at"])

    # ── applications ──────────────────────────────────────────────────────────
    op.create_table(
        "applications",
        sa.Column("id",     sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column("env",    sa.String(16),   nullable=False),
        sa.Column("app_id", sa.String(128),  nullable=False),
        sa.Column("name",   sa.String(256),  nullable=False),
    )
    op.create_index("ix_applications_env",        "applications", ["env"])
    op.create_index("ix_applications_app_id",     "applications", ["app_id"])
    op.create_index("uq_applications_env_app_id", "applications", ["env", "app_id"], unique=True)

    # ── microservices ─────────────────────────────────────────────────────────
    op.create_table(
        "microservices",
        sa.Column("id",              sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("env",             sa.String(16),  nullable=False),
        sa.Column("service_id",      sa.String(128), nullable=False),
        sa.Column("name",            sa.String(256), nullable=False),
        sa.Column("status",          sa.String(32),  nullable=False, server_default="Healthy"),
        sa.Column("position_top",    sa.String(16),  nullable=False, server_default="50%"),
        sa.Column("position_left",   sa.String(16),  nullable=False, server_default="50%"),
        sa.Column("connections_csv", sa.Text(),      nullable=False, server_default=""),
    )
    op.create_index("ix_microservices_env",            "microservices", ["env"])
    op.create_index("ix_microservices_service_id",     "microservices", ["service_id"])
    op.create_index("uq_microservices_env_service_id", "microservices", ["env", "service_id"], unique=True)

    # ── app_configs ───────────────────────────────────────────────────────────
    op.create_table(
        "app_configs",
        sa.Column("id",     sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("env",    sa.String(16),  nullable=False),
        sa.Column("app_id", sa.String(128), nullable=False),
        sa.Column("warning_anomaly_score",              sa.Integer(), nullable=False, server_default="60"),
        sa.Column("critical_anomaly_score",             sa.Integer(), nullable=False, server_default="80"),
        sa.Column("soft_rate_limit_calls_per_min",      sa.Integer(), nullable=False, server_default="800"),
        sa.Column("hard_block_threshold_calls_per_min", sa.Integer(), nullable=False, server_default="3000"),
        sa.Column("auto_quarantine_laptops",            sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("training_window_days",               sa.Integer(), nullable=False, server_default="30"),
        sa.Column("model_sensitivity_pct",              sa.Integer(), nullable=False, server_default="58"),
        sa.Column("auto_update_baselines_weekly",       sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("baseline_model_name",    sa.String(256), nullable=False, server_default=""),
        sa.Column("baseline_last_updated_at", sa.String(64), nullable=False, server_default=""),
        sa.Column("updated_at",             sa.String(64),  nullable=False, server_default=""),
    )
    op.create_index("ix_app_configs_env",    "app_configs", ["env"])
    op.create_index("ix_app_configs_app_id", "app_configs", ["app_id"])
    op.create_index("uq_app_configs_env_app", "app_configs", ["env", "app_id"], unique=True)

    # ── quarantined_endpoints ─────────────────────────────────────────────────
    op.create_table(
        "quarantined_endpoints",
        sa.Column("id",             sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("env",            sa.String(16),  nullable=False),
        sa.Column("app_id",         sa.String(128), nullable=False),
        sa.Column("workstation_id", sa.String(128), nullable=False),
        sa.Column("user_name",      sa.String(128), nullable=False, server_default=""),
        sa.Column("quarantined_at", sa.String(64),  nullable=False, server_default=""),
        sa.Column("lifted_at",      sa.String(64),  nullable=True),
        sa.Column("status",         sa.String(32),  nullable=False, server_default="Active"),
        sa.Column("raw_payload",    postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
    )
    op.create_index("ix_quarantined_endpoints_env",            "quarantined_endpoints", ["env"])
    op.create_index("ix_quarantined_endpoints_app_id",         "quarantined_endpoints", ["app_id"])
    op.create_index("ix_quarantined_endpoints_workstation_id", "quarantined_endpoints", ["workstation_id"])
    op.create_index("ix_quarantined_endpoints_status",         "quarantined_endpoints", ["status"])
    op.create_index("ix_quarantined_endpoints_env_app",        "quarantined_endpoints", ["env", "app_id"])
    op.create_index("ix_quarantined_endpoints_env_status",     "quarantined_endpoints", ["env", "status"])

    # ── scheduled_reports ─────────────────────────────────────────────────────
    op.create_table(
        "scheduled_reports",
        sa.Column("id",               sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("env",              sa.String(16),  nullable=False),
        sa.Column("title",            sa.String(256), nullable=False),
        sa.Column("description",      sa.Text(),      nullable=False, server_default=""),
        sa.Column("target_app_scope", sa.String(256), nullable=False, server_default="All Sources"),
        sa.Column("schedule",         sa.String(128), nullable=False, server_default="Every Monday at 8:00 AM"),
        sa.Column("template",         sa.String(256), nullable=False, server_default="General Security Summary"),
        sa.Column("export_format",    sa.String(32),  nullable=False, server_default="PDF"),
        sa.Column("enabled",          sa.Boolean(),   nullable=False, server_default=sa.true()),
        sa.Column("created_at",       sa.String(64),  nullable=False, server_default=""),
    )
    op.create_index("ix_scheduled_reports_env",         "scheduled_reports", ["env"])
    op.create_index("ix_scheduled_reports_env_enabled", "scheduled_reports", ["env", "enabled"])

    # ── report_downloads ──────────────────────────────────────────────────────
    op.create_table(
        "report_downloads",
        sa.Column("id",                sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column("env",               sa.String(16),   nullable=False),
        sa.Column("file_name",         sa.String(512),  nullable=False),
        sa.Column("target_app_scope",  sa.String(256),  nullable=False, server_default="All Sources"),
        sa.Column("generated_at_label",sa.String(64),   nullable=False, server_default="Today"),
        sa.Column("size_label",        sa.String(64),   nullable=False, server_default="0 KB"),
        sa.Column("download_url",      sa.String(1024), nullable=False, server_default=""),
        sa.Column("created_at",        sa.String(64),   nullable=False, server_default=""),
    )
    op.create_index("ix_report_downloads_env",         "report_downloads", ["env"])
    op.create_index("ix_report_downloads_env_created", "report_downloads", ["env", "created_at"])

    # ── incidents ─────────────────────────────────────────────────────────────
    op.create_table(
        "incidents",
        sa.Column("id",             sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("incident_id",    sa.String(64),   nullable=False, unique=True),
        sa.Column("env",            sa.String(16),   nullable=False),
        sa.Column("line_id",        sa.BigInteger(), nullable=True),
        sa.Column("level",          sa.String(32),   nullable=True),
        sa.Column("component",      sa.String(128),  nullable=True),
        sa.Column("content",        sa.Text(),       nullable=True),
        sa.Column("event_id",       sa.String(64),   nullable=True),
        sa.Column("event_template", sa.Text(),       nullable=True),
        sa.Column("event_name",     sa.String(512),  nullable=False),
        sa.Column("timestamp",      sa.String(64),   nullable=False),
        sa.Column("severity",       sa.String(32),   nullable=False),
        sa.Column("source_ip",      sa.String(64),   nullable=False),
        sa.Column("dest_ip",        sa.String(64),   nullable=False),
        sa.Column("target_app",     sa.String(256),  nullable=False),
        sa.Column("status",         sa.String(32),   nullable=False, server_default="Active"),
        sa.Column("event_details",  sa.Text(),       nullable=False),
        sa.Column("resolved_at",    sa.String(64),   nullable=True),
        sa.Column("raw_payload",    postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
    )
    op.create_index("ix_incidents_incident_id",  "incidents", ["incident_id"], unique=True)
    op.create_index("ix_incidents_env",          "incidents", ["env"])
    op.create_index("ix_incidents_line_id",      "incidents", ["line_id"])
    op.create_index("ix_incidents_event_id",     "incidents", ["event_id"])
    op.create_index("ix_incidents_severity",     "incidents", ["severity"])
    op.create_index("ix_incidents_status",       "incidents", ["status"])
    op.create_index("ix_incidents_env_severity", "incidents", ["env", "severity"])
    op.create_index("ix_incidents_env_status",   "incidents", ["env", "status"])
    op.create_index("ix_incidents_jsonb",        "incidents", ["raw_payload"],
                    postgresql_using="gin")

    # ── s3_ingest_cursor ──────────────────────────────────────────────────────
    op.create_table(
        "s3_ingest_cursor",
        sa.Column("id",               sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("bucket",           sa.String(256),  nullable=False),
        sa.Column("object_key",       sa.String(1024), nullable=False),
        sa.Column("etag",             sa.String(64),   nullable=False, server_default=""),
        sa.Column("size_bytes",       sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("records_ingested", sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("parse_errors",     sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("status",           sa.String(32),   nullable=False, server_default="completed"),
        sa.Column("ingested_at",      sa.String(64),   nullable=False, server_default=""),
    )
    op.create_index("ix_s3_ingest_cursor_object_key",    "s3_ingest_cursor", ["object_key"])
    op.create_index("uq_s3_cursor_bucket_key",           "s3_ingest_cursor", ["bucket", "object_key"], unique=True)

    # ── mitigation_audit_logs ─────────────────────────────────────────────────
    op.create_table(
        "mitigation_audit_logs",
        sa.Column("id",                sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("env",               sa.String(16),   nullable=False),
        sa.Column("analyst_email",     sa.String(256),  nullable=False),
        sa.Column("analyst_role",      sa.String(32),   nullable=False, server_default="Analyst"),
        sa.Column("action_type",       sa.String(64),   nullable=False),
        sa.Column("target_identifier", sa.String(512),  nullable=False, server_default=""),
        sa.Column("outcome",           sa.String(32),   nullable=False, server_default="success"),
        sa.Column("details",           postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
        sa.Column("created_at",        sa.String(64),   nullable=False, server_default=""),
    )
    op.create_index("ix_mitigation_audit_env",         "mitigation_audit_logs", ["env"])
    op.create_index("ix_mitigation_audit_email",       "mitigation_audit_logs", ["analyst_email"])
    op.create_index("ix_mitigation_audit_action_type", "mitigation_audit_logs", ["action_type"])
    op.create_index("ix_mitigation_audit_created_at",  "mitigation_audit_logs", ["created_at"])
    op.create_index("ix_mitigation_audit_env_action",  "mitigation_audit_logs", ["env", "action_type"])
    op.create_index("ix_mitigation_audit_analyst",     "mitigation_audit_logs",
                    ["analyst_email", "created_at"])
    op.create_index("ix_mitigation_audit_jsonb",       "mitigation_audit_logs", ["details"],
                    postgresql_using="gin")

    # ── network_logs ──────────────────────────────────────────────────────────
    op.create_table(
        "network_logs",
        sa.Column("id",                 sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("env",                sa.String(16),   nullable=False),
        sa.Column("severity",           sa.String(32),   nullable=False, server_default="Info"),
        sa.Column("source_ip",          sa.String(64),   nullable=False, server_default=""),
        sa.Column("dest_ip",            sa.String(64),   nullable=False, server_default=""),
        sa.Column("app",                sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("target_app",         sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("port",               sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("anomaly_type",       sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("bandwidth_pct",      sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("active_connections", sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("dropped_packets",    sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("bytes_transferred",  sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("detected_at",        sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("line_id",            sa.BigInteger(), nullable=True),
        sa.Column("level",              sa.String(32),   nullable=True),
        sa.Column("component",          sa.String(256),  nullable=True),
        sa.Column("content",            sa.Text(),       nullable=True),
        sa.Column("event_id",           sa.String(64),   nullable=True),
        sa.Column("event_template",     sa.Text(),       nullable=True),
        sa.Column("timestamp",          sa.String(64),   nullable=False, server_default=""),
        sa.Column("raw_payload",        postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
    )
    op.create_index("ix_network_logs_env",          "network_logs", ["env"])
    op.create_index("ix_network_logs_severity",     "network_logs", ["severity"])
    op.create_index("ix_network_logs_event_id",     "network_logs", ["event_id"])
    op.create_index("ix_network_logs_env_severity", "network_logs", ["env", "severity"])
    op.create_index("ix_network_logs_source_ip",    "network_logs", ["source_ip"])
    op.create_index("ix_network_logs_detected_at",  "network_logs", ["detected_at"])

    # ── api_logs ──────────────────────────────────────────────────────────────
    op.create_table(
        "api_logs",
        sa.Column("id",               sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("env",              sa.String(16),   nullable=False),
        sa.Column("severity",         sa.String(32),   nullable=False, server_default="Info"),
        sa.Column("app",              sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("target_app",       sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("source_ip",        sa.String(64),   nullable=False, server_default=""),
        sa.Column("path",             sa.String(512),  nullable=False, server_default="/"),
        sa.Column("method",           sa.String(16),   nullable=False, server_default="GET"),
        sa.Column("action",           sa.String(64),   nullable=False, server_default="OK"),
        sa.Column("endpoint",         sa.String(512),  nullable=False, server_default="/"),
        sa.Column("status_code",      sa.Integer(),    nullable=False, server_default="200"),
        sa.Column("response_time_ms", sa.Float(),      nullable=False, server_default="0.0"),
        sa.Column("logged_at",        sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("cost_per_call",    sa.Float(),      nullable=False, server_default="0.0"),
        sa.Column("trend_pct",        sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("calls_today",      sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("blocked_count",    sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("avg_latency_ms",   sa.Float(),      nullable=False, server_default="0.0"),
        sa.Column("estimated_cost",   sa.Float(),      nullable=False, server_default="0.0"),
        sa.Column("hour_label",       sa.String(16),   nullable=False, server_default=""),
        sa.Column("actual_calls",     sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("predicted_calls",  sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("line_id",          sa.BigInteger(), nullable=True),
        sa.Column("level",            sa.String(32),   nullable=True),
        sa.Column("component",        sa.String(256),  nullable=True),
        sa.Column("content",          sa.Text(),       nullable=True),
        sa.Column("event_id",         sa.String(64),   nullable=True),
        sa.Column("event_template",   sa.Text(),       nullable=True),
        sa.Column("timestamp",        sa.String(64),   nullable=False, server_default=""),
        sa.Column("raw_payload",      postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
    )
    op.create_index("ix_api_logs_env",          "api_logs", ["env"])
    op.create_index("ix_api_logs_severity",     "api_logs", ["severity"])
    op.create_index("ix_api_logs_event_id",     "api_logs", ["event_id"])
    op.create_index("ix_api_logs_env_severity", "api_logs", ["env", "severity"])
    op.create_index("ix_api_logs_env_action",   "api_logs", ["env", "action"])
    op.create_index("ix_api_logs_status_code",  "api_logs", ["status_code"])
    op.create_index("ix_api_logs_logged_at",    "api_logs", ["logged_at"])

    # ── endpoint_logs ─────────────────────────────────────────────────────────
    op.create_table(
        "endpoint_logs",
        sa.Column("id",             sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("env",            sa.String(16),   nullable=False),
        sa.Column("severity",       sa.String(32),   nullable=False, server_default="Low"),
        sa.Column("workstation_id", sa.String(128),  nullable=False, server_default="UNKNOWN"),
        sa.Column("employee",       sa.String(128),  nullable=False, server_default="Unknown"),
        sa.Column("avatar",         sa.String(512),  nullable=False, server_default=""),
        sa.Column("os_name",        sa.String(128),  nullable=False, server_default="Unknown"),
        sa.Column("target_app",     sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("alert_message",  sa.Text(),       nullable=False, server_default=""),
        sa.Column("alert_category", sa.String(128),  nullable=False, server_default="Unknown"),
        sa.Column("is_offline",     sa.Boolean(),    nullable=False, server_default=sa.false()),
        sa.Column("is_malware",     sa.Boolean(),    nullable=False, server_default=sa.false()),
        sa.Column("line_id",        sa.BigInteger(), nullable=True),
        sa.Column("level",          sa.String(32),   nullable=True),
        sa.Column("component",      sa.String(256),  nullable=True),
        sa.Column("content",        sa.Text(),       nullable=True),
        sa.Column("event_id",       sa.String(64),   nullable=True),
        sa.Column("event_template", sa.Text(),       nullable=True),
        sa.Column("timestamp",      sa.String(64),   nullable=False, server_default=""),
        sa.Column("raw_payload",    postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
    )
    op.create_index("ix_endpoint_logs_env",           "endpoint_logs", ["env"])
    op.create_index("ix_endpoint_logs_severity",      "endpoint_logs", ["severity"])
    op.create_index("ix_endpoint_logs_event_id",      "endpoint_logs", ["event_id"])
    op.create_index("ix_endpoint_logs_env_severity",  "endpoint_logs", ["env", "severity"])
    op.create_index("ix_endpoint_logs_env_malware",   "endpoint_logs", ["env", "is_malware"])
    op.create_index("ix_endpoint_logs_workstation",   "endpoint_logs", ["workstation_id"])

    # ── db_activity_logs ──────────────────────────────────────────────────────
    op.create_table(
        "db_activity_logs",
        sa.Column("id",                    sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("env",                   sa.String(16),   nullable=False),
        sa.Column("severity",              sa.String(32),   nullable=False, server_default="Info"),
        sa.Column("app",                   sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("target_app",            sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("db_user",               sa.String(128),  nullable=False, server_default="unknown"),
        sa.Column("query_type",            sa.String(32),   nullable=False, server_default="SELECT"),
        sa.Column("target_table",          sa.String(256),  nullable=False, server_default="unknown"),
        sa.Column("reason",                sa.Text(),       nullable=False, server_default=""),
        sa.Column("is_suspicious",         sa.Boolean(),    nullable=False, server_default=sa.false()),
        sa.Column("active_connections",    sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("avg_latency_ms",        sa.Float(),      nullable=False, server_default="0.0"),
        sa.Column("data_export_volume_tb", sa.Float(),      nullable=False, server_default="0.0"),
        sa.Column("hour_label",            sa.String(16),   nullable=False, server_default=""),
        sa.Column("select_count",          sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("insert_count",          sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("update_count",          sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("delete_count",          sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("line_id",               sa.BigInteger(), nullable=True),
        sa.Column("level",                 sa.String(32),   nullable=True),
        sa.Column("component",             sa.String(256),  nullable=True),
        sa.Column("content",               sa.Text(),       nullable=True),
        sa.Column("event_id",              sa.String(64),   nullable=True),
        sa.Column("event_template",        sa.Text(),       nullable=True),
        sa.Column("timestamp",             sa.String(64),   nullable=False, server_default=""),
        sa.Column("raw_payload",           postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
    )
    op.create_index("ix_db_activity_logs_env",             "db_activity_logs", ["env"])
    op.create_index("ix_db_activity_logs_severity",        "db_activity_logs", ["severity"])
    op.create_index("ix_db_activity_logs_event_id",        "db_activity_logs", ["event_id"])
    op.create_index("ix_db_activity_logs_env_severity",    "db_activity_logs", ["env", "severity"])
    op.create_index("ix_db_activity_logs_env_suspicious",  "db_activity_logs", ["env", "is_suspicious"])

    # ── alerts ────────────────────────────────────────────────────────────────
    op.create_table(
        "alerts",
        sa.Column("id",              sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("alert_id",        sa.String(128),  nullable=False, server_default=""),
        sa.Column("env",             sa.String(16),   nullable=False),
        sa.Column("app",             sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("message",         sa.Text(),       nullable=False, server_default=""),
        sa.Column("severity",        sa.String(32),   nullable=False, server_default="Low"),
        sa.Column("timestamp_label", sa.String(128),  nullable=False, server_default="recently"),
        sa.Column("raw_payload",     postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
    )
    op.create_index("ix_alerts_alert_id",    "alerts", ["alert_id"])
    op.create_index("ix_alerts_env",         "alerts", ["env"])
    op.create_index("ix_alerts_severity",    "alerts", ["severity"])
    op.create_index("ix_alerts_env_severity","alerts", ["env", "severity"])

    # ── anomaly_events ────────────────────────────────────────────────────────
    op.create_table(
        "anomaly_events",
        sa.Column("id",               sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("env",              sa.String(16),   nullable=False, server_default="cloud"),
        sa.Column("anomaly_type",     sa.String(64),   nullable=False),
        sa.Column("severity",         sa.String(16),   nullable=False, server_default="High"),
        sa.Column("target_app",       sa.String(256),  nullable=False, server_default="Unknown"),
        sa.Column("source_ip",        sa.String(64),   nullable=False, server_default=""),
        sa.Column("endpoint",         sa.String(512),  nullable=False, server_default=""),
        sa.Column("description",      sa.Text(),       nullable=False, server_default=""),
        sa.Column("metrics_snapshot", postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
        sa.Column("ai_explanation",   sa.Text(),       nullable=True),
        sa.Column("status",           sa.String(16),   nullable=False, server_default="Active"),
        sa.Column("detected_at",      sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("resolved_at",      sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_anomaly_events_env",          "anomaly_events", ["env"])
    op.create_index("ix_anomaly_events_anomaly_type", "anomaly_events", ["anomaly_type"])
    op.create_index("ix_anomaly_events_severity",     "anomaly_events", ["severity"])
    op.create_index("ix_anomaly_events_status",       "anomaly_events", ["status"])
    op.create_index("ix_anomaly_events_detected_at",  "anomaly_events", ["detected_at"])
    op.create_index("ix_anomaly_events_env_type",     "anomaly_events", ["env", "anomaly_type"])
    op.create_index("ix_anomaly_events_env_status",   "anomaly_events", ["env", "status"])
    op.create_index("ix_anomaly_events_env_severity", "anomaly_events", ["env", "severity"])
    op.create_index("ix_anomaly_events_metrics",      "anomaly_events", ["metrics_snapshot"],
                    postgresql_using="gin")


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("anomaly_events")
    op.drop_table("alerts")
    op.drop_table("db_activity_logs")
    op.drop_table("endpoint_logs")
    op.drop_table("api_logs")
    op.drop_table("network_logs")
    op.drop_table("mitigation_audit_logs")
    op.drop_table("s3_ingest_cursor")
    op.drop_table("incidents")
    op.drop_table("report_downloads")
    op.drop_table("scheduled_reports")
    op.drop_table("quarantined_endpoints")
    op.drop_table("app_configs")
    op.drop_table("microservices")
    op.drop_table("applications")
    op.drop_table("user_sessions")
    op.drop_table("atlas_users")
