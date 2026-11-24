import type { Metadata } from 'next';
import { Suspense } from 'react';
import {
  parseLeg,
  parseSearch,
  ResultsToolbar,
  SearchForm,
  toQueryString,
  type FlightSearch,
} from '@/features/flights';
import {
  listAllAirports,
  searchFlights,
  SearchResults,
} from '@/features/flights/server';
import { publicEnv } from '@/shared/config/env';
import { ErrorState } from '@/shared/ui/error-state';
import { PageHeader } from '@/shared/ui/page-header';
import { Skeleton } from '@/shared/ui/skeleton';

export const metadata: Metadata = {
  title: 'Search flights',
  description:
    'Search one-way and round-trip flights by airport and date, filter by price and cabin, and book.',
};

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * FE-06 flight search (FLT-11, FLT-12, FLT-15). Rendering (brief section 9): dynamic SSR. The header
 * is the static shell; the form and results depend on the URL query and on live seats and prices,
 * so they render per request inside Suspense and are never cached. The criteria live in the URL,
 * which makes every search shareable and keeps back/forward working. Only the form and the
 * toolbar are Client Components.
 */
export default function FlightsPage({ searchParams }: PageProps<'/flights'>) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Search flights"
        description="Choose your airports, dates and passengers. Times are shown in each airport's local time."
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
  const parsed = parseSearch(params);
  let airports;
  try {
    airports = await listAllAirports();
  } catch {
    return (
      <ErrorState
        title="Flight search is unavailable"
        message="We could not load the airport list. Please refresh the page in a moment."
      />
    );
  }
  const errors = parsed.status === 'invalid' ? parsed.errors : undefined;
  return (
    <>
      <SearchForm
        // A new URL (back/forward, a shared link) resets the form to what it describes.
        key={toQueryString(parsed.values)}
        airports={airports}
        values={parsed.values}
        errors={errors}
      />
      {parsed.status === 'ok' ? (
        <Suspense
          key={toQueryString(parsed.search, parsed.search)}
          fallback={<ResultsSkeleton />}
        >
          <Results
            search={parsed.search}
            out={parseLeg(params.out)}
            ret={parseLeg(params.ret)}
          />
        </Suspense>
      ) : parsed.status === 'idle' ? (
        <p className="text-sm text-muted-foreground">
          Pick where you are flying from and to, then search.
        </p>
      ) : null}
    </>
  );
}

async function Results({
  search,
  out,
  ret,
}: {
  search: FlightSearch;
  out: ReturnType<typeof parseLeg>;
  ret: ReturnType<typeof parseLeg>;
}) {
  const currency = publicEnv.NEXT_PUBLIC_PLATFORM_CURRENCY;
  const outcome = await searchFlights(search, currency);
  const toolbar = (
    <ResultsToolbar
      values={search}
      currency={currency}
      errors={outcome.ok ? undefined : outcome.errors}
    />
  );
  if (!outcome.ok) {
    const priceOnly = Object.keys(outcome.errors).every(
      (k) => k === 'minPrice' || k === 'maxPrice',
    );
    return (
      <>
        {toolbar}
        {Object.keys(outcome.errors).length > 0 && priceOnly ? null : (
          <ErrorState
            title="We could not search these flights"
            message={Object.values(outcome.errors).join(' ') || outcome.message}
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
        outbound={outcome.outbound}
        returns={outcome.return}
        currency={currency}
        chosen={{ out, ret }}
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
    <div role="status" aria-label="Searching flights" className="grid gap-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  );
}
