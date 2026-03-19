"""
services/query/incidents_service.py — Incident & Case Management Services

NOTE: This file was previously named reports_service.py.
Rename it to incidents_service.py to reflect its actual scope after the
Anomaly Command Center pivot.

Owns:
  get_incidents()          — incident list for the Case Management page
  update_incident_status() — remediation status transitions (called by routes_actions)
  get_case_management()    — case board with dynamically computed MTTR

REMOVED from previous version (models no longer exist):
  get_app_config()             — AppConfig model deleted
  update_app_config()          — AppConfig model deleted
  get_quarantined_endpoints()  — QuarantinedEndpoint model deleted
  lift_quarantine()            — QuarantinedEndpoint model deleted
  get_reports_overview()       — ScheduledReport / ReportDownload models deleted
  generate_report()            — ReportDownload model deleted

All three remaining functions are pure SQLAlchemy — zero Pandas dependency.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import Incident
from app.models.schemas import (
    CaseManagementCase,
    CaseManagementKpis,
    CaseManagementResponse,
    Incident as IncidentSchema,
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
    suffix styles. Returns None on any parse failure so MTTR computation
    gracefully skips malformed rows.
    """
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# ─── Public service functions ─────────────────────────────────────────────────

async def get_incidents(env: str, db: AsyncSession) -> List[IncidentSchema]:
    """
    Returns all incidents for the given environment, sorted newest-first.
    Used by the Case Management page incident feed.
    """
    result = await db.execute(
        select(Incident)
        .where(Incident.env == env)
        .order_by(Incident.timestamp.desc())
    )
    return [_incident_to_schema(inc) for inc in result.scalars().all()]


async def update_incident_status(
    incident_id: str, new_status: str, db: AsyncSession
) -> Optional[IncidentSchema]:
    """
    Transitions an incident to a new status.
    Called by routes_actions.remediate_incident() — does not commit; the
    caller is responsible for setting resolved_at and committing.

    Returns the updated schema, or None if the incident_id is not found.
    """
    result = await db.execute(
        select(Incident).where(Incident.incident_id == incident_id)
    )
    inc = result.scalar_one_or_none()
    if not inc:
        logger.warning(
            "[IncidentsService] update_incident_status: id=%s not found.", incident_id
        )
        return None

    inc.status = new_status
    await db.commit()
    await db.refresh(inc)
    return _incident_to_schema(inc)


async def get_case_management(env: str, db: AsyncSession) -> CaseManagementResponse:
    """
    Builds the case board payload including dynamically computed MTTR.

    KPI computation
    ───────────────
    A single aggregation query counts critical open cases and unassigned
    escalations in one round-trip to the database — no per-field queries.

    MTTR computation
    ────────────────
    Fetches up to 200 closed incidents that have both a timestamp and a
    resolved_at value. Mean time-to-resolve is the average of
    (resolved_at − timestamp) across all qualifying pairs.

    Rows with unparseable timestamps or negative deltas (data anomalies) are
    silently skipped. Returns "N/A" when no valid pairs exist.

    Case rows
    ─────────
    The 25 most recent incidents are returned as CaseManagementCase objects.
    AI narrative and scope tags are read from Incident.raw_payload when present
    (written by the ingest pipeline) and fall back to a constructed string when
    missing (e.g. for incidents created via direct DB write).
    """

    # ── KPI counts — single round-trip ───────────────────────────────────────
    kpi_result = await db.execute(
        select(
            func.count(Incident.id).filter(
                Incident.severity == "Critical",
                Incident.status.in_(["Active", "Investigating", "Open"]),
            ).label("critical_open"),
            func.count(Incident.id).filter(
                Incident.status.in_(["Active", "Investigating", "Open"]),
                Incident.severity.in_(["High", "Critical"]),
            ).label("unassigned_escalations"),
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

    deltas_seconds: list[float] = []
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
        criticalOpenCases=int(counts.critical_open or 0),
        mttr=mttr_label,
        unassignedEscalations=int(counts.unassigned_escalations or 0),
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

    cases: list[CaseManagementCase] = []
    for inc in incidents:
        raw = inc.raw_payload if isinstance(inc.raw_payload, dict) else {}

        # AI narrative — prefer ingested value, fall back to constructed string.
        narrative: str = raw.get("aiThreatNarrative") or (
            f"Correlated attack on {inc.target_app}: "
            f"{inc.event_name} from {inc.source_ip}."
        )

        assignee: str = raw.get("assigneeName") or "Unassigned"
        initials: str = (
            "".join(part[0] for part in assignee.split()[:2]).upper()
            if assignee != "Unassigned"
            else ""
        )

        # Scope tags — prefer ingested list, fall back to [target_app].
        raw_tags = raw.get("scopeTags")
        scope_tags: list[str] = (
            [str(t) for t in raw_tags if t]
            if isinstance(raw_tags, list)
            else [inc.target_app]
        )

        cases.append(
            CaseManagementCase(
                caseId=inc.incident_id,
                scopeTags=scope_tags,
                aiThreatNarrative=narrative,
                assigneeName=assignee,
                assigneeInitials=initials,
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
