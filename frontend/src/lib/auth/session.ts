import 'server-only';

import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { isApiError } from '@/lib/api/errors';
import { serverFetch } from '@/lib/api/server';
import type { Role, UserProfile } from '@/lib/api/types';

import {
  ACCESS_COOKIE,
  CHANGE_PASSWORD_PATH,
  PATHNAME_HEADER,
  SESSION_REFRESH_PATH,
} from './routes';

/**
 * Data access layer for the session on the server (ACC-11, ACC-19). The user always comes from
 * GET /api/auth/me with the visitor's cookies; nothing is decoded or trusted on the frontend.
 * Cached per request, so a layout and its page share one /auth/me call.
 */
export const getCurrentUser = cache(async (): Promise<UserProfile | null> => {
  const jar = await cookies();
  if (!jar.has(ACCESS_COOKIE)) return null;
  try {
    return await serverFetch<UserProfile>('/auth/me');
  } catch (error) {
    // Expired or revoked session, deactivated or suspended account: treat as signed out.
    if (isApiError(error) && (error.status === 401 || error.status === 403))
      return null;
    throw error;
  }
});

async function currentPath(): Promise<string> {
  return (await headers()).get(PATHNAME_HEADER) ?? '/';
}

/**
 * Signed-in user or a redirect. When there is no usable access cookie the visitor goes to the
 * session refresh page first (the refresh cookie only reaches /api/auth, so only the browser can
 * use it); that page falls through to /login?next=... if the session is really over.
 */
export async function requireUser(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(
      `${SESSION_REFRESH_PATH}?next=${encodeURIComponent(await currentPath())}`,
    );
  }
  return user;
}

/**
 * Role gate for a route segment's layout. Wrong role -> 404, so private sections are not even
 * revealed; a temporary password -> change it first (ACC-07a, ACC-13).
 */
export async function requireRole(
  roles: readonly Role[],
): Promise<UserProfile> {
  const user = await requireUser();
  if (
    user.mustChangePassword &&
    (await currentPath()) !== CHANGE_PASSWORD_PATH
  ) {
    redirect(CHANGE_PASSWORD_PATH);
  }
  if (!roles.includes(user.role)) notFound();
  return user;
}
