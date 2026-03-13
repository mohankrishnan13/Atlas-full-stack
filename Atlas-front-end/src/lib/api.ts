'use client';

import {
  mockOverviewData,
  mockApiMonitoringData,
  mockNetworkTrafficData,
  mockEndpointSecurityData,
  mockDbMonitoringData,
  mockCaseManagementData,
  mockUsersData,
  mockReportsData
} from './mock-data';

// ── NEW: Environment State Manager (kept for UI compatibility) ──
export type AtlasEnv = 'cloud' | 'local';

export const getActiveEnv = (): AtlasEnv =>
  typeof window !== 'undefined'
    ? ((localStorage.getItem('atlas_active_env') as AtlasEnv | null) || 'cloud')
    : 'cloud';

export const setActiveEnv = (env: AtlasEnv) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('atlas_active_env', env);
  }
};

// Thrown by typed helpers on non-OK responses (kept for type compatibility).
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const SIMULATED_DELAY_MS = 400;

// ── MOCKED Typed Wrapper Methods ──

export async function apiGet<T>(endpoint: string): Promise<T> {
  console.log(`[MOCK API GET] Intercepted request for: ${endpoint}`);
  
  // Simulate network latency
  await new Promise(res => setTimeout(res, 400));

  // Note: Using broad .includes() checks to catch both standard and figma naming conventions
  if (endpoint.includes('/overview') || endpoint.includes('/dashboard')) {
    return Promise.resolve(mockOverviewData as T);
  }
  if (endpoint.includes('/api-monitoring')) {
    return Promise.resolve(mockApiMonitoringData as T);
  }
  if (endpoint.includes('/network-traffic')) {
    return Promise.resolve(mockNetworkTrafficData as T);
  }
  if (endpoint.includes('/endpoint-security')) {
    return Promise.resolve(mockEndpointSecurityData as T);
  }
  // FIX: Frontend calls /db-monitoring, not /database-monitoring
  if (endpoint.includes('/db-monitoring') || endpoint.includes('/database-monitoring')) {
    return Promise.resolve(mockDbMonitoringData as T);
  }
  // FIX: Case Management URL is /incidents
  if (endpoint.includes('/case-management') || endpoint.includes('/incidents')) {
    return Promise.resolve(mockCaseManagementData as T);
  }
  // FIX: Settings User load
  if (endpoint.includes('/auth/users') || endpoint.includes('/users') || endpoint.includes('/team')) {
    return Promise.resolve(mockUsersData as T);
  }
  // FIX: Reports load
  if (endpoint.includes('/reports')) {
    return Promise.resolve(mockReportsData as T);
  }

  // Fallback for any unhandled endpoint
  console.warn(`[MOCK API GET] No mock data found for endpoint: ${endpoint}`);
  return Promise.reject(new ApiError(404, `No mock data for ${endpoint}`));
}

export async function apiPost<T = { success: boolean }>(endpoint: string, body?: unknown): Promise<T> {
  console.log(`[MOCK API POST] Intercepted action for: ${endpoint}`, { body });

  // Simulate network latency
  await new Promise(res => setTimeout(res, SIMULATED_DELAY_MS));

  // For all POST actions, simulate a successful response
  return Promise.resolve({ success: true } as T);
}

// Mock other methods to prevent errors, returning a simple success response.
export async function apiPut<T = { success: boolean }>(endpoint: string, body?: unknown): Promise<T> {
  console.log(`[MOCK API PUT] Intercepted action for: ${endpoint}`, { body });
  await new Promise(res => setTimeout(res, SIMULATED_DELAY_MS));
  return Promise.resolve({ success: true } as T);
}

export async function apiPatch<T = { success: boolean }>(endpoint: string, body?: unknown): Promise<T> {
  console.log(`[MOCK API PATCH] Intercepted action for: ${endpoint}`, { body });
  await new Promise(res => setTimeout(res, SIMULATED_DELAY_MS));
  return Promise.resolve({ success: true } as T);
}

export async function apiDelete<T = { success: boolean }>(endpoint: string): Promise<T> {
  console.log(`[MOCK API DELETE] Intercepted action for: ${endpoint}`);
  await new Promise(res => setTimeout(res, SIMULATED_DELAY_MS));
  return Promise.resolve({ success: true } as T);
}

// ── Utility (kept for UI compatibility) ──
export const logout = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('atlas_auth_token');
    window.location.href = '/login';
  }
};
