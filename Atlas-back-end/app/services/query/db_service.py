"""
query/db_service.py — Database Monitoring Domain Service

Owns: get_db_monitoring()
Data source: Apache-derived DB DataFrame via log_loader.load_db_df()
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import (
    DbMonitoringData,
    DlpByTargetApp,
    OperationsByApp,
    SuspiciousActivity,
)
from app.services.connectors.log_loader import load_db_df

logger = logging.getLogger(__name__)

_EMPTY = DbMonitoringData(
    activeConnections=0,
    avgQueryLatency=0.0,
    dataExportVolume=0.0,
    operationsByApp=[],
    dlpByTargetApp=[],
    suspiciousActivity=[],
)


async def get_db_monitoring(env: str, db: AsyncSession) -> DbMonitoringData:
    """
    Assembles Database Monitoring page data from the mock DB DataFrame.

    db accepted for interface parity — not queried here yet.
    Once the DbActivityLog PostgreSQL table is populated (via log_ingestion),
    replace load_db_df() with a direct SQLAlchemy query.
    """
    df = await load_db_df()
    if df.empty:
        return _EMPTY

    d = df[df["env"] == env]
    if d.empty:
        return _EMPTY

    # ── KPI scalars ───────────────────────────────────────────────────────────
    active_connections = int(d["active_connections"].mean())
    avg_latency        = float(d["avg_latency_ms"].mean().round(1))
    export_volume      = float(d["data_export_volume_tb"].sum().round(2))

    # ── Operations breakdown per app ──────────────────────────────────────────
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

    # ── DLP events — suspicious rows grouped by app ───────────────────────────
    susp = d[d["is_suspicious"]]
    dlp_agg = (
        susp.groupby("app")
        .size()
        .reset_index(name="count")
        .sort_values("count", ascending=False)
    )
    dlp_by_target_app = [
        DlpByTargetApp(app=row["app"], count=int(row["count"]))
        for _, row in dlp_agg.iterrows()
    ]

    # ── Suspicious activity feed (top 25) ─────────────────────────────────────
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
