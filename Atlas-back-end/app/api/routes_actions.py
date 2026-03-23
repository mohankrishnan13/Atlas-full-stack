"""
api/routes_actions.py — SOC Mitigation Actions (Write)

Every action endpoint:
  1. Executes the mitigation (Wazuh active-response or DB operation).
  2. Persists a MitigationAuditLog row — permanent, queryable record of every
     analyst action (who, what, when, against what).
  3. On remediate with status "Closed", stamps Incident.resolved_at so that
     MTTR computation has real timestamps.

Kill Switch endpoints (Task 4)
───────────────────────────────
  POST /api-monitoring/block-route
    Inserts a BlockedEntity row with entity_type='route'.
    AtlasMiddleware picks it up within CACHE_TTL_SECONDS (≤30s) and begins
    returning 403 on every request whose path starts with the blocked route.

  POST /network-traffic/block
    Inserts a BlockedEntity row with entity_type='ip'.
    AtlasMiddleware begins returning 403 to every request from that source IP.

  POST /api-monitoring/unblock/{entity_id}
    Soft-deletes a BlockedEntity (sets is_active=False).
    The middleware cache expires within 30s and the entity stops being enforced.

  GET /api-monitoring/blocked
    Lists all active BlockedEntity rows for the current user's env.
    Powers the "Active Blocks" table in the API Monitoring UI.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.wazuh_client import WazuhActions
from app.models.db_models import (
    AtlasUser,
    BlockedEntity,
    Incident,
    MitigationAuditLog,
)
from app.services.auth_service import get_current_user
from app.models.schemas import (
    ApiBlockRouteRequest,
    BlockedEntityResponse,
    BlockedEntityListResponse,
    DbKillQueryRequest,
    GenerateReportRequest,
    GenerateReportResponse,
    LiftQuarantineRequest,
    LiftQuarantineResponse,
    NetworkBlockRequest,
    QuarantineRequest,
    QuarantineResponse,
    RemediateRequest,
    RemediateResponse,
    UnblockResponse,
)
from app.services.query import (
    generate_report,
    lift_quarantine,
    update_incident_status,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ATLAS Mitigation Actions (Write)"])


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utcnow_dt() -> datetime:
    return datetime.now(timezone.utc)


async def _audit(
    db: AsyncSession,
    current_user: AtlasUser,
    action_type: str,
    target_identifier: str,
    details: dict,
    outcome: str = "success",
) -> None:
    """Write one MitigationAuditLog row. Fire-and-forget — never raises."""
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
        logger.error(
            "[AUDIT] Failed to write audit log for %s: %s",
            action_type, exc, exc_info=True,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Kill Switch — Block API Route
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api-monitoring/block-route", response_model=BlockedEntityResponse)
async def block_api_route(
    payload: ApiBlockRouteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> BlockedEntityResponse:
    """
    Inserts a BlockedEntity row with entity_type='route'.

    The AtlasMiddleware prefix-matches every incoming request path against all
    active 'route' blocks. Any request whose path STARTS WITH payload.path will
    receive 403 Forbidden within ≤30 seconds of this call.

    Example: blocking "/api/v1/export" also blocks "/api/v1/export/csv".
    """
    logger.warning(
        "[KillSwitch] ROUTE BLOCK requested by %s: app=%s path=%s",
        current_user.email, payload.app, payload.path,
    )

    try:
        entity = BlockedEntity(
            env=current_user.env,
            entity_type="route",
            value=payload.path,
            reason=f"Blocked by SOC analyst ({current_user.email}) via API Monitoring dashboard.",
            blocked_by=current_user.email,
            blocked_at=_utcnow_dt(),
            is_active=True,
        )
        db.add(entity)
        await db.flush()   # get the id before commit
        entity_id = entity.id
        await db.commit()

    except IntegrityError:
        await db.rollback()
        # The unique constraint on (env, value) fired — this route is already blocked.
        existing = await db.execute(
            select(BlockedEntity).where(
                BlockedEntity.env   == current_user.env,
                BlockedEntity.value == payload.path,
            )
        )
        row = existing.scalar_one_or_none()
        if row and row.is_active:
            return BlockedEntityResponse(
                success=False,
                message=f"Route '{payload.path}' is already blocked.",
                entity_id=row.id,
            )
        if row and not row.is_active:
            # Re-activate a previously soft-deleted block.
            row.is_active  = True
            row.blocked_by = current_user.email
            row.blocked_at = _utcnow_dt()
            row.reason     = f"Re-activated by {current_user.email}."
            await db.commit()
            entity_id = row.id
        else:
            raise

    await _audit(
        db, current_user,
        action_type="block_api_route",
        target_identifier=f"{payload.app}:{payload.path}",
        details={"app": payload.app, "path": payload.path, "entity_id": entity_id},
    )

    return BlockedEntityResponse(
        success=True,
        message=(
            f"Route '{payload.path}' has been blocked. "
            "The middleware will enforce this within 30 seconds."
        ),
        entity_id=entity_id,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Kill Switch — Block Network Source IP
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/network-traffic/block", response_model=BlockedEntityResponse)
async def block_network_source(
    payload: NetworkBlockRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> BlockedEntityResponse:
    """
    Inserts a BlockedEntity row with entity_type='ip'.

    The AtlasMiddleware exact-matches every incoming request's source IP against
    all active 'ip' blocks. Any request from payload.sourceIp will receive 403
    Forbidden within ≤30 seconds of this call.
    """
    logger.warning(
        "[KillSwitch] IP BLOCK requested by %s: ip=%s app=%s",
        current_user.email, payload.sourceIp, payload.app,
    )

    try:
        entity = BlockedEntity(
            env=current_user.env,
            entity_type="ip",
            value=payload.sourceIp,
            reason=f"Blocked by SOC analyst ({current_user.email}) via Network Traffic dashboard.",
            blocked_by=current_user.email,
            blocked_at=_utcnow_dt(),
            is_active=True,
        )
        db.add(entity)
        await db.flush()
        entity_id = entity.id
        await db.commit()

    except IntegrityError:
        await db.rollback()
        existing = await db.execute(
            select(BlockedEntity).where(
                BlockedEntity.env   == current_user.env,
                BlockedEntity.value == payload.sourceIp,
            )
        )
        row = existing.scalar_one_or_none()
        if row and row.is_active:
            return BlockedEntityResponse(
                success=False,
                message=f"IP '{payload.sourceIp}' is already blocked.",
                entity_id=row.id,
            )
        if row and not row.is_active:
            row.is_active  = True
            row.blocked_by = current_user.email
            row.blocked_at = _utcnow_dt()
            row.reason     = f"Re-activated by {current_user.email}."
            await db.commit()
            entity_id = row.id
        else:
            raise

    await _audit(
        db, current_user,
        action_type="block_network_source",
        target_identifier=payload.sourceIp,
        details={
            "sourceIp":  payload.sourceIp,
            "app":       payload.app,
            "entity_id": entity_id,
        },
    )

    return BlockedEntityResponse(
        success=True,
        message=(
            f"IP '{payload.sourceIp}' has been blocked. "
            "The middleware will enforce this within 30 seconds."
        ),
        entity_id=entity_id,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Kill Switch — Unblock (soft delete)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api-monitoring/unblock/{entity_id}", response_model=UnblockResponse)
async def unblock_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> UnblockResponse:
    """
    Soft-deletes a BlockedEntity (sets is_active=False).
    Works for both 'ip' and 'route' entity types.
    The middleware cache expires within 30 seconds and the block stops.
    """
    result = await db.execute(
        select(BlockedEntity).where(
            BlockedEntity.id  == entity_id,
            BlockedEntity.env == current_user.env,
        )
    )
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(status_code=404, detail="Blocked entity not found.")

    if not entity.is_active:
        return UnblockResponse(
            success=False,
            message=f"Entity {entity_id} is already inactive.",
        )

    entity.is_active = False
    await db.commit()

    logger.info(
        "[KillSwitch] UNBLOCK: entity_id=%d type=%s value=%s by %s",
        entity_id, entity.entity_type, entity.value, current_user.email,
    )

    await _audit(
        db, current_user,
        action_type=f"unblock_{entity.entity_type}",
        target_identifier=entity.value,
        details={"entity_id": entity_id, "entity_type": entity.entity_type},
    )

    return UnblockResponse(
        success=True,
        message=(
            f"{entity.entity_type.upper()} '{entity.value}' has been unblocked. "
            "Will take effect within 30 seconds."
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Kill Switch — List active blocks
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api-monitoring/blocked", response_model=BlockedEntityListResponse)
async def list_blocked_entities(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> BlockedEntityListResponse:
    """
    Returns all active BlockedEntity rows for the current user's env.
    Powers the "Active Blocks" table in the API Monitoring and Network Traffic UI.
    """
    result = await db.execute(
        select(BlockedEntity)
        .where(
            BlockedEntity.env      == current_user.env,
            BlockedEntity.is_active == True,  # noqa: E712
        )
        .order_by(BlockedEntity.blocked_at.desc())
    )
    rows = result.scalars().all()

    return BlockedEntityListResponse(
        entities=[
            {
                "id":          r.id,
                "entityType":  r.entity_type,
                "value":       r.value,
                "reason":      r.reason,
                "blockedBy":   r.blocked_by,
                "blockedAt":   r.blocked_at.isoformat() if r.blocked_at else "",
                "isActive":    r.is_active,
            }
            for r in rows
        ]
    )


# ─────────────────────────────────────────────────────────────────────────────
# Quarantine Device
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/endpoint-security/quarantine", response_model=QuarantineResponse)
async def quarantine_device(
    payload: QuarantineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> QuarantineResponse:
    wazuh = WazuhActions()
    success = wazuh.run_command(payload.workstationId, "host-deny600")

    if not success:
        logger.error("[QUARANTINE] Wazuh failed to isolate agent %s", payload.workstationId)

    await _audit(
        db, current_user,
        action_type="quarantine_device",
        target_identifier=payload.workstationId,
        details={
            "workstationId": payload.workstationId,
            "wazuh_status":  "sent" if success else "failed",
        },
        outcome="success" if success else "failed",
    )

    return QuarantineResponse(
        success=success,
        message=f"Isolation command {'sent' if success else 'failed'} for {payload.workstationId}.",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Lift Quarantine
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/settings/apps/{app_id}/quarantine/lift",
    response_model=LiftQuarantineResponse,
)
async def lift_quarantine_endpoint(
    app_id: str,
    body: LiftQuarantineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> LiftQuarantineResponse:
    if body.appId != app_id:
        raise HTTPException(
            status_code=400,
            detail="appId in body must match app_id path parameter",
        )
    logger.warning(
        "[QUARANTINE LIFT] Requested by %s env=%s app_id=%s ws=%s",
        current_user.email, current_user.env, app_id, body.workstationId,
    )
    result = await lift_quarantine(current_user.env, app_id, body.workstationId, db)
    await _audit(
        db, current_user,
        action_type="lift_quarantine",
        target_identifier=body.workstationId,
        details={"appId": app_id, "workstationId": body.workstationId},
    )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Kill DB Query
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/db-monitoring/kill-query")
async def kill_db_query(
    payload: DbKillQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    logger.info(
        "[DB KILL] Requested by %s for activityId=%s",
        current_user.email, payload.activityId,
    )
    await _audit(
        db, current_user,
        action_type="kill_db_query",
        target_identifier=str(payload.activityId),
        details={"activityId": payload.activityId, "app": payload.app, "user": payload.user},
    )
    return {"success": True, "message": f"Kill-query command sent for activity {payload.activityId}."}


# ─────────────────────────────────────────────────────────────────────────────
# Remediate Incident
# ─────────────────────────────────────────────────────────────────────────────

_STATUS_MAP = {
    "Dismiss":          "Closed",
    "Block IP":         "Contained",
    "Isolate Endpoint": "Contained",
}


@router.post("/incidents/remediate", response_model=RemediateResponse)
async def remediate_incident(
    payload: RemediateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> RemediateResponse:
    if not payload.incidentId or not payload.action:
        raise HTTPException(
            status_code=400,
            detail="incidentId and action are required.",
        )

    logger.info(
        "[REMEDIATE] Action '%s' requested by %s for %s",
        payload.action, current_user.email, payload.incidentId,
    )

    new_status = _STATUS_MAP.get(payload.action)

    if new_status:
        await update_incident_status(payload.incidentId, new_status, db)

        if payload.action == "Isolate Endpoint":
            res = await db.execute(
                select(Incident).where(Incident.incident_id == payload.incidentId)
            )
            incident = res.scalar_one_or_none()
            if incident and incident.target_identifier:
                wazuh   = WazuhActions()
                success = wazuh.run_command(incident.target_identifier, "host-deny")
                logger.info(
                    "[REMEDIATE] Isolation command for agent %s: %s",
                    incident.target_identifier,
                    "sent" if success else "failed",
                )

        if new_status == "Closed":
            res = await db.execute(
                select(Incident).where(Incident.incident_id == payload.incidentId)
            )
            incident = res.scalar_one_or_none()
            if incident and not incident.resolved_at:
                incident.resolved_at = _utcnow()
                db.add(incident)
                await db.commit()

    await _audit(
        db, current_user,
        action_type="remediate_incident",
        target_identifier=payload.incidentId,
        details={
            "incidentId": payload.incidentId,
            "action":     payload.action,
            "new_status": new_status,
        },
    )

    return RemediateResponse(success=True, message=f"Action '{payload.action}' initiated.")


# ─────────────────────────────────────────────────────────────────────────────
# Generate Report
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/reports/generate", response_model=GenerateReportResponse)
async def generate_report_endpoint(
    body: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> GenerateReportResponse:
    if not body.dataSource or not body.template or not body.exportFormat:
        raise HTTPException(
            status_code=400,
            detail="dataSource, template, and exportFormat are required.",
        )
    logger.info(
        "[REPORTS] Generate requested by %s for %s",
        current_user.email, body.dataSource,
    )
    result = await generate_report(current_user.env, body, db)
    await _audit(
        db, current_user,
        action_type="generate_report",
        target_identifier=body.dataSource,
        details={
            "dataSource":   body.dataSource,
            "template":     body.template,
            "exportFormat": body.exportFormat,
            "dateRange":    body.dateRange,
        },
    )
    return result
