import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { parseDetailsQuery } from '@/features/flights';
import { FlightDetailsView, getFlight } from '@/features/flights/server';
import { ROUTES } from '@/shared/config/routes';
import { publicEnv } from '@/shared/config/env';
import { Button } from '@/shared/ui/button';
import { PageHeader } from '@/shared/ui/page-header';
import { Skeleton } from '@/shared/ui/skeleton';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
}: PageProps<'/flights/[id]'>): Promise<Metadata> {
  const flight = await getFlight((await params).id);
  if (!flight) return { title: 'Flight not found' };
  return {
    title: `${flight.airline.name} ${flight.flightNumber}: ${flight.departure.airport} to ${flight.arrival.airport}`,
    description: `Times, cabins, fares, baggage and cancellation policy for flight ${flight.flightNumber}.`,
  };
}

/**
 * FE-06 flight details (FLT-17). Rendering (brief section 9): dynamic SSR per request inside
 * Suspense: seats left and bookability change constantly, so nothing is cached. Public page.
 */
export default function FlightDetailsPage({
  params,
  searchParams,
}: PageProps<'/flights/[id]'>) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Button asChild variant="ghost" className="w-fit">
        <Link href={ROUTES.flights as Route}>
          <ArrowLeft aria-hidden="true" /> Back to search
        </Link>
      </Button>
      <Suspense fallback={<DetailsSkeleton />}>
        <Details
          id={params.then((p) => p.id)}
          query={searchParams as Promise<SearchParams>}
        />
      </Suspense>
    </main>
  );
}

async function Details({
  id,
  query,
}: {
  id: Promise<string>;
  query: Promise<SearchParams>;
}) {
  const [flight, context] = await Promise.all([
    id.then(getFlight),
    query.then(parseDetailsQuery),
  ]);
  if (!flight) notFound();
  return (
    <>
      <PageHeader
        title={`${flight.departure.airport} to ${flight.arrival.airport}`}
        description={`${flight.airline.name} flight ${flight.flightNumber}`}
      />
      <FlightDetailsView
        flight={flight}
        currency={publicEnv.NEXT_PUBLIC_PLATFORM_CURRENCY}
        context={context}
      />
    </>
  );
}

function DetailsSkeleton() {
  return (
    <div role="status" aria-label="Loading flight" className="grid gap-6">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
