"""
services/query_service.py — Dashboard Data Query Service

This service is the single source of truth for how PostgreSQL data is
assembled into the exact JSON shapes the React frontend expects.

Design principles:
  - Each public method corresponds to one frontend API route.
  - Methods return Pydantic model instances — the router layer does NO
    data transformation, it only calls these methods and returns results.
  - All queries are async and use SQLAlchemy Core (select()) for maximum
    performance and testability.
  - The `env` parameter ("cloud" | "local") is a first-class filter on
    every query — it's the ATLAS environment-switching mechanism.
"""

import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import (
    Alert,
    ApiLog,
    DbActivityLog,
    EndpointLog,
    Incident,
    NetworkLog,
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
)

logger = logging.getLogger(__name__)

# Chart fill colours matching the frontend CSS variables
CHART_FILLS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
]

# Static user data (auth/profile is out of scope for this MVP)
_STATIC_USER = User(
    name="Jane Doe",
    email="jane.doe@atlas-sec.com",
    avatar="https://images.unsplash.com/photo-1438761681033-6461ffad8d80?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=200",
)

_CLOUD_APPLICATIONS = [
    Application(id="all", name="All Applications"),
    Application(id="payment-gateway", name="Payment Gateway"),
    Application(id="auth-service", name="Authentication Service"),
    Application(id="product-catalog", name="Product Catalog API"),
    Application(id="shipping-api", name="Shipping API"),
]

_LOCAL_APPLICATIONS = [
    Application(id="all", name="All Systems"),
    Application(id="hr-db", name="HR Database"),
    Application(id="fileserver-alpha", name="Fileserver Alpha"),
    Application(id="internal-wiki", name="Internal Wiki"),
    Application(id="domain-controller", name="Domain Controller"),
]

_CLOUD_MICROSERVICES = [
    Microservice(id="auth", name="Auth-Service", status="Healthy", position={"top": "50%", "left": "15%"}, connections=["pg", "cat"]),
    Microservice(id="pg", name="Payment-Gateway", status="Failing", position={"top": "20%", "left": "40%"}, connections=["ship"]),
    Microservice(id="cat", name="Product-Catalog", status="Healthy", position={"top": "80%", "left": "40%"}, connections=["rev"]),
    Microservice(id="ship", name="Shipping-API", status="Healthy", position={"top": "20%", "left": "70%"}, connections=[]),
    Microservice(id="rev", name="Reviews-Service", status="Healthy", position={"top": "80%", "left": "70%"}, connections=[]),
    Microservice(id="ext", name="3rd-Party-FX", status="Healthy", position={"top": "50%", "left": "90%"}, connections=[]),
]

_LOCAL_MICROSERVICES = [
    Microservice(id="firewall", name="Office-Firewall", status="Healthy", position={"top": "50%", "left": "15%"}, connections=["hr", "files"]),
    Microservice(id="hr", name="HR-Subnet", status="Failing", position={"top": "20%", "left": "50%"}, connections=["laptops"]),
    Microservice(id="files", name="File-Server", status="Healthy", position={"top": "80%", "left": "50%"}, connections=["laptops"]),
    Microservice(id="laptops", name="Employee-Laptops", status="Healthy", position={"top": "50%", "left": "85%"}, connections=[]),
]

_TEAM_USERS_CLOUD: List[TeamUser] = [
    TeamUser(id=1, name="Alice DevOps", email="alice@atlas-sec.com", role="Admin", avatar="https://i.pravatar.cc/150?img=1"),
    TeamUser(id=2, name="Bob SRE", email="bob@atlas-sec.com", role="Analyst", avatar="https://i.pravatar.cc/150?img=2"),
    TeamUser(id=3, name="Charlie SecOps", email="charlie@atlas-sec.com", role="Analyst", avatar="https://i.pravatar.cc/150?img=3"),
]

_TEAM_USERS_LOCAL: List[TeamUser] = [
    TeamUser(id=1, name="Dave IT", email="dave.it@atlas-internal.com", role="Admin", avatar="https://i.pravatar.cc/150?img=4"),
    TeamUser(id=2, name="Eve Security", email="eve.sec@atlas-internal.com", role="Admin", avatar="https://i.pravatar.cc/150?img=5"),
    TeamUser(id=3, name="Frank Helpdesk", email="frank.hd@atlas-internal.com", role="Analyst", avatar="https://i.pravatar.cc/150?img=6"),
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
    result = await db.execute(
        select(func.max(ApiLog.calls_today)).where(ApiLog.env == env)
    )
    api_requests = result.scalar() or 0

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
        select(func.max(ApiLog.blocked_count), func.max(ApiLog.calls_today)).where(
            ApiLog.env == env
        )
    )
    row = result.one_or_none()
    blocked = row[0] or 0 if row else 0
    total_calls = row[1] or 1 if row else 1
    error_rate = round((blocked / total_calls) * 100, 1) if total_calls > 0 else 0.0

    # ── Cost risk (blocked count scaled to 0-10) ──────────────────────────────
    cost_risk = min(10, int((blocked / max(total_calls, 1)) * 100))

    # ── App anomalies (from endpoint logs) ────────────────────────────────────
    result = await db.execute(
        select(
            func.count(EndpointLog.id).label("cnt"),
            EndpointLog.workstation_id,
        )
        .where(EndpointLog.env == env)
        .group_by(EndpointLog.workstation_id)
        .order_by(func.count(EndpointLog.id).desc())
        .limit(6)
    )
    rows = result.all()

    # Aggregate by app name for the chart
    app_anomaly_map: Dict[str, int] = defaultdict(int)
    for cnt, ws_id in rows:
        app_label = ws_id.split("-")[0] if "-" in ws_id else ws_id
        app_anomaly_map[app_label] += cnt

    app_anomalies = [
        AppAnomaly(name=name, anomalies=count)
        for name, count in list(app_anomaly_map.items())[:5]
    ]

    # ── API requests BY APP (categorical bar chart — NO time-series) ─────────────
    result = await db.execute(
        select(ApiLog.app, func.sum(ApiLog.actual_calls).label("requests"))
        .where(ApiLog.env == env)
        .group_by(ApiLog.app)
        .order_by(func.sum(ApiLog.actual_calls).desc())
        .limit(12)
    )
    api_requests_by_app = [
        ApiRequestsByApp(app=row[0], requests=int(row[1]))
        for row in result.all()
    ]

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
    microservices = _CLOUD_MICROSERVICES if env == "cloud" else _LOCAL_MICROSERVICES
    failing_endpoints = {"pg": "/v1/process-card"} if env == "cloud" else {"hr": "Port 3389 (RDP)"}

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
        select(ApiLog).where(ApiLog.env == env).order_by(ApiLog.id)
    )
    all_logs = result.scalars().all()

    if not all_logs:
        return ApiMonitoringData(
            apiCallsToday=0, blockedRequests=0, avgLatency=0,
            estimatedCost=0, apiConsumptionByApp=[], apiRouting=[],
        )

    # ── KPI stats (take from the first row — same for all rows of same env) ───
    first = all_logs[0]
    api_calls_today = first.calls_today
    blocked_requests = first.blocked_count
    avg_latency = first.avg_latency_ms
    estimated_cost = first.estimated_cost

    # ── API consumption BY APP (categorical bar chart — NO time-series) ───────
    app_actual: Dict[str, int] = defaultdict(int)
    app_predicted: Dict[str, int] = defaultdict(int)
    for log in all_logs:
        app_actual[log.app] += log.actual_calls
        app_predicted[log.app] += log.predicted_calls
    # Use max(actual*1.2, predicted) as "limit" for bar comparison
    api_consumption_by_app = [
        ApiConsumptionByApp(
            app=app,
            actual=actual,
            limit=max(int(actual * 1.2), app_predicted.get(app, 0)) or 1,
        )
        for app, actual in sorted(app_actual.items(), key=lambda x: -x[1])[:12]
    ]

    # ── API routing table (deduplicated by app+path) ──────────────────────────
    seen = set()
    api_routing: List[ApiRoute] = []
    counter = 1
    for log in all_logs:
        key = (log.app, log.path)
        if key in seen:
            continue
        seen.add(key)
        api_routing.append(ApiRoute(
            id=counter,
            app=log.app,
            path=log.path,
            method=log.method,
            cost=log.cost_per_call,
            trend=log.trend_pct,
            action=log.action,
        ))
        counter += 1

    return ApiMonitoringData(
        apiCallsToday=api_calls_today,
        blockedRequests=blocked_requests,
        avgLatency=avg_latency,
        estimatedCost=estimated_cost,
        apiConsumptionByApp=api_consumption_by_app,
        apiRouting=api_routing,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Network Traffic
# ─────────────────────────────────────────────────────────────────────────────

async def get_network_traffic(env: str, db: AsyncSession) -> NetworkTrafficData:
    """
    Assembles the Network Traffic page payload from network_logs.
    KPI stats are taken from the first matching row (env-level aggregates).
    """
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
    """
    Assembles the Endpoint Security page payload.

    OS Distribution and Alert Type distribution are computed by aggregating
    counts from endpoint_logs — no hardcoded values.
    """
    result = await db.execute(
        select(EndpointLog).where(EndpointLog.env == env).order_by(EndpointLog.id)
    )
    logs = result.scalars().all()

    if not logs:
        return EndpointSecurityData(
            monitoredLaptops=0, offlineDevices=0, malwareAlerts=0,
            osDistribution=[], alertTypes=[], wazuhEvents=[],
        )

    # ── KPI stats ─────────────────────────────────────────────────────────────
    monitored = len(logs)
    offline = sum(1 for l in logs if l.is_offline)
    malware = sum(1 for l in logs if l.is_malware)

    # ── OS Distribution ───────────────────────────────────────────────────────
    os_counts: Dict[str, int] = defaultdict(int)
    for log in logs:
        os_counts[log.os_name] += 1
    os_distribution = [
        OsDistribution(name=name, value=count, fill=CHART_FILLS[i % len(CHART_FILLS)])
        for i, (name, count) in enumerate(sorted(os_counts.items(), key=lambda x: -x[1]))
    ]

    # ── Alert Type Distribution ───────────────────────────────────────────────
    alert_counts: Dict[str, int] = defaultdict(int)
    for log in logs:
        alert_counts[log.alert_category] += 1
    alert_types = [
        AlertTypeDistribution(name=name, value=count, fill=CHART_FILLS[(i + 2) % len(CHART_FILLS)])
        for i, (name, count) in enumerate(sorted(alert_counts.items(), key=lambda x: -x[1]))
    ]

    # ── Wazuh/Velociraptor Events table ───────────────────────────────────────
    wazuh_events = [
        WazuhEvent(
            id=i + 1,
            workstationId=log.workstation_id,
            employee=log.employee,
            avatar=log.avatar,
            alert=log.alert_message,
            severity=log.severity,
        )
        for i, log in enumerate(logs[:10])  # Limit to 10 most recent
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
    """
    Assembles the Database Monitoring page payload.

    operationsChart is built by grouping by hour_label — the JSONL files
    store hourly snapshots, so each hour_label appears multiple times but
    we take the last value seen (latest snapshot wins).
    """
    result = await db.execute(
        select(DbActivityLog).where(DbActivityLog.env == env).order_by(DbActivityLog.id)
    )
    logs = result.scalars().all()

    if not logs:
        return DbMonitoringData(
            activeConnections=0, avgQueryLatency=0, dataExportVolume=0,
            operationsByApp=[], dlpByTargetApp=[], suspiciousActivity=[],
        )

    # ── KPI stats from a representative row ───────────────────────────────────
    first = logs[0]
    active_connections = first.active_connections
    avg_latency = first.avg_latency_ms
    export_volume = first.data_export_volume_tb

    # ── Operations BY APP (categorical bar chart — NO time-series) ─────────────
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

    # ── DLP / Suspicious BY TARGET APP (categorical bar chart) ────────────────
    suspicious_logs_list = [l for l in logs if l.is_suspicious]
    app_dlp: Dict[str, int] = defaultdict(int)
    for log in suspicious_logs_list:
        app_dlp[log.app] += 1
    dlp_by_target_app = [
        DlpByTargetApp(app=app, count=count)
        for app, count in sorted(app_dlp.items(), key=lambda x: -x[1])
    ]

    # ── Suspicious Activity table ─────────────────────────────────────────────
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
    """
    Returns the incidents list for a given environment.
    Frontend expects a direct JSON array (no wrapper object).
    """
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
    """Updates an incident's status in place. Returns None if not found."""
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


# ─────────────────────────────────────────────────────────────────────────────
# Header Data
# ─────────────────────────────────────────────────────────────────────────────

async def get_header_data(env: str, db: AsyncSession) -> HeaderData:
    """
    Returns the header notification bell data, application list, and user info.
    """
    result = await db.execute(
        select(Alert)
        .where(Alert.env == env)
        .order_by(Alert.id.desc())
        .limit(5)
    )
    alert_rows = result.scalars().all()

    recent_alerts = [
        RecentAlert(
            id=a.alert_id,
            app=a.app,
            message=a.message,
            severity=a.severity,
            timestamp=a.timestamp_label,
        )
        for a in alert_rows
    ]

    applications = _CLOUD_APPLICATIONS if env == "cloud" else _LOCAL_APPLICATIONS

    return HeaderData(
        user=_STATIC_USER,
        applications=applications,
        recentAlerts=recent_alerts,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Users
# ─────────────────────────────────────────────────────────────────────────────

async def get_team_users(env: str, db: AsyncSession) -> List[TeamUser]:
    """Returns the team user list for a given environment."""
    # Users are static in this MVP — extend to a `users` table for production.
    return _TEAM_USERS_CLOUD if env == "cloud" else _TEAM_USERS_LOCAL
