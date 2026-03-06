"""
api/routes.py — All ATLAS API Route Handlers
"""

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.services.auth_service import get_current_user  # <-- Added Security Dependency
from app.models.schemas import (
    ApiBlockRouteRequest,
    ApiMonitoringData,
    DbMonitoringData,
    DbKillQueryRequest,
    EndpointSecurityData,
    HeaderData,
    Incident,
    NetworkBlockRequest,
    NetworkTrafficData,
    OverviewData,
    QuarantineRequest,
    QuarantineResponse,
    RemediateRequest,
    RemediateResponse,
    User,
)
from app.services import query_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ATLAS Dashboard"])


# ─────────────────────────────────────────────────────────────────────────────
# Overview
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/overview", response_model=OverviewData, summary="Overview dashboard KPIs")
async def get_overview(
    env: str = "cloud", # Kept to not break frontend apiClient URL generation
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user), # <-- SECURED
) -> OverviewData:
    # Security: Force the query to use the user's actual environment, preventing cross-env leakage
    secure_env = current_user.env
    return await query_service.get_overview(secure_env, db)


# ─────────────────────────────────────────────────────────────────────────────
# API Monitoring
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api-monitoring", response_model=ApiMonitoringData, summary="API Monitoring metrics")
async def get_api_monitoring(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> ApiMonitoringData:
    return await query_service.get_api_monitoring(current_user.env, db)


@router.post("/api-monitoring/block-route", summary="Apply hard block on an API route")
async def block_api_route(
    payload: ApiBlockRouteRequest,
    current_user: AtlasUser = Depends(get_current_user),
) -> dict:
    logger.info(f"[API BLOCK] Hard block requested by {current_user.email} for app={payload.app} path={payload.path}")
    return {"success": True, "message": f"Hard block applied for route {payload.app} {payload.path}."}


# ─────────────────────────────────────────────────────────────────────────────
# Network Traffic
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/network-traffic", response_model=NetworkTrafficData, summary="Network Traffic monitoring")
async def get_network_traffic(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> NetworkTrafficData:
    return await query_service.get_network_traffic(current_user.env, db)


@router.post("/network-traffic/block", summary="Apply hard block on source IP")
async def block_network_source(
    payload: NetworkBlockRequest,
    current_user: AtlasUser = Depends(get_current_user),
) -> dict:
    logger.info(f"[NETWORK BLOCK] Requested by {current_user.email} for IP={payload.sourceIp}")
    return {"success": True, "message": f"Hard block applied for source {payload.sourceIp}."}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint Security
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/endpoint-security", response_model=EndpointSecurityData, summary="Endpoint Security")
async def get_endpoint_security(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> EndpointSecurityData:
    return await query_service.get_endpoint_security(current_user.env, db)


@router.post("/endpoint-security/quarantine", response_model=QuarantineResponse, summary="Quarantine a workstation")
async def quarantine_device(
    payload: QuarantineRequest,
    current_user: AtlasUser = Depends(get_current_user),
) -> QuarantineResponse:
    if not payload.workstationId:
        raise HTTPException(status_code=400, detail="workstationId is required.")

    logger.warning(f"[QUARANTINE] Command sent by {current_user.email} for {payload.workstationId}")
    return QuarantineResponse(success=True, message=f"Device {payload.workstationId} has been quarantined.")


# ─────────────────────────────────────────────────────────────────────────────
# Database Monitoring
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/db-monitoring", response_model=DbMonitoringData, summary="Database Activity Monitoring")
async def get_db_monitoring(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> DbMonitoringData:
    return await query_service.get_db_monitoring(current_user.env, db)


@router.post("/db-monitoring/kill-query", summary="Kill a suspicious query")
async def kill_db_query(
    payload: DbKillQueryRequest,
    current_user: AtlasUser = Depends(get_current_user),
) -> dict:
    logger.info(f"[DB KILL] Requested by {current_user.email} for activityId={payload.activityId}")
    return {"success": True, "message": f"Kill-query command sent for activity {payload.activityId}."}


# ─────────────────────────────────────────────────────────────────────────────
# Incidents
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/incidents", response_model=List[Incident], summary="List security incidents")
async def get_incidents(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> List[Incident]:
    return await query_service.get_incidents(current_user.env, db)


@router.post("/incidents/remediate", response_model=RemediateResponse, summary="Execute remediation")
async def remediate_incident(
    payload: RemediateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> RemediateResponse:
    if not payload.incidentId or not payload.action:
        raise HTTPException(status_code=400, detail="incidentId and action are required.")

    logger.info(f"[REMEDIATE] Action '{payload.action}' requested by {current_user.email} for {payload.incidentId}")

    status_map = {
        "Dismiss": "Closed",
        "Block IP": "Contained",
        "Isolate Endpoint": "Contained",
    }
    new_status = status_map.get(payload.action)

    if new_status:
        await query_service.update_incident_status(payload.incidentId, new_status, db)

    return RemediateResponse(success=True, message=f"Action '{payload.action}' initiated.")


# ─────────────────────────────────────────────────────────────────────────────
# Header Data (Bell icon + app selector)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/header-data", response_model=HeaderData, summary="Header: user, apps, alerts")
async def get_header_data(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> HeaderData:
    
    # Fetch the applications and alerts using the secure environment
    header_data = await query_service.get_header_data(current_user.env, db)
    
    # Override the generic user profile with the actual authenticated user
    header_data.user = User(
        name=current_user.name,
        email=current_user.email,
        avatar=current_user.avatar or ""
    )
    
    return header_data