import type { Role } from '@/lib/api/types';

export interface NavLink {
  href: string;
  label: string;
}

/** Everyone, signed in or not. */
export const PUBLIC_LINKS: NavLink[] = [
  { href: '/flights', label: 'Flights' },
  { href: '/hotels', label: 'Hotels' },
  { href: '/itineraries', label: 'Itineraries' },
  { href: '/blog', label: 'Blog' },
];

/** Extra links per role (GEN-14). Owners of each section add their pages here. */
export const ROLE_LINKS: Record<Role, NavLink[]> = {
  USER: [
    { href: '/bookings', label: 'My bookings' },
    { href: '/itineraries/mine', label: 'My itineraries' },
  ],
  ADMIN: [{ href: '/admin', label: 'Admin' }],
  AIRLINE_MODERATOR: [{ href: '/moderator/airline', label: 'My airline' }],
  HOTEL_MODERATOR: [{ href: '/moderator/hotel', label: 'My hotel' }],
};

export function isActive(pathname: string, href: string): boolean {
  return href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`);
}
