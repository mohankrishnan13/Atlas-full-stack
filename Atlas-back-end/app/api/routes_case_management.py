"""api/routes_case_management.py — Figma Case Management Endpoint (DB-backed)

Option 2 strategy: new endpoint to support Figma Case Management widgets.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.models.schemas import CaseManagementResponse
from app.services import query_service
from app.services.auth_service import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Case Management"])


@router.get("/case-management", response_model=CaseManagementResponse)
async def get_case_management(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> CaseManagementResponse:
    return await query_service.get_case_management(current_user.env, db)
