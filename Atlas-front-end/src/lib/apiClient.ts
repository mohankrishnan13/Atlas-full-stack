/**
 * src/lib/apiClient.ts — ATLAS Centralized API Client
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  MOCK BYPASS MODE                                               │
 * │  All GET functions currently return Promise.resolve(mockData).  │
 * │  To switch to real API calls:                                   │
 * │   1. Delete the "MOCK BYPASS" return line in each function.     │
 * │   2. Uncomment the "REAL FETCH" block below it.                 │
 * │   3. Set NEXT_PUBLIC_ATLAS_BACKEND_URL in your .env.local       │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { apiFetch, ApiError, getActiveEnv } from '@/lib/api';
import {
  mockOverviewData,
  mockEndpointSecurityData,
  mockNetworkTrafficData,
  mockApiMonitoringData,
  mockDbMonitoringData,
  mockCaseManagementData,
  mockHeaderData,
  mockUsersData,
} from '@/lib/mockData';

import type {
  OverviewData,
  EndpointSecurityData,
  NetworkTrafficData,
  ApiMonitoringData,
  DbMonitoringData,
  CaseManagementResponse,
  HeaderData,
  TeamUser,
  NetworkBlockRequest,
  QuarantineRequest,
  QuarantineResponse,
  RemediateRequest,
  RemediateResponse,
  ApiBlockRouteRequest,
} from '@/lib/types';

// ─── Helper (used by real-fetch blocks) ──────────────────────────────────────

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.detail || body.message || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

// ─── READ: Dashboard Data ─────────────────────────────────────────────────────

/**
 * GET /header-data
 * Returns the top-bar user info, app list, and recent alerts.
 */
export async function getHeaderData(): Promise<HeaderData> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  return Promise.resolve({
    user: { name: 'Sarah Smith', email: 'sarah@atlas.local', avatar: '' },
    applications: mockHeaderData.applications,
    recentAlerts: [],
  } as HeaderData);
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const env = getActiveEnv();
  // const res = await apiFetch(`/header-data?env=${env}`);
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * GET /overview
 * Returns KPIs, microservice health, and anomaly summaries.
 */
export async function getOverview(): Promise<OverviewData> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  return Promise.resolve(mockOverviewData as unknown as OverviewData);
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const env = getActiveEnv();
  // const res = await apiFetch(`/overview?env=${env}`);
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * GET /endpoint-security
 * Returns Wazuh events, OS distribution, alert type counts.
 */
export async function getEndpointSecurity(): Promise<EndpointSecurityData> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  return Promise.resolve(mockEndpointSecurityData as EndpointSecurityData);
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const env = getActiveEnv();
  // const res = await apiFetch(`/endpoint-security?env=${env}`);
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * GET /network-traffic
 * Returns bandwidth, active connections, dropped packets, and anomalies.
 */
export async function getNetworkTraffic(): Promise<NetworkTrafficData> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  return Promise.resolve(mockNetworkTrafficData as NetworkTrafficData);
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const env = getActiveEnv();
  // const res = await apiFetch(`/network-traffic?env=${env}`);
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * GET /api-monitoring
 * Returns API call volumes, latency, cost, and routing rules.
 */
export async function getApiMonitoring(): Promise<ApiMonitoringData> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  return Promise.resolve(mockApiMonitoringData as ApiMonitoringData);
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const env = getActiveEnv();
  // const res = await apiFetch(`/api-monitoring?env=${env}`);
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * GET /database-monitoring
 * Returns DB connection pool, query latency, and suspicious activity.
 */
export async function getDatabaseMonitoring() {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  return Promise.resolve(mockDbMonitoringData);
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const env = getActiveEnv();
  // const res = await apiFetch(`/database-monitoring?env=${env}`);
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * GET /case-management
 * Returns KPIs and the full case board (threats, assignees, playbook actions).
 */
export async function getCaseManagement(): Promise<CaseManagementResponse> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  return Promise.resolve(mockCaseManagementData as CaseManagementResponse);
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const env = getActiveEnv();
  // const res = await apiFetch(`/case-management?env=${env}`);
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * GET /users
 * Returns the full platform user list (used by Settings).
 */
export async function getUsers(): Promise<TeamUser[]> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  return Promise.resolve(mockUsersData as TeamUser[]);
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const res = await apiFetch('/users');
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

// ─── WRITE: Mitigation Actions ────────────────────────────────────────────────

/**
 * POST /network-traffic/block
 * Hard-blocks all traffic from a source IP targeting a specific application.
 */
export async function blockNetworkSource(
  payload: NetworkBlockRequest
): Promise<{ success: boolean; message: string }> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  console.info('[apiClient] blockNetworkSource (mock)', payload);
  return Promise.resolve({ success: true, message: `Mock block applied for ${payload.sourceIp}` });
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const res = await apiFetch('/network-traffic/block', {
  //   method: 'POST',
  //   body: JSON.stringify(payload),
  // });
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * POST /endpoint-security/quarantine
 * Isolates a workstation from the network via the EDR agent.
 */
export async function quarantineDevice(
  payload: QuarantineRequest
): Promise<QuarantineResponse> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  console.info('[apiClient] quarantineDevice (mock)', payload);
  return Promise.resolve({ success: true, message: `Mock quarantine applied to ${payload.workstationId}` });
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const res = await apiFetch('/endpoint-security/quarantine', {
  //   method: 'POST',
  //   body: JSON.stringify(payload),
  // });
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * POST /incidents/remediate
 * Executes a named playbook action against an open case.
 */
export async function remediateIncident(
  payload: RemediateRequest
): Promise<RemediateResponse> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  console.info('[apiClient] remediateIncident (mock)', payload);
  return Promise.resolve({ success: true, message: `Mock remediation: ${payload.action} for ${payload.incidentId}` });
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const res = await apiFetch('/incidents/remediate', {
  //   method: 'POST',
  //   body: JSON.stringify(payload),
  // });
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}

/**
 * POST /api-monitoring/block-route
 * Blocks a specific API route for a given application.
 */
export async function blockApiRoute(
  payload: ApiBlockRouteRequest
): Promise<{ success: boolean; message: string }> {
  // ── MOCK BYPASS ──────────────────────────────────────────────────────────
  console.info('[apiClient] blockApiRoute (mock)', payload);
  return Promise.resolve({ success: true, message: `Mock block applied for ${payload.path}` });
  // ── REAL FETCH (uncomment to use live backend) ───────────────────────────
  // const res = await apiFetch('/api-monitoring/block-route', {
  //   method: 'POST',
  //   body: JSON.stringify(payload),
  // });
  // if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // return res.json();
}
