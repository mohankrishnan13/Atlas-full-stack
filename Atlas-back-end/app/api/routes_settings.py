"""
api/routes_settings.py — System Settings & Configurations
Handles dynamic tuning via the Application Context Selector in the UI.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.services.auth_service import get_current_user
from app.models.schemas import AppConfigResponse, AppConfigUpdateRequest, QuarantinedEndpointsResponse
from app.services import query_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["ATLAS Settings (Config)"])

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