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


class OverviewData(BaseModel):
    apiRequests: int
    errorRate: float
    activeAlerts: int
    costRisk: int
    appAnomalies: List[AppAnomaly]
    microservices: List[Microservice]
    failingEndpoints: Dict[str, str]
    apiRequestsChart: List[Dict[str, Any]]   # [{ name: "12am", requests: 2000 }]
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


class ApiMonitoringData(BaseModel):
    apiCallsToday: int
    blockedRequests: int
    avgLatency: float
    estimatedCost: float
    apiUsageChart: List[Dict[str, Any]]   # [{ name, actual, predicted }]
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


class DbMonitoringData(BaseModel):
    activeConnections: int
    avgQueryLatency: float
    dataExportVolume: float
    operationsChart: List[Dict[str, Any]]   # [{ name, SELECT, INSERT, UPDATE, DELETE }]
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
    id: int
    name: str
    email: str
    role: str          # "Admin" | "Analyst"
    avatar: str


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
