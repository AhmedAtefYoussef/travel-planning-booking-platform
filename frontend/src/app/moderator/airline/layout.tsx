import { HydrateUser } from '@/lib/auth/auth-context';
import { requireRole } from '@/lib/auth/session';

/**
 * Airline moderators only (their one assigned airline).
 * Rendered per request (dynamic SSR, brief section 9); the API enforces the same rules again.
 */
export default async function AirlineModeratorLayout({
  children,
}: LayoutProps<'/moderator/airline'>) {
  const user = await requireRole(['AIRLINE_MODERATOR']);
  return (
    <>
      <HydrateUser user={user} />
      {children}
    </>
  );
}
