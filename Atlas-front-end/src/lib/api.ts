'use client';

/**
 * src/lib/api.ts — ATLAS Centralized API Client
 *
 * Features:
 *  - Auto-attaches JWT Bearer token from localStorage
 *  - Global 401 handler: clears token and redirects to /login
 *  - Typed helpers: apiGet, apiPost, apiPut, apiPatch, apiDelete
 *    that throw ApiError on non-OK responses
 *  - apiFetch — raw Response escape hatch (backward compat)
 */

const getBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_ATLAS_BACKEND_URL || 'http://localhost:8000';

const getToken = (): string | null =>
  typeof window !== 'undefined' ? localStorage.getItem('atlas_auth_token') : null;

/** Low-level fetch. Returns raw Response. Handles 401 globally. */
export const apiFetch = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  });

  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${getBaseUrl()}${endpoint}`, { ...options, headers });

  if (response.status === 401 && typeof window !== 'undefined') {
    console.warn('[ATLAS] Session expired — redirecting to login.');
    localStorage.removeItem('atlas_auth_token');
    window.location.href = '/login';
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

export async function apiGet<T>(endpoint: string): Promise<T> {
  const res = await apiFetch(endpoint);
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPost<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
  const res = await apiFetch(endpoint, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPut<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
  const res = await apiFetch(endpoint, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiPatch<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
  const res = await apiFetch(endpoint, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}

export async function apiDelete<T = unknown>(endpoint: string): Promise<T> {
  const res = await apiFetch(endpoint, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res.json();
}
