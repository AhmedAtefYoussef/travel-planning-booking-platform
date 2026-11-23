import { NextResponse, type NextRequest } from 'next/server';
import {
  CHANGE_PASSWORD_PATH,
  canAccess,
  sectionFor,
  withNext,
} from '@/features/auth';
import { readServerEnv } from '@/shared/config/env';
import type { UserProfile } from '@/shared/api/types';

/**
 * Route protection that runs before rendering, so the browser gets real HTTP statuses: a 307 to sign
 * in, or a 404 for a section the role may not open (ACC-10, ACC-11). With Cache Components a check
 * inside a page runs after the shell is sent and would answer 200.
 *
 * This only shapes navigation. Every API call is authorised again by the backend (GEN-13), and pages
 * re-check with requireUser() close to their data.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const section = sectionFor(pathname);
  if (!section) return NextResponse.next();

  const here = `${pathname}${search}`;
  // The access cookie expires after 15 minutes; the refresh cookie is scoped to /api/auth and is not
  // visible here, so a missing access cookie goes to the refresh page, which renews the session or
  // sends the visitor to log in.
  if (!request.cookies.has('access_token'))
    return redirectTo(request, withNext('/session/refresh', here));

  const user = await currentUser(request);
  if (user === 'unauthenticated')
    return redirectTo(request, withNext('/session/refresh', here));
  if (user === 'unavailable') return NextResponse.next(); // pages show their own error state

  if (user.mustChangePassword && pathname !== CHANGE_PASSWORD_PATH) {
    return redirectTo(request, CHANGE_PASSWORD_PATH);
  }
  if (!canAccess(pathname, user.role)) {
    // Rewriting to a path no route matches renders app/not-found.tsx with status 404, without
    // revealing that the section exists.
    return NextResponse.rewrite(new URL('/_forbidden-section', request.url), {
      status: 404,
    });
  }
  return NextResponse.next();
}

async function currentUser(
  request: NextRequest,
): Promise<UserProfile | 'unauthenticated' | 'unavailable'> {
  try {
    const res = await fetch(`${readServerEnv().BACKEND_URL}/api/auth/me`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
    if (res.status === 401 || res.status === 403) return 'unauthenticated';
    if (!res.ok) return 'unavailable';
    return (await res.json()) as UserProfile;
  } catch {
    return 'unavailable';
  }
}

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

export const config = {
  matcher: [
    '/account/:path*',
    '/admin/:path*',
    '/bookings/:path*',
    '/checkout/:path*',
    '/moderator/:path*',
  ],
};
