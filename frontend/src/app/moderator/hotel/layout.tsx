import { HydrateUser } from '@/lib/auth/auth-context';
import { requireRole } from '@/lib/auth/session';

/**
 * Hotel moderators only (their one assigned hotel).
 * Rendered per request (dynamic SSR, brief section 9); the API enforces the same rules again.
 */
export default async function HotelModeratorLayout({
  children,
}: LayoutProps<'/moderator/hotel'>) {
  const user = await requireRole(['HOTEL_MODERATOR']);
  return (
    <>
      <HydrateUser user={user} />
      {children}
    </>
  );
}
