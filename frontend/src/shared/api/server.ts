import 'server-only';
import { cookies } from 'next/headers';
import createClient from 'openapi-fetch';
import { readServerEnv } from '@/shared/config/env';
import type { paths } from './types';

/**
 * API client for Server Components and Route Handlers. It calls the NestJS API directly (not through
 * the rewrite) and forwards the visitor's cookies so the API authorises the request as that user.
 * Responses are never cached: they are private to the visitor (Cache Components: dynamic by default).
 * Reading cookies makes the caller dynamic, so render it inside a <Suspense> boundary.
 */
export async function serverApi() {
  const cookieHeader = (await cookies()).toString();
  return createClient<paths>({
    baseUrl: readServerEnv().BACKEND_URL,
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
  });
}
