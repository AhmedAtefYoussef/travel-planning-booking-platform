import type { Role } from '@/shared/api/types';

/** Each role's home page after login (ACC-04); mirrors the API's `homePath`. */
export const HOME_PATH: Readonly<Record<Role, string>> = {
  USER: '/',
  ADMIN: '/admin',
  AIRLINE_MODERATOR: '/moderator/airline',
  HOTEL_MODERATOR: '/moderator/hotel',
};

/** Where a signed-in user must go while the admin-set password is still pending (ACC-07a). */
export const CHANGE_PASSWORD_PATH = '/account/change-password';

/**
 * Which roles may open each private section. `null` means any signed-in user. The first matching
 * prefix wins, so list the most specific prefixes first. This only shapes navigation: the API
 * enforces every rule again (ACC-11, GEN-13).
 */
export const PROTECTED_SECTIONS: readonly {
  prefix: string;
  roles: readonly Role[] | null;
}[] = [
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/moderator/airline', roles: ['AIRLINE_MODERATOR'] },
  { prefix: '/moderator/hotel', roles: ['HOTEL_MODERATOR'] },
  { prefix: '/bookings', roles: ['USER'] },
  { prefix: '/checkout', roles: ['USER'] },
  { prefix: '/account', roles: null },
];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The section rule for a path, or undefined for public pages. */
export function sectionFor(pathname: string) {
  return PROTECTED_SECTIONS.find((s) => matches(pathname, s.prefix));
}

export function isProtectedPath(pathname: string): boolean {
  return sectionFor(pathname) !== undefined;
}

/** Whether a role may open the path (public paths are open to everyone). */
export function canAccess(pathname: string, role: Role): boolean {
  const section = sectionFor(pathname);
  return !section || section.roles === null || section.roles.includes(role);
}
