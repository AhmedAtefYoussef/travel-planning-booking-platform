import type { Route } from 'next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

/**
 * Page numbers to show: always first and last, the current page and its neighbours, and an
 * 'ellipsis' wherever pages are skipped. A gap of exactly one page is shown as the page itself,
 * so an ellipsis never hides a single number. No duplicates.
 */
export function pageItems(
  page: number,
  totalPages: number,
): (number | 'ellipsis')[] {
  if (totalPages < 1) return [];
  const current = Math.min(Math.max(page, 1), totalPages);
  const wanted = new Set<number>([
    1,
    totalPages,
    current - 1,
    current,
    current + 1,
  ]);
  const pages = [...wanted]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  const items: (number | 'ellipsis')[] = [];
  pages.forEach((p, i) => {
    const prev = pages[i - 1];
    if (prev !== undefined) {
      if (p - prev === 2) items.push(prev + 1);
      else if (p - prev > 2) items.push('ellipsis');
    }
    items.push(p);
  });
  return items;
}

type PaginationProps = {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  className?: string;
};

/** Link-based pagination for list pages, driven by the `page` query param (GEN-05). */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const items = pageItems(page, totalPages);
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;
  const edge = buttonVariants({ variant: 'outline', size: 'sm' });

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex justify-center', className)}
    >
      <ul className="flex flex-wrap items-center gap-1">
        <li>
          {hasPrevious ? (
            <Link href={hrefFor(page - 1) as Route} rel="prev" className={edge}>
              <ChevronLeft aria-hidden="true" />
              Previous
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={cn(edge, 'pointer-events-none opacity-50')}
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </span>
          )}
        </li>
        {items.map((item, index) =>
          item === 'ellipsis' ? (
            <li
              key={`ellipsis-${index}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground"
            >
              &hellip;
            </li>
          ) : (
            <li key={item}>
              <Link
                href={hrefFor(item) as Route}
                aria-current={item === page ? 'page' : undefined}
                aria-label={`Page ${item}`}
                className={buttonVariants({
                  variant: item === page ? 'default' : 'ghost',
                  size: 'sm',
                })}
              >
                {item}
              </Link>
            </li>
          ),
        )}
        <li>
          {hasNext ? (
            <Link href={hrefFor(page + 1) as Route} rel="next" className={edge}>
              Next
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={cn(edge, 'pointer-events-none opacity-50')}
            >
              Next
              <ChevronRight aria-hidden="true" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
