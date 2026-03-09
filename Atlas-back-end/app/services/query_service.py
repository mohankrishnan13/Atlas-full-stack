"""
services/query_service.py — Dashboard Data Query Service
"""

import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import (
    Alert,
    Application as ApplicationRow,
    AppConfig as AppConfigRow,
    ApiLog,
    AtlasUser,  # <── Replaced DashboardUser and TeamUser
    DbActivityLog,
    EndpointLog,
    Incident,
    Microservice as MicroserviceRow,
    NetworkLog,
    QuarantinedEndpoint as QuarantinedEndpointRow,
    ReportDownload as ReportDownloadRow,
    ScheduledReport as ScheduledReportRow,
)
from app.models.schemas import (
    AlertTypeDistribution,
    ApiConsumptionByApp,
    ApiMonitoringData,
    ApiRequestsByApp,
    ApiRoute,
    AppAnomaly,
    Application,
    DbMonitoringData,
    DlpByTargetApp,
    EndpointSecurityData,
    HeaderData,
    Incident as IncidentSchema,
    Microservice,
    NetworkAnomaly,
    NetworkTrafficData,
    OperationsByApp,
    OsDistribution,
    OverviewData,
    RecentAlert,
    SuspiciousActivity,
    SystemAnomaly,
    TeamUser,
    User,
    WazuhEvent,
    AppConfigResponse,
    AppConfigUpdateRequest,
    CaseManagementCase,
    CaseManagementKpis,
    CaseManagementResponse,
    GenerateReportRequest,
    GenerateReportResponse,
    LiftQuarantineResponse,
    QuarantinedEndpointRow as QuarantinedEndpointSchema,
    QuarantinedEndpointsResponse,
    RecentDownloadRow,
    ReportsOverviewResponse,
    ScheduledReportRow as ScheduledReportSchema,
)

logger = logging.getLogger(__name__)

CHART_FILLS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
]

# ─────────────────────────────────────────────────────────────────────────────
# Header / Notification Bell
# ─────────────────────────────────────────────────────────────────────────────

async def get_header_data(env: str, db: AsyncSession) -> HeaderData:
    # ── Swapped to AtlasUser ──
    user_row = (
        await db.execute(
            select(AtlasUser).where(AtlasUser.env == env).order_by(AtlasUser.id.asc()).limit(1)
        )
    ).scalars().first()

    user = User(
        name=user_row.name if user_row else "",
        email=user_row.email if user_row else "",
        avatar=user_row.avatar if user_row else "",
    )

    apps_rows = (
        await db.execute(
            select(ApplicationRow).where(ApplicationRow.env == env).order_by(ApplicationRow.id.asc())
        )
    ).scalars().all()
    applications = [Application(id=a.app_id, name=a.name) for a in apps_rows]

    alerts_rows = (
        await db.execute(
            select(Alert)
            .where(Alert.env == env)
            .order_by(Alert.timestamp.desc())
            .limit(10)
        )
    ).scalars().all()
    recent_alerts = [
        RecentAlert(
            id=a.alert_id,
            app=a.app,
            message=a.message,
            severity=a.severity,
            timestamp=a.timestamp_label,
        )
        for a in alerts_rows
    ]

    return HeaderData(user=user, applications=applications, recentAlerts=recent_alerts)


# ─────────────────────────────────────────────────────────────────────────────
# Team Users (Settings Page)
# ─────────────────────────────────────────────────────────────────────────────

async def get_team_users(env: str, db: AsyncSession) -> List[TeamUser]:
    # ── Swapped to AtlasUser and mapped to the updated TeamUser schema ──
    rows = (
        await db.execute(
            select(AtlasUser)
            .where(AtlasUser.env == env)
            .order_by(AtlasUser.id.asc())
        )
    ).scalars().all()
    
    return [
        TeamUser(
            id=u.id, 
            name=u.name, 
            email=u.email, 
            role=u.role, 
            avatar=u.avatar,
            is_active=u.is_active,
            invite_pending=u.invite_pending
        ) 
        for u in rows
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Overview
# ─────────────────────────────────────────────────────────────────────────────

async def get_overview(env: str, db: AsyncSession) -> OverviewData:
    """
    Assembles the Overview page payload from multiple DB queries.
    Derives KPI stats, topology, anomaly chart, and system anomaly table.
    """
    # ── API request volume from api_logs ─────────────────────────────────────
    result = await db.execute(select(func.count(ApiLog.id)).where(ApiLog.env == env))
    api_requests = int(result.scalar() or 0)

    # ── Active alerts count ───────────────────────────────────────────────────
    result = await db.execute(
        select(func.count(Alert.id)).where(
            Alert.env == env,
            Alert.severity.in_(["Critical", "High"]),
        )
    )
    active_alerts = result.scalar() or 0

    # ── Error rate approximation from api logs ────────────────────────────────
    result = await db.execute(
        select(
            func.count(ApiLog.id).label("total"),
            func.count(ApiLog.id).filter(ApiLog.severity.in_(["High", "Critical"])).label("bad"),
        ).where(ApiLog.env == env)
    )
    row = result.one()
    total_calls = int(row.total or 0)
    blocked = int(row.bad or 0)
    if total_calls == 0:
        total_calls = 1
    error_rate = round((blocked / total_calls) * 100, 1) if total_calls > 0 else 0.0

    # ── Cost risk (blocked count scaled to 0-10) ──────────────────────────────
    cost_risk = min(10, int((blocked / max(total_calls, 1)) * 100))

    # ── App anomalies (from endpoint logs) ────────────────────────────────────
    result = await db.execute(
        select(EndpointLog.target_app, func.count(EndpointLog.id))
        .where(EndpointLog.env == env)
        .group_by(EndpointLog.target_app)
        .order_by(func.count(EndpointLog.id).desc())
        .limit(8)
    )
    app_anomalies = [AppAnomaly(name=row[0] or "Unknown", anomalies=int(row[1] or 0)) for row in result.all()]

    # ── API requests BY APP (categorical bar chart — NO time-series) ─────────────
    result = await db.execute(
        select(ApiLog.target_app, func.count(ApiLog.id).label("requests"))
        .where(ApiLog.env == env)
        .group_by(ApiLog.target_app)
        .order_by(func.count(ApiLog.id).desc())
        .limit(12)
    )
    api_requests_by_app = [ApiRequestsByApp(app=row[0] or "Unknown", requests=int(row[1] or 0)) for row in result.all()]

    # ── System anomalies from incidents ──────────────────────────────────────
    result = await db.execute(
        select(Incident)
        .where(Incident.env == env, Incident.status.in_(["Active", "Contained"]))
        .order_by(Incident.timestamp.desc())
        .limit(5)
    )
    incidents = result.scalars().all()
    system_anomalies = [
        SystemAnomaly(
            id=inc.incident_id,
            service=inc.target_app,
            type=inc.event_name,
            severity=inc.severity,
            timestamp=inc.timestamp,
        )
        for inc in incidents
    ]

    # ── Topology ──────────────────────────────────────────────────────────────
    svc_rows = (
        await db.execute(
            select(MicroserviceRow).where(MicroserviceRow.env == env).order_by(MicroserviceRow.id.asc())
        )
    ).scalars().all()
    microservices = [
        Microservice(
            id=s.service_id,
            name=s.name,
            status=s.status,
            position={"top": s.position_top, "left": s.position_left},
            connections=[c for c in (s.connections_csv or "").split(",") if c],
        )
        for s in svc_rows
    ]

    failing_endpoints: Dict[str, str] = {}
    result = await db.execute(
        select(ApiLog.path, func.count(ApiLog.id).label("cnt"))
        .where(ApiLog.env == env, ApiLog.severity.in_(["High", "Critical"]))
        .group_by(ApiLog.path)
        .order_by(func.count(ApiLog.id).desc())
        .limit(10)
    )
    for path, cnt in result.all():
        if path and cnt and int(cnt) > 0:
            failing_endpoints[path] = str(int(cnt))

    return OverviewData(
        apiRequests=api_requests,
        errorRate=error_rate,
        activeAlerts=active_alerts,
        costRisk=cost_risk,
        appAnomalies=app_anomalies,
        microservices=microservices,
        failingEndpoints=failing_endpoints,
        apiRequestsByApp=api_requests_by_app,
        systemAnomalies=system_anomalies,
    )


# ─────────────────────────────────────────────────────────────────────────────
# API Monitoring
# ─────────────────────────────────────────────────────────────────────────────

async def get_api_monitoring(env: str, db: AsyncSession) -> ApiMonitoringData:
    """
    Assembles the API Monitoring page payload.
    Deduplicates routes and builds hourly usage chart from api_logs.
    """
    result = await db.execute(
        select(
            func.count(ApiLog.id).label("total"),
            func.count(ApiLog.id).filter(ApiLog.severity.in_(["High", "Critical"])).label("blocked"),
            func.avg(ApiLog.avg_latency_ms).label("avg_latency"),
            func.sum(ApiLog.estimated_cost).label("estimated_cost"),
        ).where(ApiLog.env == env)
    )
    row = result.one()

    total = int(row.total or 0)
    blocked = int(row.blocked or 0)
    avg_latency = float(row.avg_latency or 0.0)
    estimated_cost = float(row.estimated_cost or 0.0)

    if total == 0:
        return ApiMonitoringData(
            apiCallsToday=0,
            blockedRequests=0,
            avgLatency=0,
            estimatedCost=0,
            apiConsumptionByApp=[],
            apiRouting=[],
        )

    result = await db.execute(
        select(ApiLog.target_app, func.count(ApiLog.id).label("actual"))
        .where(ApiLog.env == env)
        .group_by(ApiLog.target_app)
        .order_by(func.count(ApiLog.id).desc())
        .limit(12)
    )
    api_consumption_by_app = []
    for app, actual in result.all():
        actual_i = int(actual or 0)
        api_consumption_by_app.append(
            ApiConsumptionByApp(
                app=app or "Unknown",
                actual=actual_i,
                limit=max(int(actual_i * 1.2), actual_i) or 1,
            )
        )

    result = await db.execute(
        select(
            ApiLog.target_app,
            ApiLog.path,
            func.max(ApiLog.method).label("method"),
            func.max(ApiLog.cost_per_call).label("cost"),
            func.max(ApiLog.trend_pct).label("trend"),
            func.max(ApiLog.action).label("action"),
            func.count(ApiLog.id).label("cnt"),
        )
        .where(ApiLog.env == env)
        .group_by(ApiLog.target_app, ApiLog.path)
        .order_by(func.count(ApiLog.id).desc())
        .limit(50)
    )
    api_routing: List[ApiRoute] = []
    for i, r in enumerate(result.all(), start=1):
        api_routing.append(
            ApiRoute(
                id=i,
                app=r[0] or "Unknown",
                path=r[1] or "",
                method=r[2] or "GET",
                cost=float(r[3] or 0.0),
                trend=int(r[4] or 0),
                action=r[5] or "OK",
            )
        )

    return ApiMonitoringData(
        apiCallsToday=total,
        blockedRequests=blocked,
        avgLatency=avg_latency,
        estimatedCost=estimated_cost,
        apiConsumptionByApp=api_consumption_by_app,
        apiRouting=api_routing,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Network Traffic
# ─────────────────────────────────────────────────────────────────────────────

async def get_network_traffic(env: str, db: AsyncSession) -> NetworkTrafficData:
    result = await db.execute(
        select(NetworkLog).where(NetworkLog.env == env).order_by(NetworkLog.id)
    )
    logs = result.scalars().all()

    if not logs:
        return NetworkTrafficData(
            bandwidth=0, activeConnections=0, droppedPackets=0, networkAnomalies=[]
        )

    first = logs[0]
    anomalies = [
        NetworkAnomaly(
            id=i + 1,
            sourceIp=log.source_ip,
            destIp=log.dest_ip,
            app=log.app,
            port=log.port,
            type=log.anomaly_type,
        )
        for i, log in enumerate(logs)
    ]

    return NetworkTrafficData(
        bandwidth=first.bandwidth_pct,
        activeConnections=first.active_connections,
        droppedPackets=first.dropped_packets,
        networkAnomalies=anomalies,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint Security
# ─────────────────────────────────────────────────────────────────────────────

async def get_endpoint_security(env: str, db: AsyncSession) -> EndpointSecurityData:
    result = await db.execute(
        select(
            func.count(EndpointLog.id).label("total"),
            func.count(EndpointLog.id).filter(EndpointLog.is_offline.is_(True)).label("offline"),
            func.count(EndpointLog.id).filter(EndpointLog.is_malware.is_(True)).label("malware"),
        ).where(EndpointLog.env == env)
    )
    row = result.one()
    monitored = int(row.total or 0)
    offline = int(row.offline or 0)
    malware = int(row.malware or 0)

    if monitored == 0:
        return EndpointSecurityData(
            monitoredLaptops=0,
            offlineDevices=0,
            malwareAlerts=0,
            osDistribution=[],
            alertTypes=[],
            wazuhEvents=[],
        )

    result = await db.execute(
        select(EndpointLog.os_name, func.count(EndpointLog.id))
        .where(EndpointLog.env == env)
        .group_by(EndpointLog.os_name)
        .order_by(func.count(EndpointLog.id).desc())
    )
    os_distribution = [
        OsDistribution(name=name or "Unknown", value=int(cnt or 0), fill=CHART_FILLS[i % len(CHART_FILLS)])
        for i, (name, cnt) in enumerate(result.all())
    ]

    result = await db.execute(
        select(EndpointLog.alert_category, func.count(EndpointLog.id))
        .where(EndpointLog.env == env)
        .group_by(EndpointLog.alert_category)
        .order_by(func.count(EndpointLog.id).desc())
    )
    alert_types = [
        AlertTypeDistribution(
            name=name or "Unknown",
            value=int(cnt or 0),
            fill=CHART_FILLS[(i + 2) % len(CHART_FILLS)],
        )
        for i, (name, cnt) in enumerate(result.all())
    ]

    result = await db.execute(
        select(EndpointLog)
        .where(EndpointLog.env == env)
        .order_by(EndpointLog.timestamp.desc())
        .limit(10)
    )
    logs = result.scalars().all()
    wazuh_events = [
        WazuhEvent(
            id=i + 1,
            workstationId=log.workstation_id,
            employee=log.employee,
            avatar=log.avatar,
            alert=log.alert_message,
            severity=log.severity,
        )
        for i, log in enumerate(logs)
    ]

    return EndpointSecurityData(
        monitoredLaptops=monitored,
        offlineDevices=offline,
        malwareAlerts=malware,
        osDistribution=os_distribution,
        alertTypes=alert_types,
        wazuhEvents=wazuh_events,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Database Monitoring
# ─────────────────────────────────────────────────────────────────────────────

async def get_db_monitoring(env: str, db: AsyncSession) -> DbMonitoringData:
    result = await db.execute(
        select(DbActivityLog).where(DbActivityLog.env == env).order_by(DbActivityLog.id)
    )
    logs = result.scalars().all()

    if not logs:
        return DbMonitoringData(
            activeConnections=0, avgQueryLatency=0, dataExportVolume=0,
            operationsByApp=[], dlpByTargetApp=[], suspiciousActivity=[],
        )

    first = logs[0]
    active_connections = first.active_connections
    avg_latency = first.avg_latency_ms
    export_volume = first.data_export_volume_tb

    app_ops: Dict[str, Dict[str, int]] = defaultdict(lambda: {"SELECT": 0, "INSERT": 0, "UPDATE": 0, "DELETE": 0})
    for log in logs:
        app_ops[log.app]["SELECT"] += log.select_count
        app_ops[log.app]["INSERT"] += log.insert_count
        app_ops[log.app]["UPDATE"] += log.update_count
        app_ops[log.app]["DELETE"] += log.delete_count
    operations_by_app = [
        OperationsByApp(
            app=app,
            SELECT=data["SELECT"],
            INSERT=data["INSERT"],
            UPDATE=data["UPDATE"],
            DELETE=data["DELETE"],
        )
        for app, data in sorted(app_ops.items(), key=lambda x: -(x[1]["SELECT"] + x[1]["INSERT"] + x[1]["UPDATE"] + x[1]["DELETE"]))[:12]
    ]

    suspicious_logs_list = [l for l in logs if l.is_suspicious]
    app_dlp: Dict[str, int] = defaultdict(int)
    for log in suspicious_logs_list:
        app_dlp[log.app] += 1
    dlp_by_target_app = [
        DlpByTargetApp(app=app, count=count)
        for app, count in sorted(app_dlp.items(), key=lambda x: -x[1])
    ]

    suspicious_activity = [
        SuspiciousActivity(
            id=i + 1,
            app=log.app,
            user=log.db_user,
            type=log.query_type,
            table=log.target_table,
            reason=log.reason,
        )
        for i, log in enumerate(suspicious_logs_list)
    ]

    return DbMonitoringData(
        activeConnections=active_connections,
        avgQueryLatency=avg_latency,
        dataExportVolume=export_volume,
        operationsByApp=operations_by_app,
        dlpByTargetApp=dlp_by_target_app,
        suspiciousActivity=suspicious_activity,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Incidents
# ─────────────────────────────────────────────────────────────────────────────

async def get_incidents(env: str, db: AsyncSession) -> List[IncidentSchema]:
    result = await db.execute(
        select(Incident).where(Incident.env == env).order_by(Incident.timestamp.desc())
    )
    incidents = result.scalars().all()

    return [
        IncidentSchema(
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
        for inc in incidents
    ]

async def update_incident_status(
    incident_id: str,
    new_status: str,
    db: AsyncSession,
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

def _to_incident_schema(inc: Incident) -> IncidentSchema:
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


# ─────────────────────────────────────────────────────────────────────────────
# Figma-Specific Endpoints (Option 2)
# ─────────────────────────────────────────────────────────────────────────────


async def get_or_create_app_config(env: str, app_id: str, db: AsyncSession) -> AppConfigRow:
    existing = (
        await db.execute(select(AppConfigRow).where(AppConfigRow.env == env, AppConfigRow.app_id == app_id))
    ).scalars().first()
    if existing:
        return existing

    cfg = AppConfigRow(env=env, app_id=app_id)
    db.add(cfg)
    await db.flush()
    return cfg


def _cfg_to_schema(cfg: AppConfigRow) -> AppConfigResponse:
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


async def get_app_config(env: str, app_id: str, db: AsyncSession) -> AppConfigResponse:
    cfg = await get_or_create_app_config(env, app_id, db)
    return _cfg_to_schema(cfg)


async def update_app_config(env: str, app_id: str, body: AppConfigUpdateRequest, db: AsyncSession) -> AppConfigResponse:
    cfg = await get_or_create_app_config(env, app_id, db)
    data = body.model_dump(exclude_none=True)

    if "warningAnomalyScore" in data:
        cfg.warning_anomaly_score = int(data["warningAnomalyScore"])
    if "criticalAnomalyScore" in data:
        cfg.critical_anomaly_score = int(data["criticalAnomalyScore"])
    if "softRateLimitCallsPerMin" in data:
        cfg.soft_rate_limit_calls_per_min = int(data["softRateLimitCallsPerMin"])
    if "hardBlockThresholdCallsPerMin" in data:
        cfg.hard_block_threshold_calls_per_min = int(data["hardBlockThresholdCallsPerMin"])
    if "autoQuarantineLaptops" in data:
        cfg.auto_quarantine_laptops = bool(data["autoQuarantineLaptops"])
    if "trainingWindowDays" in data:
        cfg.training_window_days = int(data["trainingWindowDays"])
    if "modelSensitivityPct" in data:
        cfg.model_sensitivity_pct = int(data["modelSensitivityPct"])
    if "autoUpdateBaselinesWeekly" in data:
        cfg.auto_update_baselines_weekly = bool(data["autoUpdateBaselinesWeekly"])
    if "baselineModelName" in data:
        cfg.baseline_model_name = str(data["baselineModelName"])

    db.add(cfg)
    await db.flush()
    return _cfg_to_schema(cfg)


async def get_quarantined_endpoints(env: str, app_id: str, db: AsyncSession) -> QuarantinedEndpointsResponse:
    cfg = await get_or_create_app_config(env, app_id, db)
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


async def lift_quarantine(env: str, app_id: str, workstation_id: str, db: AsyncSession) -> LiftQuarantineResponse:
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
        return LiftQuarantineResponse(success=False, message="No active quarantine found for that workstation.")

    row.status = "Lifted"
    db.add(row)
    await db.flush()
    return LiftQuarantineResponse(success=True, message=f"Quarantine lifted for {workstation_id}.")


async def get_case_management(env: str, db: AsyncSession) -> CaseManagementResponse:
    result = await db.execute(
        select(
            func.count(Incident.id).filter(Incident.severity == "Critical").label("critical"),
            func.count(Incident.id).filter(Incident.status.in_(["Active", "Investigating", "Open"])).label("open"),
            func.count(Incident.id).filter(
                Incident.status.in_(["Active", "Investigating", "Open"]),
                Incident.severity.in_(["High", "Critical"]),
            ).label("unassigned"),
        ).where(Incident.env == env)
    )
    row = result.one()

    kpis = CaseManagementKpis(
        criticalOpenCases=int(row.critical or 0),
        mttr="14m 22s",
        unassignedEscalations=int(row.unassigned or 0),
    )

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
        raw = inc.raw_payload if isinstance(inc.raw_payload, dict) else {}
        narrative = raw.get("aiThreatNarrative") or (
            f"Correlated Attack: External IP brute-forced the {inc.target_app} service, then triggered anomalous activity."
        )
        assignee = raw.get("assigneeName") or "Unassigned"
        initials = "".join([p[0] for p in assignee.split()[:2]]).upper() if assignee != "Unassigned" else ""
        scope_tags = raw.get("scopeTags") if isinstance(raw.get("scopeTags"), list) else [inc.target_app]

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


async def get_reports_overview(env: str, db: AsyncSession) -> ReportsOverviewResponse:
    scheduled = (
        await db.execute(
            select(ScheduledReportRow)
            .where(ScheduledReportRow.env == env)
            .order_by(ScheduledReportRow.id.asc())
            .limit(50)
        )
    ).scalars().all()

    scheduled_rows = [
        ScheduledReportSchema(
            id=r.id,
            title=r.title,
            description=r.description,
            schedule=r.schedule,
            active=bool(r.enabled),
            configureLabel="Configure",
        )
        for r in scheduled
    ]

    downloads = (
        await db.execute(
            select(ReportDownloadRow)
            .where(ReportDownloadRow.env == env)
            .order_by(ReportDownloadRow.id.desc())
            .limit(20)
        )
    ).scalars().all()

    download_rows = [
        RecentDownloadRow(
            id=d.id,
            fileName=d.file_name,
            targetAppScope=d.target_app_scope,
            generated=d.generated_at_label,
            size=d.size_label,
            downloadUrl=d.download_url,
        )
        for d in downloads
    ]

    return ReportsOverviewResponse(scheduledReports=scheduled_rows, recentDownloads=download_rows)


async def generate_report(env: str, body: GenerateReportRequest, db: AsyncSession) -> GenerateReportResponse:
    file_ext = "pdf" if body.exportFormat.upper() == "PDF" else "csv"
    file_name = f"{body.dataSource}_{body.template}_Audit.{file_ext}".replace(" ", "_")
    d = ReportDownloadRow(
        env=env,
        file_name=file_name,
        target_app_scope=body.dataSource,
        generated_at_label="Today",
        size_label="2.4 MB" if file_ext == "pdf" else "1.8 MB",
        download_url=f"/reports/download/{file_name}",
    )
    db.add(d)
    await db.flush()

    download = RecentDownloadRow(
        id=d.id,
        fileName=d.file_name,
        targetAppScope=d.target_app_scope,
        generated=d.generated_at_label,
        size=d.size_label,
        downloadUrl=d.download_url,
    )
    return GenerateReportResponse(success=True, message="Report generated.", download=download)