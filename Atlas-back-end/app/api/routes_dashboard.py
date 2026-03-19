"""
api/routes_dashboard.py — Read-Only Dashboard Endpoints

Anomaly Command Center scope — only these routes are active:

  GET /header-data       → HeaderData
  GET /users             → List[TeamUser]
  GET /overview          → OverviewData   (repurposed: anomaly command center KPIs)
  GET /endpoint-security → EndpointSecurityData  (Wazuh events + agent topology)
  GET /network-traffic   → NetworkTrafficData     (Zeek anomalies)

REMOVED in this refactor:
  GET /api-monitoring     — API Monitoring domain retired
  GET /database-monitoring — DB Monitoring domain retired
  GET /case-management   — Case Management moved to standalone phase
  GET /incidents         — Incident list retired from this router
  GET /reports/overview  — Reports domain retired
"""

import logging
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.services.auth_service import get_current_user
from app.models.schemas import (
    EndpointSecurityData,
    HeaderData,
    NetworkTrafficData,
    OverviewData,
    TeamUser,
    User,
)
from app.services.query import (
    endpoint_service,
    network_service,
    overview_service,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ATLAS Dashboard (Read-Only)"])


# ── Header & Users ─────────────────────────────────────────────────────────────

@router.get("/header-data", response_model=HeaderData)
async def get_header_data(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> HeaderData:
    """
    Top-bar payload: current user profile, application list, recent alerts.
    Recent alerts are sourced live from endpoint_logs (Critical + High, last 10).
    """
    header_data = await overview_service.get_header_data(current_user.env, db)
    header_data.user = User(
        name=current_user.name,
        email=current_user.email,
        avatar=current_user.avatar or "",
    )
    return header_data


@router.get("/users", response_model=List[TeamUser])
async def get_users(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> List[TeamUser]:
    """All platform users for the given environment — used by Settings > User Access."""
    return await overview_service.get_team_users(current_user.env, db)


# ── Command Center ─────────────────────────────────────────────────────────────

@router.get("/overview", response_model=OverviewData)
async def get_overview(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> OverviewData:
    """
    Anomaly Command Center landing page payload.
    Combines endpoint alert KPIs, recent TrafficAnomaly records, and
    system anomaly feed (active/contained Incidents).
    """
    return await overview_service.get_overview(current_user.env, db)


# ── Telemetry Domains ──────────────────────────────────────────────────────────

@router.get("/endpoint-security", response_model=EndpointSecurityData)
async def get_endpoint_security(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> EndpointSecurityData:
    """
    Wazuh endpoint telemetry: agent topology, OS distribution, malware count,
    alert-type breakdown, and live Wazuh event feed.
    """
    logger.info("[Dashboard] Endpoint Security requested by %s (env=%s)",
                current_user.email, current_user.env)
    return await endpoint_service.get_endpoint_security(current_user.env, db)


@router.get("/network-traffic", response_model=NetworkTrafficData)
async def get_network_traffic(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> NetworkTrafficData:
    """
    Zeek-sourced network anomalies: bandwidth, active connections,
    dropped packets, and the top suspicious source-IP table.
    """
    return await network_service.get_network_traffic(current_user.env, db)
