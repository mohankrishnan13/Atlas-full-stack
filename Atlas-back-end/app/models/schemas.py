"""
models/schemas.py — Pydantic Response Schemas

CRITICAL CONTRACT: Every field name and type in these models MUST exactly
match what the React frontend expects, as discovered in Phase 1 analysis.
Do NOT rename fields without updating the corresponding frontend component.

Frontend-discovered contracts:
  - OverviewData (overview/page.tsx)
  - ApiMonitoringData (api-monitoring/page.tsx)
  - NetworkTrafficData (network-traffic/page.tsx)
  - EndpointSecurityData (endpoint-security/page.tsx)
  - DbMonitoringData (database-monitoring/page.tsx)
  - Incident[] — direct array, NOT wrapped (incidents/page.tsx)
  - HeaderData — { user, applications, recentAlerts } (header.tsx)
  - TeamUser[] — direct array (settings/page.tsx)
  - QuarantineResponse (endpoint-security/page.tsx)
  - RemediateResponse (incidents/page.tsx)
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel


# ─────────────────────────────────────────────────────────────────────────────
# Shared / Primitive Types
# ─────────────────────────────────────────────────────────────────────────────

class TimeSeriesData(BaseModel):
    """Generic time-series data point. Extra keys allowed for chart flexibility."""
    name: str

    class Config:
        extra = "allow"


# ─────────────────────────────────────────────────────────────────────────────
# Overview Page  (/overview?env=)
# ─────────────────────────────────────────────────────────────────────────────

class AppAnomaly(BaseModel):
    name: str
    anomalies: int


class Microservice(BaseModel):
    id: str
    name: str
    status: str        # "Healthy" | "Failing"
    position: Dict[str, str]   # { top: "50%", left: "15%" }
    connections: List[str]


class SystemAnomaly(BaseModel):
    id: str
    service: str
    type: str
    severity: str      # "Critical" | "High" | "Medium" | "Low"
    timestamp: str


class ApiRequestsByApp(BaseModel):
    """Categorical: application name -> request count (for bar charts)."""
    app: str
    requests: int


class OverviewData(BaseModel):
    apiRequests: int
    errorRate: float
    activeAlerts: int
    costRisk: int
    appAnomalies: List[AppAnomaly]
    microservices: List[Microservice]
    failingEndpoints: Dict[str, str]
    apiRequestsByApp: List[ApiRequestsByApp]   # Bar chart: X = app, Y = requests (NO time-series)
    systemAnomalies: List[SystemAnomaly]


# ─────────────────────────────────────────────────────────────────────────────
# API Monitoring Page  (/api-monitoring?env=)
# ─────────────────────────────────────────────────────────────────────────────

class ApiRoute(BaseModel):
    id: int
    app: str
    path: str
    method: str
    cost: float
    trend: int
    action: str   # "OK" | "Rate-Limited" | "Blocked"


class ApiBlockRouteRequest(BaseModel):
    """Request to apply hard block on an API route (app + path)."""
    app: str
    path: str


class ApiConsumptionByApp(BaseModel):
    """Categorical: app -> actual load vs limit (for bar charts)."""
    app: str
    actual: int
    limit: int  # or predicted/hard limit


class ApiMonitoringData(BaseModel):
    apiCallsToday: int
    blockedRequests: int
    avgLatency: float
    estimatedCost: float
    apiConsumptionByApp: List[ApiConsumptionByApp]   # Bar chart: X = app, Y = actual/limit (NO time-series)
    apiRouting: List[ApiRoute]


# ─────────────────────────────────────────────────────────────────────────────
# Network Traffic Page  (/network-traffic?env=)
# ─────────────────────────────────────────────────────────────────────────────

class NetworkAnomaly(BaseModel):
    id: int
    sourceIp: str
    destIp: str
    app: str
    port: int
    type: str


class NetworkTrafficData(BaseModel):
    bandwidth: int
    activeConnections: int
    droppedPackets: int
    networkAnomalies: List[NetworkAnomaly]


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint Security Page  (/endpoint-security?env=)
# ─────────────────────────────────────────────────────────────────────────────

class OsDistribution(BaseModel):
    name: str
    value: int
    fill: str   # CSS HSL string e.g. "hsl(var(--chart-1))"


class AlertTypeDistribution(BaseModel):
    name: str
    value: int
    fill: str


class WazuhEvent(BaseModel):
    id: int
    workstationId: str
    employee: str
    avatar: str
    alert: str
    severity: str


class EndpointSecurityData(BaseModel):
    monitoredLaptops: int
    offlineDevices: int
    malwareAlerts: int
    osDistribution: List[OsDistribution]
    alertTypes: List[AlertTypeDistribution]
    wazuhEvents: List[WazuhEvent]


# ─────────────────────────────────────────────────────────────────────────────
# Database Monitoring Page  (/db-monitoring?env=)
# ─────────────────────────────────────────────────────────────────────────────

class SuspiciousActivity(BaseModel):
    id: int
    app: str
    user: str
    type: str
    table: str
    reason: str


class OperationsByApp(BaseModel):
    """Categorical: target app/database -> operation counts (for bar charts)."""
    app: str
    SELECT: int = 0
    INSERT: int = 0
    UPDATE: int = 0
    DELETE: int = 0


class DlpByTargetApp(BaseModel):
    """Categorical: target app -> suspicious/DLP count (for bar charts)."""
    app: str
    count: int


class DbMonitoringData(BaseModel):
    activeConnections: int
    avgQueryLatency: float
    dataExportVolume: float
    operationsByApp: List[OperationsByApp]   # Bar chart: X = app, Y = ops (NO time-series)
    dlpByTargetApp: List[DlpByTargetApp]     # Bar chart: X = app, Y = count
    suspiciousActivity: List[SuspiciousActivity]


# ─────────────────────────────────────────────────────────────────────────────
# Incidents Page  (/incidents?env=)  — returns a LIST directly
# ─────────────────────────────────────────────────────────────────────────────

class Incident(BaseModel):
    id: str
    eventName: str
    timestamp: str
    severity: str
    sourceIp: str
    destIp: str
    targetApp: str
    status: str        # "Active" | "Contained" | "Closed"
    eventDetails: str


# ─────────────────────────────────────────────────────────────────────────────
# Header / Notification Bell  (/header-data?env=)
# ─────────────────────────────────────────────────────────────────────────────

class RecentAlert(BaseModel):
    id: str
    app: str
    message: str
    severity: str
    timestamp: str   # Human-readable relative: "2m ago"


class Application(BaseModel):
    id: str
    name: str


class User(BaseModel):
    """Used by the HeaderData for the top-right profile dropdown."""
    name: str
    email: str
    avatar: str


class HeaderData(BaseModel):
    user: User
    applications: List[Application]
    recentAlerts: List[RecentAlert]


# ─────────────────────────────────────────────────────────────────────────────
# Users / Settings  (/users?env=)  — returns a LIST directly
# ─────────────────────────────────────────────────────────────────────────────

class TeamUser(BaseModel):
    """Used by the Settings -> User Access page."""
    id: int
    name: str
    email: str
    role: str          # "Admin" | "Analyst"
    avatar: str
    is_active: bool
    invite_pending: bool


# ─────────────────────────────────────────────────────────────────────────────
# Action Response Schemas  (POST endpoints)
# ─────────────────────────────────────────────────────────────────────────────

class QuarantineRequest(BaseModel):
    workstationId: str


class QuarantineResponse(BaseModel):
    success: bool
    message: str


class RemediateRequest(BaseModel):
    incidentId: str
    action: str


class RemediateResponse(BaseModel):
    success: bool
    message: str


class NetworkBlockRequest(BaseModel):
    """Request to apply hard block on a source IP / app (network anomalies table)."""
    sourceIp: str
    app: str


class DbKillQueryRequest(BaseModel):
    """Request to kill a suspicious query (DLP table)."""
    activityId: int
    app: str
    user: str


# ─────────────────────────────────────────────────────────────────────────────
# Velociraptor Webhook Payload  (POST /webhooks/velociraptor)
# ─────────────────────────────────────────────────────────────────────────────

class VelociraptorArtifact(BaseModel):
    """Matches Velociraptor's standard artifact result row schema."""
    artifact_name: str
    client_id: str
    hostname: Optional[str] = None
    fqdn: Optional[str] = None
    os: Optional[str] = None
    timestamp: Optional[str] = None
    data: Dict[str, Any] = {}


class VelociraptorWebhookPayload(BaseModel):
    """
    Outer envelope that Velociraptor sends in webhook notifications.
    See FUTURE_IMPLEMENTATION.md for the full payload specification.
    """
    artifact: str
    client_id: str
    session_id: str
    rows: List[VelociraptorArtifact] = []
    timestamp: str


# ─────────────────────────────────────────────────────────────────────────────
# Containment Rules  (Settings / progressive containment)
# ─────────────────────────────────────────────────────────────────────────────

class ContainmentRule(BaseModel):
    rule_id: str
    name: str
    warn_threshold: int = 1
    soft_limit_threshold: int = 3
    hard_block_threshold: int = 5
    applies_to_apps: List[str] = []
    enabled: bool = True


class ContainmentRuleUpdate(BaseModel):
    warn_threshold: Optional[int] = None
    soft_limit_threshold: Optional[int] = None
    hard_block_threshold: Optional[int] = None
    enabled: Optional[bool] = None


# ─────────────────────────────────────────────────────────────────────────────
# Figma-Specific Endpoints (Option 2 Contract Strategy)
# ─────────────────────────────────────────────────────────────────────────────


class CaseManagementKpis(BaseModel):
    criticalOpenCases: int
    mttr: str
    unassignedEscalations: int


class CaseManagementCase(BaseModel):
    caseId: str
    scopeTags: List[str]
    aiThreatNarrative: str
    assigneeName: str
    assigneeInitials: str
    status: str
    playbookActions: List[str]
    targetApp: str


class CaseManagementResponse(BaseModel):
    kpis: CaseManagementKpis
    cases: List[CaseManagementCase]


class AppConfigResponse(BaseModel):
    env: str
    appId: str
    warningAnomalyScore: int
    criticalAnomalyScore: int
    softRateLimitCallsPerMin: int
    hardBlockThresholdCallsPerMin: int
    autoQuarantineLaptops: bool
    trainingWindowDays: int
    modelSensitivityPct: int
    autoUpdateBaselinesWeekly: bool
    baselineModelName: str
    baselineLastUpdatedAt: str


class AppConfigUpdateRequest(BaseModel):
    warningAnomalyScore: Optional[int] = None
    criticalAnomalyScore: Optional[int] = None
    softRateLimitCallsPerMin: Optional[int] = None
    hardBlockThresholdCallsPerMin: Optional[int] = None
    autoQuarantineLaptops: Optional[bool] = None
    trainingWindowDays: Optional[int] = None
    modelSensitivityPct: Optional[int] = None
    autoUpdateBaselinesWeekly: Optional[bool] = None
    baselineModelName: Optional[str] = None


class QuarantinedEndpointRow(BaseModel):
    workstationId: str
    user: str
    timeQuarantined: str
    action: str


class QuarantinedEndpointsResponse(BaseModel):
    autoQuarantineLaptops: bool
    quarantined: List[QuarantinedEndpointRow]


class LiftQuarantineRequest(BaseModel):
    appId: str
    workstationId: str


class LiftQuarantineResponse(BaseModel):
    success: bool
    message: str


class ScheduledReportRow(BaseModel):
    id: int
    title: str
    description: str
    schedule: str
    active: bool
    configureLabel: str


class RecentDownloadRow(BaseModel):
    id: int
    fileName: str
    targetAppScope: str
    generated: str
    size: str
    downloadUrl: str


class ReportsOverviewResponse(BaseModel):
    scheduledReports: List[ScheduledReportRow]
    recentDownloads: List[RecentDownloadRow]


class GenerateReportRequest(BaseModel):
    dateRange: str
    dataSource: str
    template: str
    exportFormat: str


class GenerateReportResponse(BaseModel):
    success: bool
    message: str
    download: Optional[RecentDownloadRow] = None


# ─────────────────────────────────────────────────────────────────────────────
# Figma Widget Contracts (Pixel-Perfect Screenshots)
# ─────────────────────────────────────────────────────────────────────────────

class FigmaDashboardAppHealth(BaseModel):
    targetApp: str
    currentLoadLabel: str   # e.g. "450 req/m"
    status: str             # "healthy" | "warning" | "critical"
    actionLabel: str        # e.g. "Apply Hard Limit"


class FigmaDashboardResponse(BaseModel):
    aiBriefing: str
    appHealth: List[FigmaDashboardAppHealth]


class FigmaApiOveruseByApp(BaseModel):
    targetApp: str
    currentRpm: int
    limitRpm: int


class FigmaAbusedEndpointRow(BaseModel):
    endpoint: str                 # e.g. "[GenAI] /v1/chat/completions"
    violations: int
    severity: str                 # "critical" | "high" | "medium"


class FigmaTopConsumerRow(BaseModel):
    consumer: str
    targetApp: str                # bracketed like "[GenAI Service]"
    callsLabel: str               # e.g. "125K"
    costLabel: str                # e.g. "$3,250"
    isOveruse: bool
    actionLabel: str
    actionType: str               # "warning" | "critical" | "neutral"


class FigmaApiMitigationFeedRow(BaseModel):
    target: str
    offender: str                 # MUST include "External IP (Public): " when external IP
    violation: str
    details: str
    actionLabel: str
    actionColor: str              # "red" | "blue"


class FigmaApiMonitoringResponse(BaseModel):
    totalApiCallsLabel: str
    blockedThreatsLabel: str
    globalAvailabilityLabel: str
    activeIncidentsLabel: str
    apiOveruseByTargetApp: List[FigmaApiOveruseByApp]
    mostAbusedEndpoints: List[FigmaAbusedEndpointRow]
    topConsumersByTargetApp: List[FigmaTopConsumerRow]
    activeMitigationFeed: List[FigmaApiMitigationFeedRow]


class FigmaNetworkAnomalyRow(BaseModel):
    timestamp: str
    source: str                   # endpoint/user or "External IP (Public): x.x.x.x"
    targetApp: str
    port: str
    anomalyType: str
    firewallBlockActive: bool = False
    controls: List[Dict[str, str]]  # [{ label, type }]


class FigmaNetworkTrafficResponse(BaseModel):
    activeAnomalies: List[FigmaNetworkAnomalyRow]


class FigmaEndpointVulnerableRow(BaseModel):
    workstationId: str
    cves: int
    riskLevel: str                # "Critical" | "High" | "Medium" | "Low"


class FigmaEndpointPolicyViolatorRow(BaseModel):
    user: str
    violations: int


class FigmaEndpointEventAction(BaseModel):
    label: str
    actionType: str               # "Kill Process" | "Quarantine Device" | "Lock USB Ports" | etc.


class FigmaEndpointEventRow(BaseModel):
    id: str
    endpoint: str
    user: str
    threat: str
    severity: str                 # "critical" | "high" | "warning"
    timestamp: str
    actions: List[FigmaEndpointEventAction]


class FigmaEndpointSecurityResponse(BaseModel):
    vulnerableEndpoints: List[FigmaEndpointVulnerableRow]
    policyViolators: List[FigmaEndpointPolicyViolatorRow]
    endpointEvents: List[FigmaEndpointEventRow]


class FigmaDbExfiltrationRow(BaseModel):
    targetDb: str
    volumeGb: float
    color: str


class FigmaDbSuspiciousSourceRow(BaseModel):
    name: str
    queries: int


class FigmaDbSuspiciousActivityRow(BaseModel):
    id: int
    timestamp: str
    actor: str
    targetDb: str
    targetTable: str
    risk: str


class FigmaDatabaseMonitoringResponse(BaseModel):
    dataExfiltrationRiskByDatabase: List[FigmaDbExfiltrationRow]
    topSuspiciousQuerySources: List[FigmaDbSuspiciousSourceRow]
    suspiciousDbActivity: List[FigmaDbSuspiciousActivityRow]
