import type { Role, UserProfile } from '@/lib/api/types';

/** Name of the httpOnly access cookie the API sets (path `/`). The frontend only checks it exists. */
export const ACCESS_COOKIE = 'access_token';

/** Header the proxy adds so server layouts know which page to come back to after signing in. */
export const PATHNAME_HEADER = 'x-pathname';

export const LOGIN_PATH = '/login';
export const CHANGE_PASSWORD_PATH = '/account/change-password';
/** Client page that rotates the session cookies, then returns to `next` (or goes to login). */
export const SESSION_REFRESH_PATH = '/session/refresh';

/**
 * Where each role lands after login (ACC-04). Mirrors backend/src/modules/auth/home-paths.ts; the
 * login response's `homePath` is authoritative, this map is for links and fallbacks.
 */
export const HOME_PATH: Record<Role, string> = {
  USER: '/',
  ADMIN: '/admin',
  AIRLINE_MODERATOR: '/moderator/airline',
  HOTEL_MODERATOR: '/moderator/hotel',
};

export function homePathFor(
  user: Pick<UserProfile, 'role' | 'mustChangePassword'>,
): string {
  return user.mustChangePassword ? CHANGE_PASSWORD_PATH : HOME_PATH[user.role];
}

/**
 * Pages that need a signed-in visitor. The proxy redirects guests away from these before rendering
 * (an optimistic check); each segment's layout then checks the role on the server with
 * `requireRole`, and the API enforces everything again (GEN-13). Add new private sections here.
 */
export const PROTECTED_PREFIXES = [
  '/account',
  '/bookings',
  '/checkout',
  '/itineraries/mine',
  '/blog/mine',
  '/admin',
  '/moderator',
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Only same-site relative paths may be used as a post-login destination, so `?next=` cannot be
 * abused as an open redirect (`//evil.com`, `https://evil.com`, `/\evil.com`).
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = '/',
): string {
  if (
    !next ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.startsWith('/\\')
  ) {
    return fallback;
  }
  if (next.startsWith(LOGIN_PATH) || next.startsWith(SESSION_REFRESH_PATH))
    return fallback;
  return next;
}

export function loginUrl(next?: string): string {
  const target = safeNextPath(next, '');
  return target
    ? `${LOGIN_PATH}?next=${encodeURIComponent(target)}`
    : LOGIN_PATH;
}
