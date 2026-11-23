import { NextResponse, type NextRequest } from 'next/server';

import {
  ACCESS_COOKIE,
  PATHNAME_HEADER,
  SESSION_REFRESH_PATH,
  isProtectedPath,
} from '@/lib/auth/routes';

/**
 * Optimistic route protection (ACC-10, ACC-11). A guest asking for a private page is sent to the
 * session refresh page (which ends at /login?next=... if there is no session) before anything
 * renders. It only checks that the access cookie exists: roles are checked by each segment's
 * layout on the server and every rule is enforced again by the API (GEN-13).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const here = `${pathname}${search}`;

  if (isProtectedPath(pathname) && !request.cookies.has(ACCESS_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = SESSION_REFRESH_PATH;
    url.search = `?next=${encodeURIComponent(here)}`;
    return NextResponse.redirect(url);
  }

  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, here);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: never the API rewrite, uploaded images or build assets.
  matcher: [
    '/((?!api/|uploads/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
