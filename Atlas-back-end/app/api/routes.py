"""
api/routes.py — All ATLAS API Route Handlers

Routes are grouped by functional area but kept in a single file to make
the API contract obvious at a glance. Each route:
  1. Validates the `env` query parameter.
  2. Delegates to the query_service for all data assembly.
  3. Returns a typed Pydantic response — FastAPI serialises it to JSON.

CRITICAL: Route paths MUST match the apiFetch() calls in the React frontend
(src/lib/api.ts). The frontend calls paths like `/overview`, `/incidents`,
etc. against NEXT_PUBLIC_ATLAS_BACKEND_URL (default: http://localhost:8000).
"""

import logging
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
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
    TeamUser,
)
from app.services import query_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ATLAS Dashboard"])

ENV_VALUES = Literal["cloud", "local"]


def _validate_env(env: str) -> str:
    """Normalises and validates the env parameter."""
    env = env.lower()
    if env not in ("cloud", "local"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid env '{env}'. Must be 'cloud' or 'local'.",
        )
    return env


# ─────────────────────────────────────────────────────────────────────────────
# Overview
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/overview", response_model=OverviewData, summary="Overview dashboard KPIs")
async def get_overview(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
) -> OverviewData:
    """
    Powers the Overview page.
    Returns KPI stats, microservice topology, anomalies chart, and system
    anomaly table derived from live PostgreSQL data.
    """
    env = _validate_env(env)
    return await query_service.get_overview(env, db)


# ─────────────────────────────────────────────────────────────────────────────
# API Monitoring
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api-monitoring", response_model=ApiMonitoringData, summary="API Monitoring metrics")
async def get_api_monitoring(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
) -> ApiMonitoringData:
    """
    Powers the API Monitoring page.
    Returns call volumes, latency, cost metrics, apiConsumptionByApp, and per-route abuse table.
    """
    env = _validate_env(env)
    return await query_service.get_api_monitoring(env, db)


@router.post(
    "/api-monitoring/block-route",
    summary="Apply hard block on an API route (app + path)",
)
async def block_api_route(payload: ApiBlockRouteRequest) -> dict:
    """
    MVP: Logs the block. Production: call API gateway/WAF to block the route for the app.
    """
    logger.info(
        f"[API BLOCK] Hard block requested for app={payload.app} path={payload.path}"
    )
    return {
        "success": True,
        "message": f"Hard block applied for route {payload.app} {payload.path}.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Network Traffic
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/network-traffic", response_model=NetworkTrafficData, summary="Network Traffic monitoring")
async def get_network_traffic(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
) -> NetworkTrafficData:
    """
    Powers the Network Traffic page.
    Returns bandwidth, connection counts, dropped packets, and anomaly table.
    """
    env = _validate_env(env)
    return await query_service.get_network_traffic(env, db)


@router.post(
    "/network-traffic/block",
    summary="Apply hard block on source IP / app (mitigation action)",
)
async def block_network_source(payload: NetworkBlockRequest) -> dict:
    """
    MVP: Logs the block action. Production: call firewall/WAF API to block the IP for the given app.
    """
    logger.info(
        f"[NETWORK BLOCK] Hard block requested for sourceIp={payload.sourceIp} app={payload.app}"
    )
    return {
        "success": True,
        "message": f"Hard block applied for source {payload.sourceIp} (app: {payload.app}).",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint Security
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/endpoint-security", response_model=EndpointSecurityData, summary="Endpoint Security (Velociraptor)")
async def get_endpoint_security(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
) -> EndpointSecurityData:
    """
    Powers the Endpoint Security page.
    In MVP mode, returns data ingested from local Velociraptor-format JSONL files.
    In production, data flows from live Velociraptor webhooks via POST /webhooks/velociraptor.
    """
    env = _validate_env(env)
    return await query_service.get_endpoint_security(env, db)


@router.post(
    "/endpoint-security/quarantine",
    response_model=QuarantineResponse,
    summary="Quarantine a workstation",
)
async def quarantine_device(payload: QuarantineRequest) -> QuarantineResponse:
    """
    Sends a quarantine command to an endpoint.

    MVP: Logs the action and returns success.
    Production: This should call the Velociraptor gRPC API to issue an
    isolation artifact (Windows.Remediation.Quarantine) to the agent.
    See FUTURE_IMPLEMENTATION.md for the exact API call.
    """
    if not payload.workstationId:
        raise HTTPException(status_code=400, detail="workstationId is required.")

    logger.info(
        f"[QUARANTINE] Quarantine command received for workstation: {payload.workstationId}"
    )
    # TODO (Production): await velociraptor_client.isolate_host(payload.workstationId)

    return QuarantineResponse(
        success=True,
        message=f"Device {payload.workstationId} has been quarantined.",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Database Monitoring
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/db-monitoring", response_model=DbMonitoringData, summary="Database Activity Monitoring")
async def get_db_monitoring(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
) -> DbMonitoringData:
    """
    Powers the Database Monitoring page.
    Returns connection counts, query latency, export volume,
    operations-by-app and DLP-by-app bar data, and suspicious activity table.
    """
    env = _validate_env(env)
    return await query_service.get_db_monitoring(env, db)


@router.post(
    "/db-monitoring/kill-query",
    summary="Kill a suspicious query (mitigation action)",
)
async def kill_db_query(payload: DbKillQueryRequest) -> dict:
    """
    MVP: Logs the kill-query action. Production: call DB proxy/admin API to terminate the session/query.
    """
    logger.info(
        f"[DB KILL QUERY] activityId={payload.activityId} app={payload.app} user={payload.user}"
    )
    return {
        "success": True,
        "message": f"Kill-query command sent for activity {payload.activityId} (app: {payload.app}).",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Incidents
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/incidents",
    response_model=List[Incident],
    summary="List security incidents",
)
async def get_incidents(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
) -> List[Incident]:
    """
    Powers the Incidents page.
    Returns a DIRECT JSON array of Incident objects (NOT a wrapped object).
    The frontend does: setIncidents(result) — result must be an array.
    """
    env = _validate_env(env)
    return await query_service.get_incidents(env, db)


@router.post(
    "/incidents/remediate",
    response_model=RemediateResponse,
    summary="Execute a remediation action on an incident",
)
async def remediate_incident(
    payload: RemediateRequest,
    db: AsyncSession = Depends(get_db),
) -> RemediateResponse:
    """
    Executes a remediation action (Block IP, Isolate Endpoint, Dismiss).

    MVP: Updates incident status in the DB and logs the action.
    Production: This should trigger a SOC playbook — e.g., call a firewall
    API to block an IP, call Velociraptor to isolate a host, or close the
    ticket in a SIEM.
    """
    if not payload.incidentId or not payload.action:
        raise HTTPException(status_code=400, detail="incidentId and action are required.")

    action = payload.action
    logger.info(f"[REMEDIATE] Action '{action}' requested for incident {payload.incidentId}")

    # Map UI action buttons to DB status changes
    status_map = {
        "Dismiss": "Closed",
        "Block IP": "Contained",
        "Isolate Endpoint": "Contained",
    }
    new_status = status_map.get(action)

    if new_status:
        updated = await query_service.update_incident_status(
            payload.incidentId, new_status, db
        )
        if not updated:
            # Incident not found — log it but don't fail (idempotent actions)
            logger.warning(f"Incident {payload.incidentId} not found for status update.")

    # TODO (Production): trigger_playbook(action, payload.incidentId)

    return RemediateResponse(
        success=True,
        message=f"Action '{action}' initiated for incident {payload.incidentId}.",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Header Data (Bell icon + app selector)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/header-data", response_model=HeaderData, summary="Header: user, apps, alerts")
async def get_header_data(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
) -> HeaderData:
    """
    Powers the dashboard header component.
    Returns the logged-in user, application list (for the env switcher),
    and recent alert notifications.
    """
    env = _validate_env(env)
    return await query_service.get_header_data(env, db)


# ─────────────────────────────────────────────────────────────────────────────
# Team Users (Settings → User Access tab)
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/users",
    response_model=List[TeamUser],
    summary="List SOC team users",
)
async def get_users(
    env: str = "cloud",
    db: AsyncSession = Depends(get_db),
) -> List[TeamUser]:
    """
    Returns the SOC team user list for a given environment.
    Used by the Settings → User Access tab.
    """
    env = _validate_env(env)
    return await query_service.get_team_users(env, db)
