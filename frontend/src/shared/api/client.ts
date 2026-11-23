import createClient, { type Middleware } from 'openapi-fetch';
import { networkError, toApiError } from './errors';
import { refreshSession } from './refresh';
import type { paths } from './types';

/** Auth endpoints never trigger a refresh-and-retry (it would loop or hide a real failure). */
const NO_RETRY = /\/api\/auth\/(login|refresh|logout|register)$/;

/**
 * On 401, refresh the session once (single-flight) and replay the request. The request is cloned
 * before it is sent because a body can only be read once.
 */
export function refreshOn401(fetchImpl: typeof fetch = fetch): Middleware {
  const pending = new WeakMap<Request, Request>();
  return {
    onRequest({ request }) {
      if (!NO_RETRY.test(new URL(request.url, 'http://x').pathname)) {
        pending.set(request, request.clone());
      }
      return request;
    },
    async onResponse({ request, response }) {
      const replay = pending.get(request);
      pending.delete(request);
      if (response.status !== 401 || !replay) return response;
      return (await refreshSession(fetchImpl)) ? fetchImpl(replay) : response;
    },
  };
}

/**
 * Browser API client. Same-origin `/api/*` (rewritten to the NestJS API by next.config.ts), cookies
 * always included, no token handling anywhere (ACC-19). Typed against the OpenAPI document.
 */
export const api = createClient<paths>({ baseUrl: '', credentials: 'include' });
api.use(refreshOn401());

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/**
 * Turns an openapi-fetch result into the data or a thrown ApiError, so callers can use try/catch
 * (or react-hook-form's error handling) instead of checking two fields.
 */
export async function unwrap<T>(call: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await call;
  } catch {
    throw networkError();
  }
  if (result.response.ok) return result.data as T;
  throw toApiError(result.response, result.error);
}
