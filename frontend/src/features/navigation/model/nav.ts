import type { Role } from '@/shared/api/types';
import { ROUTES } from '@/shared/config/routes';

export interface NavLink {
  href: string;
  label: string;
}

/** Discovery links everyone sees (guests included): search and community content. */
export const PUBLIC_LINKS: readonly NavLink[] = [
  { href: ROUTES.flights, label: 'Flights' },
  { href: ROUTES.hotels, label: 'Hotels' },
  { href: ROUTES.itineraries, label: 'Itineraries' },
  { href: ROUTES.blog, label: 'Blog' },
];

/** The signed-in user's own area, by role (GEN-14). Only links the role may open are shown. */
const ROLE_LINKS: Readonly<Record<Role, readonly NavLink[]>> = {
  USER: [
    { href: ROUTES.bookings, label: 'My bookings' },
    { href: ROUTES.myItineraries, label: 'My itineraries' },
  ],
  ADMIN: [{ href: ROUTES.admin, label: 'Admin' }],
  AIRLINE_MODERATOR: [
    { href: ROUTES.airlineDashboard, label: 'Airline dashboard' },
  ],
  HOTEL_MODERATOR: [{ href: ROUTES.hotelDashboard, label: 'Hotel dashboard' }],
};

export function roleLinks(role: Role | null): readonly NavLink[] {
  return role ? ROLE_LINKS[role] : [];
}

/** Account menu entries for any signed-in user. */
export const ACCOUNT_LINKS: readonly NavLink[] = [
  { href: ROUTES.account, label: 'Profile' },
  { href: ROUTES.notifications, label: 'Notifications' },
  { href: ROUTES.changePassword, label: 'Change password' },
];

/** Whether a nav link is the current section (exact match, or a page below it). */
export function isActive(pathname: string, href: string): boolean {
  if (href === ROUTES.home) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
