"""
api/routes_actions.py — Weaponized Mitigation Actions
Isolates all destructive POST/PUT endpoints triggered by UI buttons.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.services.auth_service import get_current_user
from app.models.schemas import (
    ApiBlockRouteRequest, DbKillQueryRequest, GenerateReportRequest, 
    GenerateReportResponse, LiftQuarantineRequest, LiftQuarantineResponse, 
    NetworkBlockRequest, QuarantineRequest, QuarantineResponse, 
    RemediateRequest, RemediateResponse
)
from app.services import query_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ATLAS Mitigation Actions (Write)"])

@router.post("/api-monitoring/block-route")
async def block_api_route(payload: ApiBlockRouteRequest, current_user: AtlasUser = Depends(get_current_user)):
    logger.info(f"[API BLOCK] Hard block requested by {current_user.email} for app={payload.app} path={payload.path}")
    return {"success": True, "message": f"Hard block applied for route {payload.app} {payload.path}."}

@router.post("/network-traffic/block")
async def block_network_source(payload: NetworkBlockRequest, current_user: AtlasUser = Depends(get_current_user)):
    logger.info(f"[NETWORK BLOCK] Requested by {current_user.email} for IP={payload.sourceIp}")
    return {"success": True, "message": f"Hard block applied for source {payload.sourceIp}."}

@router.post("/endpoint-security/quarantine", response_model=QuarantineResponse)
async def quarantine_device(payload: QuarantineRequest, current_user: AtlasUser = Depends(get_current_user)):
    if not payload.workstationId:
        raise HTTPException(status_code=400, detail="workstationId is required.")
    logger.warning(f"[QUARANTINE] Command sent by {current_user.email} for {payload.workstationId}")
    return QuarantineResponse(success=True, message=f"Device {payload.workstationId} has been quarantined.")

@router.post("/settings/apps/{app_id}/quarantine/lift", response_model=LiftQuarantineResponse)
async def lift_quarantine(app_id: str, body: LiftQuarantineRequest, db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    if body.appId != app_id:
        raise HTTPException(status_code=400, detail="appId in body must match app_id path parameter")
    logger.warning(f"[QUARANTINE LIFT] Requested by {current_user.email} for env={current_user.env} app_id={app_id} ws={body.workstationId}")
    return await query_service.lift_quarantine(current_user.env, app_id, body.workstationId, db)

@router.post("/db-monitoring/kill-query")
async def kill_db_query(payload: DbKillQueryRequest, current_user: AtlasUser = Depends(get_current_user)):
    logger.info(f"[DB KILL] Requested by {current_user.email} for activityId={payload.activityId}")
    return {"success": True, "message": f"Kill-query command sent for activity {payload.activityId}."}

@router.post("/incidents/remediate", response_model=RemediateResponse)
async def remediate_incident(payload: RemediateRequest, db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    if not payload.incidentId or not payload.action:
        raise HTTPException(status_code=400, detail="incidentId and action are required.")
    
    logger.info(f"[REMEDIATE] Action '{payload.action}' requested by {current_user.email} for {payload.incidentId}")
    status_map = {"Dismiss": "Closed", "Block IP": "Contained", "Isolate Endpoint": "Contained"}
    new_status = status_map.get(payload.action)

    if new_status:
        await query_service.update_incident_status(payload.incidentId, new_status, db)

    return RemediateResponse(success=True, message=f"Action '{payload.action}' initiated.")

@router.post("/reports/generate", response_model=GenerateReportResponse)
async def generate_report(body: GenerateReportRequest, db: AsyncSession = Depends(get_db), current_user: AtlasUser = Depends(get_current_user)):
    if not body.dataSource or not body.template or not body.exportFormat:
        raise HTTPException(status_code=400, detail="dataSource, template, and exportFormat are required.")
    logger.info(f"[REPORTS] Generate requested by {current_user.email} for {body.dataSource}")
    return await query_service.generate_report(current_user.env, body, db)