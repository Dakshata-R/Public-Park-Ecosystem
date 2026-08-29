/**
 * Typed HTTP client for the GreenPulse API.
 *
 * Every backend handler answers in one envelope —
 *   success: { success: true, data, meta? }
 *   failure: { success: false, error: { message, details? } }
 * — so unwrapping happens once, here, and callers deal in plain data.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:5000/api';

const TOKEN_STORAGE_KEY = 'greenpulse.token';

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiFailure {
  success: false;
  error: { message: string; details?: Record<string, string>; debug?: string };
}

/** A list response, keeping `meta` alongside the rows. */
export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/**
 * Error thrown for any non-2xx response. Carries the HTTP status and the
 * per-field validation detail the server produced, so a form can map errors
 * back onto its inputs.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: Record<string, string>;

  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** True when the failure is an expired or missing session. */
  get isAuthError() {
    return this.status === 401;
  }

  /** True when the caller is signed in but lacks the required role. */
  get isForbidden() {
    return this.status === 403;
  }
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

/**
 * The JWT lives in localStorage rather than an httpOnly cookie. That is the
 * right trade-off here — the API is a separate origin and this is a prototype
 * without a CSRF story — but it is worth being explicit that a production
 * deployment should move to httpOnly cookies with SameSite=Lax.
 */
export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null; // private browsing, storage disabled
    }
  },

  set(token: string) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      /* ignore */
    }
  },

  clear() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined;

/** Build a query string, dropping empty and `all` values. */
export function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the Authorization header even when a token exists. */
  anonymous?: boolean;
}

/**
 * Perform a request and return the unwrapped `data`.
 * @throws {ApiError} on any non-2xx response or transport failure
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, anonymous, headers, ...init } = options;

  const finalHeaders = new Headers(headers);
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');

  if (!anonymous) {
    const token = tokenStore.get();
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // A network-level failure is by far the most common problem in
    // development, so say what to check rather than surfacing "Failed to fetch".
    throw new ApiError(
      0,
      `Cannot reach the API at ${API_BASE_URL}. Is the backend running? (cd server && npm run dev)`
    );
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiError(response.status, await response.text());
    return (await response.text()) as unknown as T;
  }

  const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;

  if (!response.ok || payload.success === false) {
    const failure = payload as ApiFailure;
    const message = failure.error?.message || `Request failed with status ${response.status}`;

    // An expired token should not leave the app in a half-signed-in state.
    if (response.status === 401 && tokenStore.get()) tokenStore.clear();

    throw new ApiError(response.status, message, failure.error?.details);
  }

  return (payload as ApiSuccess<T>).data;
}

/** Like `request`, but keeps the pagination metadata. */
export async function requestList<T>(
  path: string,
  options: RequestOptions = {}
): Promise<Paginated<T>> {
  const { body, anonymous, headers, ...init } = options;

  const finalHeaders = new Headers(headers);
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');
  if (!anonymous) {
    const token = tokenStore.get();
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      `Cannot reach the API at ${API_BASE_URL}. Is the backend running? (cd server && npm run dev)`
    );
  }

  const payload = (await response.json()) as ApiSuccess<T[]> | ApiFailure;

  if (!response.ok || payload.success === false) {
    const failure = payload as ApiFailure;
    if (response.status === 401 && tokenStore.get()) tokenStore.clear();
    throw new ApiError(
      response.status,
      failure.error?.message || `Request failed with status ${response.status}`,
      failure.error?.details
    );
  }

  const success = payload as ApiSuccess<T[]>;
  return {
    items: success.data ?? [],
    meta:
      success.meta ??
      {
        total: success.data?.length ?? 0,
        page: 1,
        limit: success.data?.length ?? 0,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
  };
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  list: <T>(path: string, options?: RequestOptions) => requestList<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

/** Absolute URL for a download the browser should follow directly. */
export function downloadUrl(path: string, params?: Record<string, QueryValue>) {
  return `${API_BASE_URL}${path}${buildQuery(params)}`;
}
