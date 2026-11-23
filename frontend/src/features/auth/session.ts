import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { serverApi } from '@/shared/api/server';
import type { Role, UserProfile } from '@/shared/api/types';
import { canAccess } from './model/roles';

/**
 * The signed-in user for this request, or null (ACC-19: the API's GET /auth/me is the only source).
 * Memoised per request with React `cache`, so layouts and pages can all ask without extra calls.
 */
export const getSession = cache(async (): Promise<UserProfile | null> => {
  const client = await serverApi();
  const { data, response } = await client.GET('/api/auth/me');
  if (response.ok && data) return data;
  if (response.status === 401 || response.status === 403) return null;
  throw new Error(`GET /api/auth/me failed with ${response.status}`);
});

/**
 * Page-level guard, the second line of defence after proxy.ts (which already sent guests to log in
 * and wrong roles to a 404 with the right HTTP status). Use it close to the data a page renders.
 */
export async function requireUser(pathname: string): Promise<UserProfile> {
  const user = await getSession();
  if (!user)
    redirect(`/session/refresh?${new URLSearchParams({ next: pathname })}`);
  if (!canAccess(pathname, user.role)) notFound();
  return user;
}

export function hasRole(user: UserProfile | null, ...roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}
