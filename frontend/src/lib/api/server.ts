import 'server-only';

import { cookies, headers } from 'next/headers';

import { ApiError, networkError, toApiError } from './errors';
import { type Query, withQuery } from './url';

/**
 * Server-side API access for Server Components, layouts and route handlers.
 *
 * - `serverFetch` forwards the visitor's cookies, so it runs as that user. It never caches: use it
 *   for dynamic SSR pages (bookings, dashboards, searches; brief section 9).
 * - `publicFetch` sends no cookies and accepts a `revalidate` time: use it for public pages that are
 *   statically rendered with ISR (published posts, author pages, public itineraries).
 */
const API_ORIGIN = process.env.BACKEND_ORIGIN ?? 'http://localhost:3000';
export const SERVER_API_BASE = `${API_ORIGIN}/api`;

export interface ServerRequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
}

async function request<T>(
  path: string,
  init: RequestInit,
  query?: Query,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_API_BASE}${withQuery(path, query)}`, init);
  } catch {
    throw networkError();
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function baseHeaders(options: ServerRequestOptions): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(options.body !== undefined
      ? { 'Content-Type': 'application/json' }
      : {}),
  };
}

function encodeBody(options: ServerRequestOptions): string | undefined {
  return options.body === undefined ? undefined : JSON.stringify(options.body);
}

/** Request as the signed-in visitor (cookies forwarded), never cached. */
export async function serverFetch<T>(
  path: string,
  options: ServerRequestOptions = {},
): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const forwardedFor = (await headers()).get('x-forwarded-for');
  return request<T>(
    path,
    {
      method: options.method ?? 'GET',
      headers: {
        ...baseHeaders(options),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        // Lets the API rate-limit the real client, not this server (ADR-0007, TRUST_PROXY).
        ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
      },
      body: encodeBody(options),
      cache: 'no-store',
    },
    options.query,
  );
}

/** Anonymous request for public data; cached and revalidated every `revalidate` seconds (ISR). */
export async function publicFetch<T>(
  path: string,
  options: ServerRequestOptions & {
    revalidate?: number | false;
    tags?: string[];
  } = {},
): Promise<T> {
  return request<T>(
    path,
    {
      method: options.method ?? 'GET',
      headers: baseHeaders(options),
      body: encodeBody(options),
      next: { revalidate: options.revalidate ?? 60, tags: options.tags },
    },
    options.query,
  );
}

export { ApiError };
