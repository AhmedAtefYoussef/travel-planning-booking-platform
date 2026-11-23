import { HydrateUser } from '@/lib/auth/auth-context';
import { requireRole } from '@/lib/auth/session';

/**
 * Travellers only (ACC-11: each user sees only their own bookings).
 * Rendered per request (dynamic SSR, brief section 9); the API enforces the same rules again.
 */
export default async function BookingsLayout({
  children,
}: LayoutProps<'/bookings'>) {
  const user = await requireRole(['USER']);
  return (
    <>
      <HydrateUser user={user} />
      {children}
    </>
  );
}
