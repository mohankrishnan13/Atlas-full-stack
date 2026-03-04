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
  name:string;
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

// Overview Page
export type AppAnomaly = {
  name: string;
  anomalies: number;
};

export type Microservice = {
    id: string;
    name: string;
    status: 'Healthy' | 'Failing';
    position: { top: string; left: string; };
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

export type OverviewData = {
    apiRequests: number;
    errorRate: number;
    activeAlerts: number;
    costRisk: number;
    appAnomalies: AppAnomaly[];
    microservices: Microservice[];
    failingEndpoints: Record<string, string>;
    apiRequestsChart: TimeSeriesData[];
    systemAnomalies: SystemAnomaly[];
};


// API Monitoring Page
export type ApiRoute = {
    id: number;
    app: string;
    path: string;
    method: string;
    cost: number;
    trend: number;
    action: string;
};

export type ApiMonitoringData = {
    apiCallsToday: number;
    blockedRequests: number;
    avgLatency: number;
    estimatedCost: number;
    apiUsageChart: TimeSeriesData[];
    apiRouting: ApiRoute[];
};

// Network Traffic Page
export type NetworkAnomaly = {
    id: number;
    sourceIp: string;
    destIp: string;
    app: string;
    port: number;
    type: string;
};

export type NetworkTrafficData = {
    bandwidth: number;
    activeConnections: number;
    droppedPackets: number;
    networkAnomalies: NetworkAnomaly[];
};

// Endpoint Security Page
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
    id: number;
    workstationId: string;
    employee: string;
    avatar: string;
    alert: string;
    severity: Severity;
};

export type EndpointSecurityData = {
    monitoredLaptops: number;
    offlineDevices: number;
    malwareAlerts: number;
    osDistribution: OsDistribution[];
    alertTypes: AlertTypeDistribution[];
    wazuhEvents: WazuhEvent[];
};

// DB Monitoring Page
export type SuspiciousActivity = {
    id: number;
    app: string;
    user: string;
    type: string;
    table: string;
    reason: string;
};

export type DbMonitoringData = {
    activeConnections: number;
    avgQueryLatency: number;
    dataExportVolume: number;
    operationsChart: TimeSeriesData[];
    suspiciousActivity: SuspiciousActivity[];
};

// Incidents Page
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

// Settings Page
export type TeamUser = {
  id: number;
  name: string;
  email: string;
  role: "Admin" | "Analyst";
  avatar: string;
};
