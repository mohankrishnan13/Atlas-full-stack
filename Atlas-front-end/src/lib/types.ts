import type { LucideIcon } from "lucide-react";

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Healthy';

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export type Application = {
  id: string;
  name: string;
};

export type User = {
  name: string;
  email: string;
  avatar: string;
};

export type RecentAlert = {
  id: string;
  app: string;
  message: string;
  severity: Severity;
  timestamp: string;
};

// ─── Overview Page ────────────────────────────────────────────────────────────

export type AppAnomaly = {
  name: string;
  anomalies: number;
};

export type Microservice = {
  id: string;
  name: string;
  status: 'Healthy' | 'Failing';
  position: { top: string | number; left: string | number };
  connections: string[];
};

export type TimeSeriesData = {
  name: string;
  [key: string]: number | string;
};

export type SystemAnomaly = {
  id: string;
  service: string;
  type: string;
  severity: Severity;
  timestamp: string;
};

export type ApiRequestsByApp = {
  app: string;
  requests: number;
};

export type OverviewData = {
  apiRequests: number;
  errorRate: number;
  activeAlerts: number;
  costRisk: number;
  appAnomalies: AppAnomaly[];
  microservices: Microservice[];
  failingEndpoints?: Record<string, string>;
  apiRequestsByApp: ApiRequestsByApp[];
  systemAnomalies: SystemAnomaly[];
};

// ─── API Monitoring Page ──────────────────────────────────────────────────────

export type ApiRoute = {
  id: number;
  app: string;
  path: string;
  method: string;
  cost: number;
  trend: number;
  action: string;
};

export type ApiBlockRouteRequest = {
  app: string;
  path: string;
};

export type ApiConsumptionByApp = {
  app: string;
  actual: number;
  limit: number;
};

export type ApiMonitoringData = {
  apiCallsToday: number;
  blockedRequests: number;
  avgLatency: number;
  estimatedCost: number;
  apiConsumptionByApp: ApiConsumptionByApp[];
  apiRouting: ApiRoute[];
};

// ─── Network Traffic Page ─────────────────────────────────────────────────────

export type NetworkAnomaly = {
  id: number;
  sourceIp: string;
  destIp: string;
  app: string;
  port: number;
  type: string;
  severity?: Severity;
};

export type NetworkBlockRequest = {
  sourceIp: string;
  app: string;
};

export type NetworkTrafficData = {
  bandwidth: number;
  activeConnections: number;
  droppedPackets: number;
  networkAnomalies: NetworkAnomaly[];
};

// ─── Endpoint Security Page ───────────────────────────────────────────────────

export type OsDistribution = {
  name: string;
  value: number;
  fill: string;
};

export type AlertTypeDistribution = {
  name: string;
  value: number;
  fill: string;
};

export type WazuhEvent = {
  id: string | number;
  workstationId: string;
  employee: string;
  avatar?: string;
  alert: string;
  severity: Severity | string;
  timestamp?: string;
  // Optional fields from various alert types
  process?: string;
  file_path?: string;
  action_taken?: string;
  rule?: string;
  source_ip?: string;
  device_vendor?: string;
  device_type?: string;
  destination_ip?: string;
  port?: number;
  attempts?: number;
};

export type QuarantineRequest = {
  workstationId: string;
};

export type QuarantineResponse = {
  success: boolean;
  message: string;
};

export type EndpointSecurityData = {
  monitoredLaptops: number;
  offlineDevices: number;
  malwareAlerts: number;
  osDistribution: OsDistribution[];
  alertTypes: AlertTypeDistribution[];
  wazuhEvents: WazuhEvent[];
};

// ─── DB Monitoring Page ───────────────────────────────────────────────────────

export type SuspiciousActivity = {
  id: number;
  app: string;
  user: string;
  type: string;
  table: string;
  reason: string;
};

export type OperationsByApp = {
  app: string;
  SELECT: number;
  INSERT: number;
  UPDATE: number;
  DELETE: number;
};

export type DlpByTargetApp = {
  app: string;
  count: number;
};

export type DbKillQueryRequest = {
  activityId: number;
  app: string;
  user: string;
};

export type DbMonitoringData = {
  activeConnections: number;
  avgQueryLatency: number;
  dataExportVolume: number;
  operationsByApp: OperationsByApp[];
  dlpByTargetApp: DlpByTargetApp[];
  suspiciousActivity: SuspiciousActivity[];
};

// ─── Incidents / Case Management Page ────────────────────────────────────────

export type Incident = {
  id: string;
  eventName: string;
  timestamp: string;
  severity: Severity;
  sourceIp: string;
  destIp: string;
  targetApp: string;
  status: 'Active' | 'Contained' | 'Closed';
  eventDetails: string;
};

export type CaseManagementKpis = {
  criticalOpenCases: number;
  mttr: string;
  unassignedEscalations: number;
};

export type CaseManagementCase = {
  caseId: string;
  id?: string;
  scopeTags: string[];
  aiThreatNarrative: string;
  assigneeName: string;
  assigneeInitials: string;
  status: string;
  playbookActions: string[];
  targetApp: string;
};

export type CaseManagementResponse = {
  kpis: CaseManagementKpis;
  cases: CaseManagementCase[];
};

export type RemediateRequest = {
  incidentId: string;
  action: string;
};

export type RemediateResponse = {
  success: boolean;
  message: string;
};

// ─── Settings Page ────────────────────────────────────────────────────────────

export type TeamUser = {
  id: number;
  name: string;
  email: string;
  role: "Admin" | "Analyst" | "Read-Only";
  avatar?: string;
  is_active?: boolean;
  invite_pending?: boolean;
};

// ─── Header Data ──────────────────────────────────────────────────────────────

export type HeaderData = {
  user: User;
  applications: Application[];
  recentAlerts: RecentAlert[];
};
