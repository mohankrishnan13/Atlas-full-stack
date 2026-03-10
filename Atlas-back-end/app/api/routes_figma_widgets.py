"""api/routes_figma_widgets.py — Pixel-perfect Figma widget endpoints.

These endpoints exist specifically to power the Figma-derived UI layouts
without leaking mock data into the frontend. They assemble screenshot-shaped
payloads from existing DB tables.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.models.schemas import (
    FigmaApiMonitoringResponse,
    FigmaDashboardResponse,
    FigmaDatabaseMonitoringResponse,
    FigmaEndpointSecurityResponse,
    FigmaNetworkTrafficResponse,
)
from app.services import query_service
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/figma", tags=["Figma Widgets"])


@router.get("/dashboard", response_model=FigmaDashboardResponse)
async def figma_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> FigmaDashboardResponse:
    return await query_service.get_figma_dashboard(current_user.env, db)


@router.get("/api-monitoring", response_model=FigmaApiMonitoringResponse)
async def figma_api_monitoring(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> FigmaApiMonitoringResponse:
    return await query_service.get_figma_api_monitoring(current_user.env, db)


@router.get("/network-traffic", response_model=FigmaNetworkTrafficResponse)
async def figma_network_traffic(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> FigmaNetworkTrafficResponse:
    return await query_service.get_figma_network_traffic(current_user.env, db)


@router.get("/endpoint-security", response_model=FigmaEndpointSecurityResponse)
async def figma_endpoint_security(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> FigmaEndpointSecurityResponse:
    return await query_service.get_figma_endpoint_security(current_user.env, db)


@router.get("/database-monitoring", response_model=FigmaDatabaseMonitoringResponse)
async def figma_database_monitoring(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> FigmaDatabaseMonitoringResponse:
    return await query_service.get_figma_database_monitoring(current_user.env, db)

