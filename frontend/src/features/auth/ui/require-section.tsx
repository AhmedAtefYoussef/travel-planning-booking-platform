import 'server-only';
import type { ReactNode } from 'react';
import { requireUser } from '../session';

/**
 * Server-side guard for a private section's layout (ACC-11), the second line of defence after
 * proxy.ts. It reads the session cookie, so render it inside <Suspense>; under Cache Components the
 * proxy is what returns the real 307/404 status, this only stops rendering for a wrong visitor.
 */
export async function RequireSection({
  section,
  children,
}: {
  /** The section prefix, e.g. '/admin'. */
  section: string;
  children: ReactNode;
}) {
  await requireUser(section);
  return children;
}
