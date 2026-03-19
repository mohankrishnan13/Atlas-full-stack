"""
query/overview_service.py — Overview, Header & User Services

Simplified version for Command Center.

Overview now relies only on:
  • EndpointLog       — API traffic counts
  • TrafficAnomaly    — command center anomalies

Removed:
  • Microservice topology
  • CSV / Pandas log loading
  • Application model usage
"""

from __future__ import annotations

import asyncio
import logging
from typing import List

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models import (
    AtlasUser,
    EndpointLog,
    Incident,
    TrafficAnomaly,
)

from app.models.schemas import (
    AppAnomaly,
    HeaderData,
    OverviewData,
    RecentAlert,
    SystemAnomaly,
    TeamUser,
    User,
)

logger = logging.getLogger(__name__)


# ─── Internal helpers ─────────────────────────────────────────────────────────


async def _fetch_app_anomaly_counts(env: str, db: AsyncSession) -> List[AppAnomaly]:
    """
    Count EndpointLog rows grouped by target_app.
    """
    stmt = (
        select(
            func.coalesce(EndpointLog.target_app, "Endpoint Agent").label("target_app"),
            func.count(EndpointLog.id).label("anomalies"),
        )
        .where(EndpointLog.env == env)
        .group_by(EndpointLog.target_app)
        .order_by(func.count(EndpointLog.id).desc())
        .limit(8)
    )

    result = await db.execute(stmt)

    return [
        AppAnomaly(
            name=row.target_app or "Endpoint Agent",
            anomalies=int(row.anomalies),
        )
        for row in result.all()
    ]


async def _fetch_system_anomalies(env: str, db: AsyncSession) -> List[SystemAnomaly]:
    """
    Command Center anomaly feed from TrafficAnomaly table.
    """
    result = await db.execute(
        select(TrafficAnomaly)
        .where(TrafficAnomaly.env == env)
        .order_by(TrafficAnomaly.timestamp.desc())
        .limit(10)
    )

    return [
        SystemAnomaly(
            id=a.anomaly_id,
            service=a.target_app,
            type=a.anomaly_type,
            severity=a.severity,
            timestamp=a.timestamp,
        )
        for a in result.scalars().all()
    ]


# ─── Public service functions ─────────────────────────────────────────────────


async def get_overview(env: str, db: AsyncSession) -> OverviewData:
    """
    Command Center overview.

    Data sources:
      • EndpointLog       → traffic counts
      • TrafficAnomaly    → anomaly feed
    """

    api_requests_q = db.execute(
        select(func.count())
        .select_from(EndpointLog)
        .where(EndpointLog.env == env)
    )

    blocked_q = db.execute(
        select(func.count())
        .select_from(EndpointLog)
        .where(
            EndpointLog.env == env,
            EndpointLog.action == "Blocked",
        )
    )

    alerts_q = db.execute(
        select(func.count())
        .select_from(EndpointLog)
        .where(
            EndpointLog.env == env,
            EndpointLog.severity.in_(["Critical", "High"]),
        )
    )

    anomalies_fut = _fetch_app_anomaly_counts(env, db)
    system_fut = _fetch_system_anomalies(env, db)

    api_res, blocked_res, alerts_res, app_anomalies, system_anomalies = await asyncio.gather(
        api_requests_q,
        blocked_q,
        alerts_q,
        anomalies_fut,
        system_fut,
    )

    api_requests = api_res.scalar() or 0
    blocked = blocked_res.scalar() or 0
    active_alerts = alerts_res.scalar() or 0

    error_rate = round((blocked / max(api_requests, 1)) * 100, 1)
    cost_risk = min(10, int(error_rate))

    return OverviewData(
        apiRequests=api_requests,
        errorRate=error_rate,
        activeAlerts=active_alerts,
        costRisk=cost_risk,
        appAnomalies=app_anomalies,
        systemAnomalies=system_anomalies,
    )


async def get_header_data(env: str, db: AsyncSession) -> HeaderData:
    """
    Top bar payload: user + recent alerts.
    """

    user_q = db.execute(
        select(AtlasUser)
        .where(AtlasUser.env == env)
        .order_by(AtlasUser.id.asc())
        .limit(1)
    )

    alerts_q = db.execute(
        select(EndpointLog)
        .where(
            EndpointLog.env == env,
            EndpointLog.severity.in_(["Critical", "High"]),
        )
        .order_by(EndpointLog.id.desc())
        .limit(10)
    )

    user_res, alerts_res = await asyncio.gather(user_q, alerts_q)

    user_row = user_res.scalars().first()
    _fallback_email = get_settings().seed_analyst_email

    user = User(
        name=user_row.name if user_row else "SOC Analyst",
        email=user_row.email if user_row else _fallback_email,
        avatar=user_row.avatar if user_row else "",
    )

    recent_alerts = [
        RecentAlert(
            id=f"REAL-{ep.id}",
            app=ep.os_name or "Endpoint",
            message=ep.alert_message[:100],
            severity=ep.severity,
            timestamp="Just now",
        )
        for ep in alerts_res.scalars().all()
    ]

    return HeaderData(
        user=user,
        applications=[],
        recentAlerts=recent_alerts,
    )


async def get_team_users(env: str, db: AsyncSession) -> List[TeamUser]:
    """
    Return all platform users.
    """

    rows = (
        await db.execute(
            select(AtlasUser)
            .where(AtlasUser.env == env)
            .order_by(AtlasUser.id.asc())
        )
    ).scalars().all()

    return [
        TeamUser(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            avatar=u.avatar or "",
            is_active=u.is_active,
            invite_pending=u.invite_pending,
        )
        for u in rows
    ]