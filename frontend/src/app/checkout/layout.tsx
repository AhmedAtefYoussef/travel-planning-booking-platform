import { HydrateUser } from '@/lib/auth/auth-context';
import { requireRole } from '@/lib/auth/session';

/**
 * Travellers only: holds, policies and payment (FE-02).
 * Rendered per request (dynamic SSR, brief section 9); the API enforces the same rules again.
 */
export default async function CheckoutLayout({
  children,
}: LayoutProps<'/checkout'>) {
  const user = await requireRole(['USER']);
  return (
    <>
      <HydrateUser user={user} />
      {children}
    </>
  );
}
