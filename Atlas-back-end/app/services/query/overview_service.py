"""
query/overview_service.py — Overview, Header & User Services

Owns:
  get_overview()    — dashboard landing page
  get_header_data() — top-bar user/app/alerts
  get_team_users()  — Settings > User Access tab

Orchestration pattern
─────────────────────
get_overview() combines two data sources and must do so concurrently:
  1. CSV mock data (Pandas) — via log_loader.load_api_df()
  2. PostgreSQL live data — EndpointLog, Incident, Microservice, etc.

asyncio.gather() is used to fire both I/O operations in parallel.

Pandas reduction in get_overview()
────────────────────────────────────
The old code used _get_real_endpoint_df() which converted ORM rows to a
DataFrame just to run groupby("target_app").size().  We replace that with
a direct SQL COUNT + GROUP BY query via SQLAlchemy — same result, no
DataFrame allocation, no Pandas dependency in this module.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models import (
    Application as ApplicationRow,
    AtlasUser,
    EndpointLog,
    Incident,
    Microservice as MicroserviceRow,
)
from app.models.schemas import (
    AppAnomaly,
    Application,
    ApiRequestsByApp,
    HeaderData,
    Microservice,
    OverviewData,
    RecentAlert,
    SystemAnomaly,
    TeamUser,
    User,
)
from app.services.connectors.log_loader import load_api_df

logger = logging.getLogger(__name__)


# ─── Internal helpers ─────────────────────────────────────────────────────────

async def _fetch_app_anomaly_counts(env: str, db: AsyncSession) -> List[AppAnomaly]:
    """
    Counts EndpointLog rows grouped by target_app for the given env.

    Replaces the old pattern:
        e = await _get_real_endpoint_df(env, db)   # ORM → DataFrame
        anom_counts = e.groupby("target_app").size()  # Pandas groupby

    With a single SQL GROUP BY — cheaper and Pandas-free.

    If target_app is empty/null (logs ingested before the column existed),
    those rows are grouped under the label "Endpoint Agent".
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
        AppAnomaly(name=row.target_app or "Endpoint Agent", anomalies=int(row.anomalies))
        for row in result.all()
    ]


async def _fetch_microservices(env: str, db: AsyncSession) -> List[Microservice]:
    """Loads microservice topology from PostgreSQL for the Attack Surface diagram."""
    rows = (
        await db.execute(
            select(MicroserviceRow)
            .where(MicroserviceRow.env == env)
            .order_by(MicroserviceRow.id.asc())
        )
    ).scalars().all()

    return [
        Microservice(
            id=s.service_id,
            name=s.name,
            type="Gateway" if "gateway" in s.name.lower() else "Service",
            status=s.status,
            position={"top": s.position_top, "left": s.position_left},
            connections=[c for c in (s.connections_csv or "").split(",") if c],
        )
        for s in rows
    ]


async def _fetch_system_anomalies(env: str, db: AsyncSession) -> List[SystemAnomaly]:
    """Returns the 5 most recent active/contained incidents for the anomaly feed."""
    result = await db.execute(
        select(Incident)
        .where(
            Incident.env == env,
            Incident.status.in_(["Active", "Contained"]),
        )
        .order_by(Incident.timestamp.desc())
        .limit(5)
    )
    return [
        SystemAnomaly(
            id=inc.incident_id,
            service=inc.target_app,
            type=inc.event_name,
            severity=inc.severity,
            timestamp=inc.timestamp,
        )
        for inc in result.scalars().all()
    ]


# ─── Public service functions ─────────────────────────────────────────────────

async def get_overview(env: str, db: AsyncSession) -> OverviewData:
    """
    Assembles the Security Overview landing-page payload.

    Concurrent I/O strategy
    ────────────────────────
    Four independent data sources are launched simultaneously with gather():
      • API DataFrame (CSV/Pandas) — for KPIs and request charts
      • App anomaly counts (SQL)    — endpoint alert grouping
      • Microservice topology (SQL) — attack surface diagram
      • Active incidents (SQL)      — system anomaly feed

    On a warm cache the CSV fetch resolves in ~1 μs; on a cold cache it goes
    through asyncio.to_thread so the DB queries run in parallel with CSV I/O.
    """
    api_df_fut    = load_api_df()
    anomalies_fut = _fetch_app_anomaly_counts(env, db)
    services_fut  = _fetch_microservices(env, db)
    incidents_fut = _fetch_system_anomalies(env, db)

    api_df, app_anomalies, microservices, system_anomalies = await asyncio.gather(
        api_df_fut, anomalies_fut, services_fut, incidents_fut
    )

    # ── API KPIs from CSV DataFrame ───────────────────────────────────────────
    a = api_df[api_df["env"] == env] if not api_df.empty else api_df.__class__()

    api_requests  = int(a["calls_today"].sum())    if not a.empty else 0
    active_alerts = int(a["severity"].isin(["Critical", "High"]).sum()) if not a.empty else 0
    total_calls   = len(a)
    blocked       = int((a["action"] == "Blocked").sum()) if not a.empty else 0
    error_rate    = round((blocked / max(total_calls, 1)) * 100, 1)
    cost_risk     = min(10, int((blocked / max(total_calls, 1)) * 100))

    # ── API requests-per-app chart ────────────────────────────────────────────
    if not a.empty:
        rpm_counts = (
            a.groupby("target_app")
            .size()
            .reset_index(name="requests")
            .sort_values("requests", ascending=False)
            .head(12)
        )
        api_requests_by_app = [
            ApiRequestsByApp(app=row["target_app"], requests=int(row["requests"]))
            for _, row in rpm_counts.iterrows()
        ]
    else:
        api_requests_by_app = []

    # ── Failing endpoints (high-severity paths from CSV) ──────────────────────
    failing_endpoints: Dict[str, str] = {}
    if not a.empty:
        fe = (
            a[a["severity"].isin(["High", "Critical"])]
            .groupby("path")
            .size()
            .reset_index(name="cnt")
            .sort_values("cnt", ascending=False)
            .head(10)
        )
        for _, row in fe.iterrows():
            if row["cnt"] > 0:
                failing_endpoints[row["path"]] = str(int(row["cnt"]))

    return OverviewData(
        apiRequests=api_requests,
        errorRate=error_rate,
        activeAlerts=active_alerts,
        costRisk=cost_risk,
        appAnomalies=app_anomalies,
        microservices=microservices,
        failingEndpoints=failing_endpoints,
        apiRequestsByApp=api_requests_by_app,
        systemAnomalies=system_anomalies,
    )


async def get_header_data(env: str, db: AsyncSession) -> HeaderData:
    """
    Assembles the top-bar payload: current user, application list, recent alerts.

    Recent alerts are sourced from PostgreSQL endpoint_logs (Critical + High
    severity, most recent 10) — live data, not CSV mock.
    """
    # Run user, apps, and alerts queries concurrently.
    user_q = db.execute(
        select(AtlasUser)
        .where(AtlasUser.env == env)
        .order_by(AtlasUser.id.asc())
        .limit(1)
    )
    apps_q = db.execute(
        select(ApplicationRow)
        .where(ApplicationRow.env == env)
        .order_by(ApplicationRow.id.asc())
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

    user_res, apps_res, alerts_res = await asyncio.gather(user_q, apps_q, alerts_q)

    user_row = user_res.scalars().first()
    _fallback_email = get_settings().seed_analyst_email
    user = User(
        name=user_row.name   if user_row else "SOC Analyst",
        email=user_row.email if user_row else _fallback_email,
        avatar=user_row.avatar if user_row else "",
    )

    applications = [
        Application(id=a.app_id, name=a.name)
        for a in apps_res.scalars().all()
    ]

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

    return HeaderData(user=user, applications=applications, recentAlerts=recent_alerts)


async def get_team_users(env: str, db: AsyncSession) -> List[TeamUser]:
    """
    Returns all platform users for the given environment.

    Native comprehension over ORM rows — no DataFrame conversion needed.
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
