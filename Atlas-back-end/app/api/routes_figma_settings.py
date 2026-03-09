"""api/routes_figma_settings.py — Figma Settings Endpoints (DB-backed)

Option 2 strategy: create new /api/settings/apps/* endpoints without modifying
existing /settings/* MVP routes.

These endpoints persist per-app configuration to PostgreSQL (app_configs) and
expose quarantine tables for the Settings screen.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.models.schemas import (
    AppConfigResponse,
    AppConfigUpdateRequest,
    LiftQuarantineRequest,
    LiftQuarantineResponse,
    QuarantinedEndpointsResponse,
)
from app.services import query_service
from app.services.auth_service import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["Figma Settings"])


@router.get("/apps/{app_id}", response_model=AppConfigResponse)
async def get_app_config(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> AppConfigResponse:
    if not app_id:
        raise HTTPException(status_code=400, detail="app_id is required")
    return await query_service.get_app_config(current_user.env, app_id, db)


@router.put("/apps/{app_id}", response_model=AppConfigResponse)
async def update_app_config(
    app_id: str,
    body: AppConfigUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> AppConfigResponse:
    if not app_id:
        raise HTTPException(status_code=400, detail="app_id is required")

    logger.info(f"[SETTINGS] AppConfig update by {current_user.email} env={current_user.env} app_id={app_id}")
    return await query_service.update_app_config(current_user.env, app_id, body, db)


@router.get("/apps/{app_id}/quarantine", response_model=QuarantinedEndpointsResponse)
async def get_quarantined(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> QuarantinedEndpointsResponse:
    if not app_id:
        raise HTTPException(status_code=400, detail="app_id is required")
    return await query_service.get_quarantined_endpoints(current_user.env, app_id, db)


@router.post("/apps/{app_id}/quarantine/lift", response_model=LiftQuarantineResponse)
async def lift_quarantine(
    app_id: str,
    body: LiftQuarantineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> LiftQuarantineResponse:
    if body.appId != app_id:
        raise HTTPException(status_code=400, detail="appId in body must match app_id path parameter")

    logger.warning(
        f"[QUARANTINE] Lift requested by {current_user.email} env={current_user.env} app_id={app_id} ws={body.workstationId}"
    )
    return await query_service.lift_quarantine(current_user.env, app_id, body.workstationId, db)
