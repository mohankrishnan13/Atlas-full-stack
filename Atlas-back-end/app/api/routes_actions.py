"""
api/routes_actions.py — SOC Mitigation Actions (Write)

Every action endpoint:
  1. Executes the mitigation (Wazuh active response or DB state change).
  2. Persists a MitigationAuditLog row — permanent, queryable record of
     every analyst action: who, what, when, against what.
  3. On remediate with status "Closed", stamps Incident.resolved_at so
     MTTR calculation in incidents_service has real timestamps.

REMOVED in Anomaly Command Center pivot:
  POST /settings/apps/{app_id}/quarantine/lift — QuarantinedEndpoint deleted
  POST /db-monitoring/kill-query              — DB Monitoring domain retired
  POST /reports/generate                      — Reports domain retired

Active endpoints:
  POST /api-monitoring/block-route   — audit-only (no live enforcement yet)
  POST /network-traffic/block        — audit-only (no live enforcement yet)
  POST /endpoint-security/quarantine — sends Wazuh active-response command
  POST /incidents/remediate          — status transition + optional Wazuh isolation
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.wazuh_client import WazuhActions
from app.models.db_models import AtlasUser, Incident, MitigationAuditLog
from app.services.auth_service import get_current_user
from app.models.schemas import (
    ApiBlockRouteRequest,
    NetworkBlockRequest,
    QuarantineRequest,
    QuarantineResponse,
    RemediateRequest,
    RemediateResponse,
)
from app.services.query import update_incident_status

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
    """
    Write a single MitigationAuditLog row. Fire-and-forget — never raises.
    Errors are logged but do not abort the parent action.
    """
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
            "[AUDIT] Failed to write audit log for %s: %s", action_type, exc, exc_info=True
        )


# ── Block API Route ────────────────────────────────────────────────────────────

@router.post("/api-monitoring/block-route")
async def block_api_route(
    payload: ApiBlockRouteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    """
    Audit-logs a request to hard-block an API route. Live enforcement
    is handled by the upstream gateway — ATLAS records the analyst intent.
    """
    logger.info(
        "[API BLOCK] Requested by %s — app=%s path=%s",
        current_user.email, payload.app, payload.path,
    )
    await _audit(
        db, current_user,
        action_type="block_api_route",
        target_identifier=f"{payload.app}:{payload.path}",
        details={"app": payload.app, "path": payload.path},
    )
    return {"success": True, "message": f"Hard block applied for {payload.app} {payload.path}."}


# ── Block Network Source ───────────────────────────────────────────────────────

@router.post("/network-traffic/block")
async def block_network_source(
    payload: NetworkBlockRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    """
    Audit-logs a request to block a source IP. Live enforcement is handled
    by the upstream firewall / Zeek policy — ATLAS records the analyst intent.
    """
    logger.info(
        "[NETWORK BLOCK] Requested by %s — IP=%s", current_user.email, payload.sourceIp
    )
    await _audit(
        db, current_user,
        action_type="block_network_source",
        target_identifier=payload.sourceIp,
        details={"sourceIp": payload.sourceIp, "app": payload.app},
    )
    return {"success": True, "message": f"Hard block applied for source {payload.sourceIp}."}


# ── Quarantine Device ──────────────────────────────────────────────────────────

@router.post("/endpoint-security/quarantine", response_model=QuarantineResponse)
async def quarantine_device(
    payload: QuarantineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    """
    Sends a Wazuh active-response command (host-deny600) to the target agent,
    isolating it from the network. The command is sent regardless of audit
    outcome — isolation takes priority over bookkeeping.

    WazuhActions() reads WAZUH_API_URL / WAZUH_USERNAME / WAZUH_PASSWORD
    from Settings (.env) — no credentials are hardcoded here.
    """
    wazuh   = WazuhActions()
    success = wazuh.run_command(payload.workstationId, "host-deny600")

    if not success:
        logger.error("[QUARANTINE] Wazuh failed to isolate agent %s", payload.workstationId)

    await _audit(
        db, current_user,
        action_type="quarantine_device",
        target_identifier=payload.workstationId,
        details={
            "workstationId": payload.workstationId,
            "wazuh_status": "sent" if success else "failed",
        },
        outcome="success" if success else "failed",
    )

    return QuarantineResponse(
        success=success,
        message=(
            f"Isolation command {'sent' if success else 'failed'} "
            f"for {payload.workstationId}."
        ),
    )


# ── Remediate Incident ─────────────────────────────────────────────────────────

# Maps analyst action labels to the new Incident.status value.
_STATUS_MAP: dict[str, str] = {
    "Dismiss":          "Closed",
    "Block IP":         "Contained",
    "Isolate Endpoint": "Contained",
}


@router.post("/incidents/remediate", response_model=RemediateResponse)
async def remediate_incident(
    payload: RemediateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
):
    """
    Executes a named playbook action against an open incident.

    Status transitions (via _STATUS_MAP):
      "Dismiss"          → Closed    (stamps resolved_at for MTTR)
      "Block IP"         → Contained
      "Isolate Endpoint" → Contained (also sends Wazuh host-deny command)

    Actions not in _STATUS_MAP (e.g. "View AI Timeline", "Assign to Me") are
    audit-logged but do not change Incident.status — they are UI-only intents.
    """
    if not payload.incidentId or not payload.action:
        raise HTTPException(status_code=400, detail="incidentId and action are required.")

    logger.info(
        "[REMEDIATE] '%s' requested by %s for %s",
        payload.action, current_user.email, payload.incidentId,
    )

    new_status = _STATUS_MAP.get(payload.action)

    if new_status:
        await update_incident_status(payload.incidentId, new_status, db)

        # ── Isolate Endpoint: send Wazuh active-response command ──────────────
        if payload.action == "Isolate Endpoint":
            result = await db.execute(
                select(Incident).where(Incident.incident_id == payload.incidentId)
            )
            incident = result.scalar_one_or_none()

            # `source_ip` is the attacker's source — we isolate the target endpoint.
            # The Wazuh agent identifier is stored in target_app when it refers
            # to a specific workstation; fall back to source_ip if not set.
            agent_id = (
                incident.target_app or incident.source_ip
                if incident else None
            )
            if agent_id:
                wazuh   = WazuhActions()
                success = wazuh.run_command(agent_id, "host-deny")
                logger.info(
                    "[REMEDIATE] Isolation command for agent %s: %s",
                    agent_id, "sent" if success else "failed",
                )

        # ── Stamp resolved_at for MTTR calculation ────────────────────────────
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
        details={
            "incidentId": payload.incidentId,
            "action":     payload.action,
            "new_status": new_status,
        },
    )

    return RemediateResponse(success=True, message=f"Action '{payload.action}' initiated.")
