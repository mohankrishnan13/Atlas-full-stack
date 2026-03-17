"""
query/api_service.py — API Monitoring Domain Service

Owns: get_api_monitoring()
Data source: Apache Loghub CSV via log_loader.load_api_df()
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import (
    ApiConsumptionByApp,
    ApiMonitoringData,
    ApiRoute,
)
from app.services.connectors.log_loader import load_api_df

logger = logging.getLogger(__name__)

_EMPTY = ApiMonitoringData(
    apiCallsToday=0,
    blockedRequests=0,
    avgLatency=0.0,
    estimatedCost=0.0,
    apiConsumptionByApp=[],
    apiRouting=[],
)


async def get_api_monitoring(env: str, db: AsyncSession) -> ApiMonitoringData:
    """
    Assembles API Monitoring page data from the Apache CSV DataFrame.

    db is accepted for interface consistency with the other services — it is
    not queried here because all API data comes from the Pandas mock layer.
    It is available for a future migration to live PostgreSQL api_logs.
    """
    df = await load_api_df()
    if df.empty:
        return _EMPTY

    a = df[df["env"] == env]
    if a.empty:
        return _EMPTY

    # ── KPI scalars ───────────────────────────────────────────────────────────
    total     = int(a["calls_today"].sum())
    blocked   = int((a["action"] == "Blocked").sum())
    avg_lat   = float(a["avg_latency_ms"].mean().round(1))
    est_cost  = float(a["estimated_cost"].sum().round(2))

    # ── API consumption by app (actual vs limit) ──────────────────────────────
    agg = (
        a.groupby("target_app")
        .agg(actual=("calls_today", "mean"))
        .reset_index()
    )
    agg["actual"] = agg["actual"].astype(int)
    agg["limit"]  = (agg["actual"] * 1.2).astype(int)

    # Flip the limit below actual for blocked apps — UI shows them as overuse.
    blocked_apps = a[a["action"] == "Blocked"]["target_app"].unique()
    agg.loc[agg["target_app"].isin(blocked_apps), "limit"] = (
        agg.loc[agg["target_app"].isin(blocked_apps), "actual"] * 0.9
    ).astype(int)

    api_consumption = [
        ApiConsumptionByApp(
            app=row["target_app"],
            actual=int(row["actual"]),
            limit=int(row["limit"]),
        )
        for _, row in agg.sort_values("actual", ascending=False).head(12).iterrows()
    ]

    # ── Route table (top 50 by cost) ──────────────────────────────────────────
    route_agg = (
        a.groupby(["target_app", "path"])
        .agg(
            method=("method",      "first"),
            cost=  ("cost_per_call","first"),
            trend= ("trend_pct",   "first"),
            action=("action",      lambda x: x.mode()[0] if len(x) > 0 else "OK"),
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
