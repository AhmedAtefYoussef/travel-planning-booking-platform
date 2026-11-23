import { ApiError, isApiError, networkError, toApiError } from './errors';
import { type Query, withQuery } from './url';

/**
 * Browser API client (Client Components). Calls go same-origin to /api, which next.config.ts
 * rewrites to the NestJS API, and always send cookies (`credentials: 'include'`). Tokens live only
 * in httpOnly cookies, so nothing here can read or store them (ACC-19).
 *
 * - An expired access token (401) triggers one shared POST /api/auth/refresh, then the request is
 *   replayed once. Parallel 401s wait for the same refresh (single flight).
 * - If the session cannot be refreshed the user is sent to /login?next=<current page>, unless the
 *   caller passes `auth: 'silent'` (e.g. checking whether a guest is signed in).
 * - 403 PASSWORD_CHANGE_REQUIRED sends the user to /account/change-password (ACC-07a, ACC-13).
 */
export const API_BASE = '/api';

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialised unless it is FormData (uploads, GEN-08). */
  body?: unknown;
  query?: Query;
  /** 'redirect' (default) sends unauthenticated users to the login page; 'silent' just throws. */
  auth?: 'redirect' | 'silent';
}

type Navigate = (url: string) => void;
let navigate: Navigate = (url) => window.location.assign(url);

/** Test hook: replace the navigation side effect. */
export function setNavigate(fn: Navigate): void {
  navigate = fn;
}

const AUTH_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/register',
];
const isAuthPath = (path: string) => AUTH_PATHS.some((p) => path.startsWith(p));

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rotates the session cookies. Resolves true when the session is usable again: 200, or 409
 * REFRESH_SUPERSEDED (another tab refreshed a moment ago, so its new cookies are already set).
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) return true;
      if (res.status === 409) {
        const error = await toApiError(res);
        return error.code === 'REFRESH_SUPERSEDED';
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function currentLocation(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

async function send(
  path: string,
  options: ApiRequestOptions,
): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `auth` is ours, not fetch's
  const { body, query, auth, headers, ...init } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  if (body !== undefined && !isForm) {
    finalHeaders.set('Content-Type', 'application/json');
  }
  let payload: BodyInit | undefined;
  if (body !== undefined)
    payload = isForm ? (body as FormData) : JSON.stringify(body);
  try {
    return await fetch(`${API_BASE}${withQuery(path, query)}`, {
      ...init,
      headers: finalHeaders,
      credentials: 'include',
      body: payload,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    throw networkError();
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return (await response.json()) as T;
  return (await response.text()) as T;
}

function handleAuthFailure(error: ApiError, options: ApiRequestOptions): void {
  if (options.auth === 'silent') return;
  if (error.status === 401) {
    navigate(`/login?next=${encodeURIComponent(currentLocation())}`);
  } else if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
    navigate('/account/change-password');
  }
}

/** Typed JSON request against the API. Throws ApiError on any non-2xx response. */
export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && !isAuthPath(path)) {
    if (await refreshSession()) response = await send(path, options);
  }

  if (!response.ok) {
    const error = await toApiError(response);
    if (!isAuthPath(path)) handleAuthFailure(error, options);
    throw error;
  }
  return parse<T>(response);
}

type NoBody = Omit<ApiRequestOptions, 'method' | 'body'>;

/** Shorthands so call sites read like the API docs. */
export const api = {
  get: <T>(path: string, options?: NoBody) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: NoBody) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: NoBody) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: NoBody) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: NoBody) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};

export { ApiError, isApiError };
