import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import {
  parseHotelSearch,
  ResultsToolbar,
  SearchForm,
  toQueryString,
  type HotelSearch,
} from '@/features/hotels';
import {
  listDestinations,
  searchHotels,
  SearchResults,
} from '@/features/hotels/server';
import { publicEnv } from '@/shared/config/env';
import { ErrorState } from '@/shared/ui/error-state';
import { PageHeader } from '@/shared/ui/page-header';
import { Skeleton } from '@/shared/ui/skeleton';

export const metadata: Metadata = {
  title: 'Search hotels',
  description:
    'Search hotels by city or country and stay dates, filter by price and rating, and view available rooms.',
};

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * FE-08 hotel search (HTL-11, HTL-12). Rendering (brief section 9): dynamic SSR. The header is the
 * static shell; the form and results depend on the URL query and on live prices and free rooms, so
 * they render per request inside Suspense and are never cached. The criteria live in the URL, which
 * makes every search shareable and keeps back/forward working. The country and city lists are
 * reference data, cached for hours. Only the form and the toolbar are Client Components.
 */
export default function HotelsPage({ searchParams }: PageProps<'/hotels'>) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Search hotels"
        description="Choose a destination, your dates and how many guests and rooms you need."
      />
      <Suspense fallback={<FormSkeleton />}>
        <SearchSection searchParams={searchParams as Promise<SearchParams>} />
      </Suspense>
    </main>
  );
}

async function SearchSection({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // The default dates are relative to today, so read the clock only at request time (Cache Components).
  await connection();
  const parsed = parseHotelSearch(params);
  let destinations;
  try {
    destinations = await listDestinations();
  } catch {
    return (
      <ErrorState
        title="Hotel search is unavailable"
        message="We could not load the list of destinations. Please refresh the page in a moment."
      />
    );
  }
  const errors = parsed.status === 'invalid' ? parsed.errors : undefined;
  return (
    <>
      <SearchForm
        // A new URL (back/forward, a shared link) resets the form to what it describes.
        key={`form:${toQueryString(parsed.values)}`}
        destinations={destinations}
        values={parsed.values}
        errors={errors}
      />
      {parsed.status === 'ok' ? (
        <Suspense
          key={`results:${toQueryString(parsed.search, parsed.search.page)}`}
          fallback={<ResultsSkeleton />}
        >
          <Results search={parsed.search} />
        </Suspense>
      ) : parsed.status === 'idle' ? (
        <p className="text-sm text-muted-foreground">
          Pick a destination and your dates, then search.
        </p>
      ) : null}
    </>
  );
}

async function Results({ search }: { search: HotelSearch }) {
  const currency = publicEnv.NEXT_PUBLIC_PLATFORM_CURRENCY;
  const outcome = await searchHotels(search, currency);
  const toolbar = (
    <ResultsToolbar
      key={`toolbar:${toQueryString(search)}`}
      values={search}
      currency={currency}
      errors={outcome.ok ? undefined : outcome.errors}
    />
  );
  if (!outcome.ok) {
    const refinementOnly = Object.keys(outcome.errors).every(
      (k) => k === 'minPrice' || k === 'maxPrice' || k === 'minRating',
    );
    return (
      <>
        {toolbar}
        {Object.keys(outcome.errors).length > 0 && refinementOnly ? null : (
          <ErrorState
            title="We could not search these hotels"
            message={
              Object.values(outcome.errors).join(' ') ||
              `${outcome.message} Please check your search and try again.`
            }
          />
        )}
      </>
    );
  }
  return (
    <>
      {toolbar}
      <SearchResults
        search={search}
        results={outcome.page}
        currency={currency}
      />
    </>
  );
}

function FormSkeleton() {
  return (
    <div role="status" aria-label="Loading search" className="grid gap-4">
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Searching hotels" className="grid gap-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  );
}
