"""
query/reports_service.py — Reports, Incidents, App Config & Quarantine Services

Owns all PostgreSQL-only functions that require zero Pandas:
  get_incidents()              — incident list for the Incidents page
  update_incident_status()     — remediation status transitions
  get_case_management()        — case board with MTTR computation
  get_app_config()             — per-app security config read
  update_app_config()          — per-app security config write
  get_quarantined_endpoints()  — active quarantine ledger
  lift_quarantine()            — quarantine removal
  get_reports_overview()       — scheduled + recent download list
  generate_report()            — on-demand report generation

All functions return the exact Pydantic schemas the routes already pass to
the frontend — no schema changes, zero frontend impact.

Pandas reduction
────────────────
The original query_service.py had no Pandas in this section — all functions
were already pure SQLAlchemy.  This module is a faithful extraction with one
addition: _parse_iso() is module-scoped (was a nested def inside
get_case_management) so it is testable in isolation.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import (
    AppConfig as AppConfigRow,
    Incident,
    QuarantinedEndpoint as QuarantinedEndpointRow,
    ReportDownload as ReportDownloadRow,
    ScheduledReport as ScheduledReportRow,
)
from app.models.schemas import (
    AppConfigResponse,
    AppConfigUpdateRequest,
    CaseManagementCase,
    CaseManagementKpis,
    CaseManagementResponse,
    GenerateReportRequest,
    GenerateReportResponse,
    Incident as IncidentSchema,
    LiftQuarantineResponse,
    QuarantinedEndpointRow as QuarantinedEndpointSchema,
    QuarantinedEndpointsResponse,
    RecentDownloadRow,
    ReportsOverviewResponse,
    ScheduledReportRow as ScheduledReportSchema,
)

logger = logging.getLogger(__name__)


# ─── Shared helpers ───────────────────────────────────────────────────────────

def _incident_to_schema(inc: Incident) -> IncidentSchema:
    """Single source of truth for Incident ORM → Pydantic conversion."""
    return IncidentSchema(
        id=inc.incident_id,
        eventName=inc.event_name,
        timestamp=inc.timestamp,
        severity=inc.severity,
        sourceIp=inc.source_ip,
        destIp=inc.dest_ip,
        targetApp=inc.target_app,
        status=inc.status,
        eventDetails=inc.event_details,
    )


def _parse_iso(s: str) -> Optional[datetime]:
    """
    Parses an ISO-8601 timestamp string, tolerating both 'Z' and '+00:00'
    suffix styles.  Returns None on any parse failure so MTTR computation
    gracefully skips malformed rows.
    """
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _cfg_to_schema(cfg: AppConfigRow) -> AppConfigResponse:
    """Single source of truth for AppConfig ORM → Pydantic conversion."""
    return AppConfigResponse(
        env=cfg.env,
        appId=cfg.app_id,
        warningAnomalyScore=cfg.warning_anomaly_score,
        criticalAnomalyScore=cfg.critical_anomaly_score,
        softRateLimitCallsPerMin=cfg.soft_rate_limit_calls_per_min,
        hardBlockThresholdCallsPerMin=cfg.hard_block_threshold_calls_per_min,
        autoQuarantineLaptops=cfg.auto_quarantine_laptops,
        trainingWindowDays=cfg.training_window_days,
        modelSensitivityPct=cfg.model_sensitivity_pct,
        autoUpdateBaselinesWeekly=cfg.auto_update_baselines_weekly,
        baselineModelName=cfg.baseline_model_name,
        baselineLastUpdatedAt=cfg.baseline_last_updated_at,
    )


# Maps Pydantic camelCase field names to (ORM column name, cast function).
# Defined once at module level — avoids rebuilding the dict on every request.
_APP_CONFIG_FIELD_MAP: dict = {
    "warningAnomalyScore":          ("warning_anomaly_score",             int),
    "criticalAnomalyScore":         ("critical_anomaly_score",            int),
    "softRateLimitCallsPerMin":     ("soft_rate_limit_calls_per_min",     int),
    "hardBlockThresholdCallsPerMin":("hard_block_threshold_calls_per_min",int),
    "autoQuarantineLaptops":        ("auto_quarantine_laptops",           bool),
    "trainingWindowDays":           ("training_window_days",              int),
    "modelSensitivityPct":          ("model_sensitivity_pct",             int),
    "autoUpdateBaselinesWeekly":    ("auto_update_baselines_weekly",      bool),
    "baselineModelName":            ("baseline_model_name",               str),
}


async def _get_or_create_app_config(
    env: str, app_id: str, db: AsyncSession
) -> AppConfigRow:
    """
    Returns the existing AppConfig row or creates a default one.
    Uses flush() (not commit()) so the caller controls transaction boundaries.
    """
    existing = (
        await db.execute(
            select(AppConfigRow).where(
                AppConfigRow.env == env,
                AppConfigRow.app_id == app_id,
            )
        )
    ).scalars().first()

    if existing:
        return existing

    cfg = AppConfigRow(env=env, app_id=app_id)
    db.add(cfg)
    await db.flush()
    return cfg


# ─── Incident functions ───────────────────────────────────────────────────────

async def get_incidents(env: str, db: AsyncSession) -> List[IncidentSchema]:
    result = await db.execute(
        select(Incident)
        .where(Incident.env == env)
        .order_by(Incident.timestamp.desc())
    )
    return [_incident_to_schema(inc) for inc in result.scalars().all()]


async def update_incident_status(
    incident_id: str, new_status: str, db: AsyncSession
) -> Optional[IncidentSchema]:
    result = await db.execute(
        select(Incident).where(Incident.incident_id == incident_id)
    )
    inc = result.scalar_one_or_none()
    if not inc:
        return None
    inc.status = new_status
    await db.commit()
    await db.refresh(inc)
    return _incident_to_schema(inc)


# ─── Case Management ──────────────────────────────────────────────────────────

async def get_case_management(env: str, db: AsyncSession) -> CaseManagementResponse:
    """
    Builds the case board payload including a dynamically computed MTTR.

    MTTR computation
    ────────────────
    Fetches up to 200 closed incidents that have both an opened timestamp and
    a resolved_at timestamp.  Mean time-to-resolve is computed as the average
    of (resolved_at - timestamp) across all qualifying pairs.

    Rows with unparseable timestamps or negative deltas (data anomalies) are
    silently skipped — MTTR returns "N/A" when no valid pairs exist.
    """
    # ── KPI counts (single aggregation query) ─────────────────────────────────
    kpi_result = await db.execute(
        select(
            func.count(Incident.id).filter(
                Incident.severity == "Critical"
            ).label("critical"),
            func.count(Incident.id).filter(
                Incident.status.in_(["Active", "Investigating", "Open"])
            ).label("open"),
            func.count(Incident.id).filter(
                Incident.status.in_(["Active", "Investigating", "Open"]),
                Incident.severity.in_(["High", "Critical"]),
            ).label("unassigned"),
        ).where(Incident.env == env)
    )
    counts = kpi_result.one()

    # ── MTTR from resolved incidents ──────────────────────────────────────────
    closed_result = await db.execute(
        select(Incident.timestamp, Incident.resolved_at)
        .where(
            Incident.env == env,
            Incident.status == "Closed",
            Incident.resolved_at.isnot(None),
        )
        .limit(200)
    )

    deltas_seconds = []
    for opened_str, resolved_str in closed_result.all():
        opened   = _parse_iso(opened_str)   if opened_str   else None
        resolved = _parse_iso(resolved_str) if resolved_str else None
        if opened and resolved and resolved > opened:
            deltas_seconds.append((resolved - opened).total_seconds())

    if deltas_seconds:
        avg_s      = sum(deltas_seconds) / len(deltas_seconds)
        mttr_label = f"{int(avg_s // 60)}m {int(avg_s % 60):02d}s"
    else:
        mttr_label = "N/A"

    kpis = CaseManagementKpis(
        criticalOpenCases=int(counts.critical or 0),
        mttr=mttr_label,
        unassignedEscalations=int(counts.unassigned or 0),
    )

    # ── Case rows ─────────────────────────────────────────────────────────────
    incidents = (
        await db.execute(
            select(Incident)
            .where(Incident.env == env)
            .order_by(Incident.timestamp.desc())
            .limit(25)
        )
    ).scalars().all()

    cases: List[CaseManagementCase] = []
    for inc in incidents:
        raw        = inc.raw_payload if isinstance(inc.raw_payload, dict) else {}
        narrative  = raw.get("aiThreatNarrative") or (
            f"Correlated Attack: External IP brute-forced the {inc.target_app} "
            "service, then triggered anomalous lateral movement activity."
        )
        assignee   = raw.get("assigneeName") or "Unassigned"
        initials   = (
            "".join([p[0] for p in assignee.split()[:2]]).upper()
            if assignee != "Unassigned"
            else ""
        )
        scope_tags = (
            raw.get("scopeTags")
            if isinstance(raw.get("scopeTags"), list)
            else [inc.target_app]
        )
        cases.append(
            CaseManagementCase(
                caseId=inc.incident_id,
                scopeTags=[str(x) for x in scope_tags if x],
                aiThreatNarrative=str(narrative),
                assigneeName=str(assignee),
                assigneeInitials=str(initials),
                status=inc.status,
                playbookActions=[
                    "View AI Timeline",
                    "Execute Total Lockdown Playbook",
                    "Assign to Me",
                    "Quarantine Endpoint & Drop MAC",
                ],
                targetApp=inc.target_app,
            )
        )

    return CaseManagementResponse(kpis=kpis, cases=cases)


# ─── App Config ───────────────────────────────────────────────────────────────

async def get_app_config(env: str, app_id: str, db: AsyncSession) -> AppConfigResponse:
    return _cfg_to_schema(await _get_or_create_app_config(env, app_id, db))


async def update_app_config(
    env: str, app_id: str, body: AppConfigUpdateRequest, db: AsyncSession
) -> AppConfigResponse:
    cfg  = await _get_or_create_app_config(env, app_id, db)
    data = body.model_dump(exclude_none=True)

    for api_key, (db_attr, cast) in _APP_CONFIG_FIELD_MAP.items():
        if api_key in data:
            setattr(cfg, db_attr, cast(data[api_key]))

    db.add(cfg)
    await db.flush()
    return _cfg_to_schema(cfg)


# ─── Quarantine ───────────────────────────────────────────────────────────────

async def get_quarantined_endpoints(
    env: str, app_id: str, db: AsyncSession
) -> QuarantinedEndpointsResponse:
    cfg = await _get_or_create_app_config(env, app_id, db)
    rows = (
        await db.execute(
            select(QuarantinedEndpointRow)
            .where(
                QuarantinedEndpointRow.env == env,
                QuarantinedEndpointRow.app_id == app_id,
                QuarantinedEndpointRow.status == "Active",
            )
            .order_by(QuarantinedEndpointRow.id.desc())
            .limit(50)
        )
    ).scalars().all()

    quarantined = [
        QuarantinedEndpointSchema(
            workstationId=r.workstation_id,
            user=r.user_name,
            timeQuarantined=r.quarantined_at,
            action="Lift Quarantine",
        )
        for r in rows
    ]
    return QuarantinedEndpointsResponse(
        autoQuarantineLaptops=cfg.auto_quarantine_laptops,
        quarantined=quarantined,
    )


async def lift_quarantine(
    env: str, app_id: str, workstation_id: str, db: AsyncSession
) -> LiftQuarantineResponse:
    row = (
        await db.execute(
            select(QuarantinedEndpointRow)
            .where(
                QuarantinedEndpointRow.env == env,
                QuarantinedEndpointRow.app_id == app_id,
                QuarantinedEndpointRow.workstation_id == workstation_id,
                QuarantinedEndpointRow.status == "Active",
            )
            .order_by(QuarantinedEndpointRow.id.desc())
            .limit(1)
        )
    ).scalars().first()

    if not row:
        return LiftQuarantineResponse(
            success=False,
            message="No active quarantine found for that workstation.",
        )

    row.status = "Lifted"
    db.add(row)
    await db.flush()
    return LiftQuarantineResponse(
        success=True, message=f"Quarantine lifted for {workstation_id}."
    )


# ─── Reports ──────────────────────────────────────────────────────────────────

async def get_reports_overview(env: str, db: AsyncSession) -> ReportsOverviewResponse:
    scheduled = (
        await db.execute(
            select(ScheduledReportRow)
            .where(ScheduledReportRow.env == env)
            .order_by(ScheduledReportRow.id.asc())
            .limit(50)
        )
    ).scalars().all()

    downloads = (
        await db.execute(
            select(ReportDownloadRow)
            .where(ReportDownloadRow.env == env)
            .order_by(ReportDownloadRow.id.desc())
            .limit(20)
        )
    ).scalars().all()

    return ReportsOverviewResponse(
        scheduledReports=[
            ScheduledReportSchema(
                id=r.id,
                title=r.title,
                description=r.description,
                schedule=r.schedule,
                active=bool(r.enabled),
                configureLabel="Configure",
            )
            for r in scheduled
        ],
        recentDownloads=[
            RecentDownloadRow(
                id=d.id,
                fileName=d.file_name,
                targetAppScope=d.target_app_scope,
                generated=d.generated_at_label,
                size=d.size_label,
                downloadUrl=d.download_url,
            )
            for d in downloads
        ],
    )


async def generate_report(
    env: str, body: GenerateReportRequest, db: AsyncSession
) -> GenerateReportResponse:
    ext  = "pdf" if body.exportFormat.upper() == "PDF" else "csv"
    name = f"{body.dataSource}_{body.template}_Audit.{ext}".replace(" ", "_")

    record = ReportDownloadRow(
        env=env,
        file_name=name,
        target_app_scope=body.dataSource,
        generated_at_label="Today",
        size_label="2.4 MB" if ext == "pdf" else "1.8 MB",
        download_url=f"/reports/download/{name}",
    )
    db.add(record)
    await db.flush()

    return GenerateReportResponse(
        success=True,
        message="Report generated.",
        download=RecentDownloadRow(
            id=record.id,
            fileName=record.file_name,
            targetAppScope=record.target_app_scope,
            generated=record.generated_at_label,
            size=record.size_label,
            downloadUrl=record.download_url,
        ),
    )
