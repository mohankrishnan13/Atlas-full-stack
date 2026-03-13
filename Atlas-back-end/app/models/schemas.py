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
    name: str
    class Config:
        extra = "allow"

class Application(BaseModel):
    id: str
    name: str

class User(BaseModel):
    name: str
    email: str
    avatar: str

class TeamUser(BaseModel):
    id: int
    name: str
    email: str
    role: str
    avatar: str
    is_active: bool
    invite_pending: bool

class RecentAlert(BaseModel):
    id: str
    app: str
    message: str
    severity: str
    timestamp: str

class HeaderData(BaseModel):
    user: User
    applications: List[Application]
    recentAlerts: List[RecentAlert]

# ─────────────────────────────────────────────────────────────────────────────
# Standard Dashboard Schemas (Legacy / Fallback)
# ─────────────────────────────────────────────────────────────────────────────

class AppAnomaly(BaseModel):
    name: str
    anomalies: int

class Microservice(BaseModel):
    id: str
    name: str
    type: str = "Service"
    status: str
    position: Dict[str, str]
    connections: List[str]

class SystemAnomaly(BaseModel):
    id: str
    service: str
    type: str
    severity: str
    timestamp: str

class ApiRequestsByApp(BaseModel):
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
    apiRequestsByApp: List[ApiRequestsByApp]
    systemAnomalies: List[SystemAnomaly]

class ApiRoute(BaseModel):
    id: int
    app: str
    path: str
    method: str
    cost: float
    trend: int
    action: str

class ApiConsumptionByApp(BaseModel):
    app: str
    actual: int
    limit: int

class ApiMonitoringData(BaseModel):
    apiCallsToday: int
    blockedRequests: int
    avgLatency: float
    estimatedCost: float
    apiConsumptionByApp: List[ApiConsumptionByApp]
    apiRouting: List[ApiRoute]

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

class OsDistribution(BaseModel):
    name: str
    value: int
    fill: str

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

class SuspiciousActivity(BaseModel):
    id: int
    app: str
    user: str
    type: str
    table: str
    reason: str

class OperationsByApp(BaseModel):
    app: str
    SELECT: int = 0
    INSERT: int = 0
    UPDATE: int = 0
    DELETE: int = 0

class DlpByTargetApp(BaseModel):
    app: str
    count: int

class DbMonitoringData(BaseModel):
    activeConnections: int
    avgQueryLatency: float
    dataExportVolume: float
    operationsByApp: List[OperationsByApp]
    dlpByTargetApp: List[DlpByTargetApp]
    suspiciousActivity: List[SuspiciousActivity]

class Incident(BaseModel):
    id: str
    eventName: str
    timestamp: str
    severity: str
    sourceIp: str
    destIp: str
    targetApp: str
    status: str
    eventDetails: str

# ─────────────────────────────────────────────────────────────────────────────
# Figma-Specific Schemas (New Architecture)
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

class FigmaDashboardAppHealth(BaseModel):
    targetApp: str
    currentLoadLabel: str
    status: str
    rateLimitLabel: str
    actionLabel: str
    tooltip: str

class FigmaDashboardResponse(BaseModel):
    aiBriefing: str
    appHealth: List[FigmaDashboardAppHealth]

class FigmaApiOveruseByApp(BaseModel):
    targetApp: str
    currentRpm: int
    limitRpm: int
    baselineRpm: int
    spikeLabel: str

class FigmaAbusedEndpointRow(BaseModel):
    endpoint: str
    violations: int
    severity: str

class FigmaTopConsumerRow(BaseModel):
    consumer: str
    targetApp: str
    callsLabel: str
    costLabel: str
    isOveruse: bool
    actionLabel: str
    actionType: str

class FigmaApiMitigationFeedRow(BaseModel):
    target: str
    offender: str
    violation: str
    details: str
    actionLabel: str
    actionColor: str

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
    source: str
    targetApp: str
    port: str
    anomalyType: str
    firewallBlockActive: bool = False
    controls: List[Dict[str, str]]

class FigmaNetworkTrafficResponse(BaseModel):
    activeAnomalies: List[FigmaNetworkAnomalyRow]

class FigmaEndpointVulnerableRow(BaseModel):
    workstationId: str
    cves: int
    riskLevel: str
    topIssue: str

class FigmaEndpointPolicyViolatorRow(BaseModel):
    user: str
    violations: int
    topViolation: str

class FigmaActiveMalwareRow(BaseModel):
    device: str
    threat: str
    actionLabel: str

class FigmaCriticalPolicyViolationRow(BaseModel):
    device: str
    violation: str
    actionLabel: str

class FigmaHighAnomalyUserRow(BaseModel):
    user: str
    score: int
    reason: str

class FigmaEndpointEventAction(BaseModel):
    label: str
    actionType: str

class FigmaEndpointEventRow(BaseModel):
    id: str
    endpoint: str
    user: str
    threat: str
    severity: str
    timestamp: str
    actions: List[FigmaEndpointEventAction]

class FigmaEndpointSecurityResponse(BaseModel):
    vulnerableEndpoints: List[FigmaEndpointVulnerableRow]
    policyViolators: List[FigmaEndpointPolicyViolatorRow]
    activeMalware: List[FigmaActiveMalwareRow]
    criticalPolicyViolations: List[FigmaCriticalPolicyViolationRow]
    highAnomalyUsers: List[FigmaHighAnomalyUserRow]
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

# ─────────────────────────────────────────────────────────────────────────────
# Action Request Schemas
# ─────────────────────────────────────────────────────────────────────────────
class ApiBlockRouteRequest(BaseModel):
    app: str
    path: str

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
    sourceIp: str
    app: str

class DbKillQueryRequest(BaseModel):
    activityId: int
    app: str
    user: str

class LiftQuarantineRequest(BaseModel):
    appId: str
    workstationId: str

class LiftQuarantineResponse(BaseModel):
    success: bool
    message: str

class GenerateReportRequest(BaseModel):
    dateRange: str
    dataSource: str
    template: str
    exportFormat: str

class GenerateReportResponse(BaseModel):
    success: bool
    message: str
    download: Optional[RecentDownloadRow] = None