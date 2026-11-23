import { HydrateUser } from '@/lib/auth/auth-context';
import { requireRole } from '@/lib/auth/session';

/**
 * Administrators only.
 * Rendered per request (dynamic SSR, brief section 9); the API enforces the same rules again.
 */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const user = await requireRole(['ADMIN']);
  return (
    <>
      <HydrateUser user={user} />
      {children}
    </>
  );
}
