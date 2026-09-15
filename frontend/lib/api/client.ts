/**
 * Typed HTTP client for the GreenPulse API.
 *
 * Every backend handler answers in one envelope —
 *   success: { success: true, data, meta? }
 *   failure: { success: false, error: { message, details? } }
 * — so unwrapping happens once, here, and callers deal in plain data.
 */

/**
 * The API base URL is baked in at build time. A deployed build without it
 * would silently call the visitor's own machine, so the localhost fallback is
 * used only in development and a production build without it fails loudly.
 */
function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    // Visible in the browser console and in every error message.
    return '/__NEXT_PUBLIC_API_URL_not_set__';
  }
  return 'http://localhost:5000/api';
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Scheme + host of the API, for resolving root-relative media paths. */
export const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return '';
  }
})();

const TOKEN_STORAGE_KEY = 'greenpulse.token';

/** Requests slower than this are abandoned with a clear error. */
const REQUEST_TIMEOUT_MS = 30_000;

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
 * Error thrown for any failed request. Carries the HTTP status (0 for a
 * transport failure or timeout) and the per-field validation detail the
 * server produced, so a form can map errors back onto its inputs.
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

  /** True when the server is rate limiting this client. */
  get isRateLimited() {
    return this.status === 429;
  }

  /** True when the request never got an HTTP answer (offline, CORS, timeout). */
  get isNetworkError() {
    return this.status === 0;
  }
}

// ---------------------------------------------------------------------------
// Token storage and session expiry
// ---------------------------------------------------------------------------

/**
 * The JWT lives in localStorage rather than an httpOnly cookie. That is the
 * pragmatic choice for a separately hosted API without a CSRF story, but a
 * production deployment should move to httpOnly cookies with SameSite=Lax.
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

/** Fired when the API rejects the stored token; AuthProvider signs the user out. */
export const SESSION_EXPIRED_EVENT = 'greenpulse:session-expired';

function handleUnauthorised(path: string) {
  // A failed sign-in is not an expired session.
  if (path.startsWith('/auth/login') || path.startsWith('/auth/register')) return;
  if (!tokenStore.get()) return;
  tokenStore.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined;

/** Build a query string, dropping empty and `all` (the "no filter" choice in selects). */
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
  /** Override the default timeout (ms). */
  timeoutMs?: number;
}

/** Turn a failed response into a readable message, whatever its body is. */
async function failureFrom(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('content-type') || '';
  let message = '';
  let details: Record<string, string> | undefined;

  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as ApiFailure;
      message = payload.error?.message || '';
      details = payload.error?.details;
    } catch {
      /* malformed JSON — fall through to the status text */
    }
  }

  if (!message) {
    message =
      response.status === 429
        ? 'Too many requests — please wait a moment and try again.'
        : response.status >= 500
        ? `The server had a problem (HTTP ${response.status}). Try again shortly.`
        : `Request failed (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}).`;
  }

  return new ApiError(response.status, message, details);
}

/** The shared fetch: headers, timeout, abort forwarding, transport errors. */
async function send(path: string, options: RequestOptions): Promise<Response> {
  const { body, anonymous, headers, timeoutMs = REQUEST_TIMEOUT_MS, signal, ...init } = options;

  const finalHeaders = new Headers(headers);
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');
  if (!anonymous) {
    const token = tokenStore.get();
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  // React Query cancels superseded requests through `signal`; honour it.
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort);

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // a deliberate cancellation, not a failure
    if (controller.signal.aborted) {
      throw new ApiError(0, `The server did not respond within ${Math.round(timeoutMs / 1000)} seconds. Please try again.`);
    }
    throw new ApiError(
      0,
      process.env.NODE_ENV === 'production'
        ? 'Cannot reach the GreenPulse server. Check your connection and try again.'
        : `Cannot reach the API at ${API_BASE_URL}. Is the backend running? (cd backend && npm run dev)`
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Perform a request and return the unwrapped `data`.
 * @throws {ApiError} on any non-2xx response, timeout or transport failure
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);

  if (!response.ok) {
    if (response.status === 401) handleUnauthorised(path);
    throw await failureFrom(response);
  }
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return (await response.text()) as unknown as T;
  }

  const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (payload.success === false) {
    throw new ApiError(response.status, payload.error?.message || 'Request failed', payload.error?.details);
  }
  return payload.data;
}

/** Like `request`, but keeps the pagination metadata. */
export async function requestList<T>(path: string, options: RequestOptions = {}): Promise<Paginated<T>> {
  const response = await send(path, options);

  if (!response.ok) {
    if (response.status === 401) handleUnauthorised(path);
    throw await failureFrom(response);
  }

  let payload: ApiSuccess<T[]> | ApiFailure;
  try {
    payload = (await response.json()) as ApiSuccess<T[]> | ApiFailure;
  } catch {
    throw new ApiError(response.status, 'The server returned an unreadable response.');
  }
  if (payload.success === false) {
    throw new ApiError(response.status, payload.error?.message || 'Request failed', payload.error?.details);
  }

  const items = payload.data ?? [];
  return {
    items,
    meta: payload.meta ?? {
      total: items.length,
      page: 1,
      limit: items.length,
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

/**
 * Resolve an image or media reference from the API. Root-relative paths
 * (`/api/ai/images/…`) are served by the API host, not the web host; absolute
 * URLs (GBIF photographs) and data URLs pass through unchanged.
 */
export function mediaUrl(src: string | null | undefined): string {
  if (!src) return '';
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  return src.startsWith('/') ? `${API_ORIGIN}${src}` : src;
}

/**
 * Download a file from an authenticated endpoint. A plain link cannot send
 * the bearer token, so the file is fetched and handed to the browser as a blob.
 */
export async function downloadFile(path: string, params: Record<string, QueryValue>, fallbackName: string) {
  const response = await send(`${path}${buildQuery(params)}`, { method: 'GET', timeoutMs: 120_000 });
  if (!response.ok) {
    if (response.status === 401) handleUnauthorised(path);
    throw await failureFrom(response);
  }

  const disposition = response.headers.get('content-disposition') || '';
  const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
