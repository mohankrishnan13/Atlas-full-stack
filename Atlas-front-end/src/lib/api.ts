'use client';

/**
 * src/lib/api.ts — ATLAS Centralized API Client
 *
 * Features:
 * - Auto-attaches JWT Bearer token from localStorage
 * - Auto-injects the active environment (cloud vs local) into query params
 * - Global 401 handler: clears token and redirects to /login
 * - Safely handles FormData (file uploads) without breaking boundaries
 * - Typed helpers: apiGet, apiPost, apiPut, apiPatch, apiDelete
 */

const getBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_ATLAS_BACKEND_URL || 'http://localhost:8000';

const getToken = (): string | null =>
  typeof window !== 'undefined' ? localStorage.getItem('atlas_auth_token') : null;

// ── NEW: Environment State Manager ──
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

/** Low-level fetch. Returns raw Response. Handles 401 globally. */
export const apiFetch = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  
  // 1. Setup Headers dynamically (Fix for FormData file uploads)
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // 2. Attach JWT
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  // 3. Auto-Inject the Environment Query Parameter
  // We skip this for auth login routes since they don't need the env query param
  let finalEndpoint = endpoint;
  if (!finalEndpoint.includes('env=') && !finalEndpoint.includes('/auth/login')) {
    const env = getActiveEnv();
    finalEndpoint += finalEndpoint.includes('?') ? `&env=${env}` : `?env=${env}`;
  }

  // 4. Execute the Network Request
  const response = await fetch(`${getBaseUrl()}${finalEndpoint}`, { ...options, headers });

  // 5. Global 401 Unauthorized Interceptor
  if (response.status === 401 && typeof window !== 'undefined') {
    console.warn('[ATLAS] Session expired or unauthorized — redirecting to login.');
    localStorage.removeItem('atlas_auth_token');
    window.location.href = '/login';
    // Return a dangling promise to stop React execution while the browser redirects
    return new Promise(() => {}); 
  }

  return response;
};

/** Thrown by typed helpers on non-OK responses. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.detail || body.message || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

// ── Typed Wrapper Methods ──

export async function apiGet<T>(endpoint: string): Promise<T> {
  const res = await apiFetch(endpoint);
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPost<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await apiFetch(endpoint, {
    method: 'POST',
    body: isFormData ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPut<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await apiFetch(endpoint, {
    method: 'PUT',
    body: isFormData ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPatch<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await apiFetch(endpoint, {
    method: 'PATCH',
    body: isFormData ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiDelete<T = unknown>(endpoint: string): Promise<T> {
  const res = await apiFetch(endpoint, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

// ── Utility ──
export const logout = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('atlas_auth_token');
    window.location.href = '/login';
  }
};