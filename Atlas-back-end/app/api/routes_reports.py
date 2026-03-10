"""api/routes_reports.py — Figma Reports Endpoints (DB-backed)

Option 2 strategy: add new endpoints without changing existing dashboard endpoints.
All endpoints are secured via get_current_user.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.db_models import AtlasUser
from app.models.schemas import GenerateReportRequest, GenerateReportResponse, ReportsOverviewResponse
from app.services import query_service
from app.services.auth_service import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/overview", response_model=ReportsOverviewResponse)
async def get_reports_overview(
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> ReportsOverviewResponse:
    return await query_service.get_reports_overview(current_user.env, db)


@router.post("/generate", response_model=GenerateReportResponse)
async def generate_report(
    body: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: AtlasUser = Depends(get_current_user),
) -> GenerateReportResponse:
    if not body.dataSource or not body.template or not body.exportFormat:
        raise HTTPException(status_code=400, detail="dataSource, template, and exportFormat are required.")

    logger.info(
        f"[REPORTS] Generate requested by {current_user.email} env={current_user.env} "
        f"dataSource={body.dataSource} template={body.template} format={body.exportFormat}"
    )
    return await query_service.generate_report(current_user.env, body, db)
