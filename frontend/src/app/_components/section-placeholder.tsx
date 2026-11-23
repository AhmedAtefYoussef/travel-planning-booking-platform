import { Construction } from 'lucide-react';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageHeader } from '@/shared/ui/page-header';

/**
 * Stand-in for a private page that a teammate's story delivers. It already sits behind the route
 * guard, so replacing it only means writing the page itself.
 */
export function SectionPlaceholder({
  title,
  description,
  story,
}: {
  title: string;
  description: string;
  story: string;
}) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Construction}
        title="This page is on its way"
        description={`It arrives with ${story}.`}
      />
    </main>
  );
}
