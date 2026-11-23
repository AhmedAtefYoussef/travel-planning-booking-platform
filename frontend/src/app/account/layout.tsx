import { HydrateUser } from '@/lib/auth/auth-context';
import { requireUser } from '@/lib/auth/session';

/**
 * Any signed-in role (profile, password).
 * Rendered per request (dynamic SSR, brief section 9); the API enforces the same rules again.
 */
export default async function AccountLayout({
  children,
}: LayoutProps<'/account'>) {
  const user = await requireUser();
  return (
    <>
      <HydrateUser user={user} />
      {children}
    </>
  );
}
