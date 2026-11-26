import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';

export const metadata: Metadata = { title: 'Page not found' };

/** 404 page (GEN-16): explains what happened and offers a way back (GEN-14). */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="The page does not exist, or you do not have access to it."
        action={
          <Button asChild variant="outline">
            <Link href={ROUTES.home as Route}>Back to the home page</Link>
          </Button>
        }
      />
    </main>
  );
}
