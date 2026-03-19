'use client';

/**
 * src/lib/api.ts — ATLAS Centralized API Client
 *
 * - Auto-attaches JWT Bearer token from localStorage
 * - Auto-injects active environment (cloud vs local) as query param
 * - Global 401 handler: clears token and redirects to /login
 * - Typed helpers accept an optional AbortSignal for cancellation
 *
 * Zero mock data. All functions hit the real ATLAS backend.
 */

const getBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_ATLAS_BACKEND_URL || 'http://localhost:8000';

const getToken = (): string | null =>
  typeof window !== 'undefined' ? localStorage.getItem('atlas_auth_token') : null;

// ── Environment State Manager ────────────────────────────────────────────────
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
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let finalEndpoint = endpoint;
  if (!finalEndpoint.includes('env=') && !finalEndpoint.includes('/auth/login')) {
    const env = getActiveEnv();
    finalEndpoint += finalEndpoint.includes('?') ? `&env=${env}` : `?env=${env}`;
  }

  const response = await fetch(`${getBaseUrl()}${finalEndpoint}`, { ...options, headers });

  if (response.status === 401 && typeof window !== 'undefined') {
    console.warn('[ATLAS] Session expired — redirecting to login.');
    localStorage.removeItem('atlas_auth_token');
    window.location.href = '/login';
    return new Promise(() => {});
  }

  return response;
};

/** Thrown by typed helpers on non-2xx responses. */
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

/** GET — pass optional AbortSignal to cancel in-flight requests. */
export async function apiGet<T>(endpoint: string, signal?: AbortSignal): Promise<T> {
  const res = await apiFetch(endpoint, { signal });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPost<T = unknown>(endpoint: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await apiFetch(endpoint, {
    method: 'POST',
    body: isFormData ? (body as FormData) : JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPut<T = unknown>(endpoint: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await apiFetch(endpoint, {
    method: 'PUT',
    body: isFormData ? (body as FormData) : JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPatch<T = unknown>(endpoint: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await apiFetch(endpoint, {
    method: 'PATCH',
    body: isFormData ? (body as FormData) : JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiDelete<T = unknown>(endpoint: string, signal?: AbortSignal): Promise<T> {
  const res = await apiFetch(endpoint, { method: 'DELETE', signal });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export const logout = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('atlas_auth_token');
    window.location.href = '/login';
  }
};
