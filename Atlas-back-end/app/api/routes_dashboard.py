"""
api/routes_dashboard.py — All Read-Only Dashboard Endpoints

REVISION SUMMARY:
- Optimized for Real-Time Wazuh data: sorting focused on newest-first.
- Added logging for Endpoint Security to track live agent data flow.
- Removed dead Figma endpoints that are not used by the frontend.
"""

import logging
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.services.auth_service import get_current_user
from app.models.schemas import (
    ApiMonitoringData, CaseManagementResponse, DbMonitoringData, 
    EndpointSecurityData, HeaderData, Incident, NetworkTrafficData, 
    OverviewData, ReportsOverviewResponse, TeamUser, User
)
from app.services import query_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ATLAS Dashboard (Read-Only)"])

# ── Header & Users ────────────────────────────────────────────────────────────

@router.get("/header-data", response_model=HeaderData)
async def get_header_data(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> HeaderData:
    header_data = await query_service.get_header_data(current_user.env, db)
    header_data.user = User(
        name=current_user.name, 
        email=current_user.email, 
        avatar=current_user.avatar or ""
    )
    return header_data

@router.get("/users", response_model=List[TeamUser])
async def get_users(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> List[TeamUser]:
    return await query_service.get_team_users(current_user.env, db)

# ── Standard Dashboard Endpoints ─────────────────────────────────────────────

@router.get("/overview", response_model=OverviewData)
async def get_overview(db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    return await query_service.get_overview(current_user.env, db)

@router.get("/endpoint-security", response_model=EndpointSecurityData)
async def get_endpoint_security(db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    # Log the request so you can see when the frontend is polling for your real laptops
    logger.info(f"Fetching Endpoint Security data for {current_user.env}")
    return await query_service.get_endpoint_security(current_user.env, db)

@router.get("/network-traffic", response_model=NetworkTrafficData)
async def get_network_traffic(db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    return await query_service.get_network_traffic(current_user.env, db)

@router.get("/api-monitoring", response_model=ApiMonitoringData)
async def get_api_monitoring(db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    return await query_service.get_api_monitoring(current_user.env, db)

@router.get("/database-monitoring", response_model=DbMonitoringData)
async def get_database_monitoring(db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    return await query_service.get_db_monitoring(current_user.env, db)

# ── Case Management & Reports ─────────────────────────────────────────────────

@router.get("/incidents", response_model=List[Incident])
async def get_incidents(db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    """Fetches full incident list, sorted by timestamp descending via query_service."""
    return await query_service.get_incidents(current_user.env, db)

@router.get("/case-management", response_model=CaseManagementResponse)
async def get_case_management(db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    """Used for the main Incident Investigation screen."""
    return await query_service.get_case_management(current_user.env, db)

@router.get("/reports/overview", response_model=ReportsOverviewResponse)
async def get_reports_overview(db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    return await query_service.get_reports_overview(current_user.env, db)