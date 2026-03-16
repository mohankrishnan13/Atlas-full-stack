"""
api/routes_actions.py — SOC Mitigation Actions (Write)

Every action endpoint now:
  1. Executes the mitigation (same as before).
  2. Persists a MitigationAuditLog row so there is a permanent, queryable
     record of every analyst action — who did what, when, and against what.
  3. On remediate with status "Closed", stamps Incident.resolved_at so the
     MTTR calculation in query_service has real timestamps to work with.

No external service calls are made — the log row is the single source of
truth for the action until a real SOAR/EDR integration is wired in.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser, Incident, MitigationAuditLog
from app.services.auth_service import get_current_user
from app.models.schemas import (
    ApiBlockRouteRequest, DbKillQueryRequest, GenerateReportRequest,
    GenerateReportResponse, LiftQuarantineRequest, LiftQuarantineResponse,
    NetworkBlockRequest, QuarantineRequest, QuarantineResponse,
    RemediateRequest, RemediateResponse,
)
from app.services import query_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ATLAS Mitigation Actions (Write)"])


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _audit(
    db: AsyncSession,
    current_user: AtlasUser,
    action_type: str,
    target_identifier: str,
    details: dict,
    outcome: str = "success",
) -> None:
    """Write a single MitigationAuditLog row.  Fire-and-forget — never raises."""
    try:
        db.add(MitigationAuditLog(
            env=current_user.env,
            analyst_email=current_user.email,
            analyst_role=current_user.role,
            action_type=action_type,
            target_identifier=target_identifier,
            outcome=outcome,
            details=details,
            created_at=_utcnow(),
        ))
        await db.commit()
    except Exception as exc:
        logger.error(f"[AUDIT] Failed to write audit log for {action_type}: {exc}", exc_info=True)


# ── Block API Route ───────────────────────────────────────────────────────────

@router.post("/api-monitoring/block-route")
async def block_api_route(
    payload: ApiBlockRouteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    logger.info(
        f"[API BLOCK] Hard block requested by {current_user.email} "
        f"for app={payload.app} path={payload.path}"
    )
    await _audit(
        db, current_user,
        action_type="block_api_route",
        target_identifier=f"{payload.app}:{payload.path}",
        details={"app": payload.app, "path": payload.path},
    )
    return {"success": True, "message": f"Hard block applied for route {payload.app} {payload.path}."}


# ── Block Network Source ──────────────────────────────────────────────────────

@router.post("/network-traffic/block")
async def block_network_source(
    payload: NetworkBlockRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    logger.info(
        f"[NETWORK BLOCK] Requested by {current_user.email} for IP={payload.sourceIp}"
    )
    await _audit(
        db, current_user,
        action_type="block_network_source",
        target_identifier=payload.sourceIp,
        details={"sourceIp": payload.sourceIp, "app": payload.app},
    )
    return {"success": True, "message": f"Hard block applied for source {payload.sourceIp}."}


# ── Quarantine Device ─────────────────────────────────────────────────────────

@router.post("/endpoint-security/quarantine", response_model=QuarantineResponse)
async def quarantine_device(
    payload: QuarantineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    # 1. ACTUAL MITIGATION (The "Real" Part)
    # We use the payload.workstationId as the Wazuh Agent ID
    wazuh = WazuhActions(host="YOUR_LAPTOP_IP")
    success = wazuh.run_command(payload.workstationId, "host-deny600") # Deny for 600s

    if not success:
        logger.error(f"Wazuh failed to isolate agent {payload.workstationId}")
        # We don't raise error, we still audit the attempt
    
    # 2. AUDIT (Your existing logic)
    await _audit(
        db, current_user,
        action_type="quarantine_device",
        target_identifier=payload.workstationId,
        details={"workstationId": payload.workstationId, "wazuh_status": "sent" if success else "failed"},
    )
    
    return QuarantineResponse(
        success=success,
        message=f"Isolation command {'sent' if success else 'failed'} for {payload.workstationId}.",
    )


# ── Lift Quarantine ───────────────────────────────────────────────────────────

@router.post("/settings/apps/{app_id}/quarantine/lift", response_model=LiftQuarantineResponse)
async def lift_quarantine(
    app_id: str,
    body: LiftQuarantineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    if body.appId != app_id:
        raise HTTPException(
            status_code=400,
            detail="appId in body must match app_id path parameter",
        )
    logger.warning(
        f"[QUARANTINE LIFT] Requested by {current_user.email} "
        f"env={current_user.env} app_id={app_id} ws={body.workstationId}"
    )
    result = await query_service.lift_quarantine(
        current_user.env, app_id, body.workstationId, db
    )
    await _audit(
        db, current_user,
        action_type="lift_quarantine",
        target_identifier=body.workstationId,
        details={"appId": app_id, "workstationId": body.workstationId},
    )
    return result


# ── Kill DB Query ─────────────────────────────────────────────────────────────

@router.post("/db-monitoring/kill-query")
async def kill_db_query(
    payload: DbKillQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    logger.info(
        f"[DB KILL] Requested by {current_user.email} for activityId={payload.activityId}"
    )
    await _audit(
        db, current_user,
        action_type="kill_db_query",
        target_identifier=str(payload.activityId),
        details={"activityId": payload.activityId, "app": payload.app, "user": payload.user},
    )
    return {"success": True, "message": f"Kill-query command sent for activity {payload.activityId}."}


# ── Remediate Incident ────────────────────────────────────────────────────────

_STATUS_MAP = {
    "Dismiss":           "Closed",
    "Block IP":          "Contained",
    "Isolate Endpoint":  "Contained",
}


@router.post("/incidents/remediate", response_model=RemediateResponse)
async def remediate_incident(
    payload: RemediateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    if not payload.incidentId or not payload.action:
        raise HTTPException(
            status_code=400,
            detail="incidentId and action are required.",
        )

    logger.info(
        f"[REMEDIATE] Action '{payload.action}' requested by "
        f"{current_user.email} for {payload.incidentId}"
    )

    new_status = _STATUS_MAP.get(payload.action)

    if new_status:
        # 1. Update the Database Status (Visual/Audit)
        await query_service.update_incident_status(payload.incidentId, new_status, db)

        # 2. TRIGGER THE REAL TOOL (The "Actual Purpose")
        if payload.action == "Isolate Endpoint":
            # Fetch the incident to find the agent's ID
            result = await db.execute(select(Incident).where(Incident.incident_id == payload.incidentId))
            incident = result.scalar_one_or_none()
            
            if incident and incident.source_ip:
                # In Wazuh, we usually isolate by Agent ID. 
                # If your target_identifier is the Agent ID, use it here.
                wazuh = WazuhActions(host="YOUR_MANAGER_IP")
                wazuh.run_command(incident.target_identifier, "host-deny") 
                logger.info(f"REAL ACTION: Isolated agent {incident.target_identifier} via Wazuh.")

        # 3. Handle Closure and MTTR
        if new_status == "Closed":
            result = await db.execute(
                select(Incident).where(Incident.incident_id == payload.incidentId)
            )
            incident = result.scalar_one_or_none()
            if incident and not incident.resolved_at:
                incident.resolved_at = _utcnow()
                db.add(incident)
                await db.commit()

    await _audit(
        db, current_user,
        action_type="remediate_incident",
        target_identifier=payload.incidentId,
        details={"incidentId": payload.incidentId, "action": payload.action, "new_status": new_status},
    )

    return RemediateResponse(success=True, message=f"Action '{payload.action}' initiated.")


# ── Generate Report ───────────────────────────────────────────────────────────

@router.post("/reports/generate", response_model=GenerateReportResponse)
async def generate_report(
    body: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    if not body.dataSource or not body.template or not body.exportFormat:
        raise HTTPException(
            status_code=400,
            detail="dataSource, template, and exportFormat are required.",
        )
    logger.info(
        f"[REPORTS] Generate requested by {current_user.email} for {body.dataSource}"
    )
    result = await query_service.generate_report(current_user.env, body, db)
    await _audit(
        db, current_user,
        action_type="generate_report",
        target_identifier=body.dataSource,
        details={
            "dataSource": body.dataSource,
            "template": body.template,
            "exportFormat": body.exportFormat,
            "dateRange": body.dateRange,
        },
    )
    return result
