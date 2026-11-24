import { PlaneLanding, PlaneTakeoff, SearchX } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { ROUTES } from '@/shared/config/routes';
import type { Page } from '@/shared/api/types';
import { formatCalendarDate } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Pagination } from '@/shared/ui/pagination';
import type { FlightResult } from '../api/search.server';
import {
  checkoutHref,
  detailsHref,
  legParam,
  type LegChoice,
} from '../model/links';
import { toQueryString, type FlightSearch } from '../model/search-params';
import { FlightCard } from './flight-card';

type SearchResultsProps = {
  search: FlightSearch;
  outbound: Page<FlightResult>;
  returns: Page<FlightResult> | null;
  currency: string;
  /** Round trip: the legs chosen so far (from `out` / `ret` in the URL). */
  chosen: { out: LegChoice | null; ret: LegChoice | null };
};

const choiceOf = (f: FlightResult): LegChoice => ({
  flightId: f.flightId,
  cabinId: f.cabinId,
});

const same = (a: LegChoice | null, f: FlightResult) =>
  a?.flightId === f.flightId && a.cabinId === f.cabinId;

/**
 * FLT-11 / FLT-12 results. One way: each flight books in one click or opens its details. Round trip:
 * pick an outbound and a return (kept in the URL), then book both together. 10 per page (GEN-05).
 */
export function SearchResults({
  search,
  outbound,
  returns,
  currency,
  chosen,
}: SearchResultsProps) {
  const passengers = search.adults + search.children + search.infants;
  const round = search.trip === 'round';
  const extra = {
    out: chosen.out ? legParam(chosen.out) : undefined,
    ret: chosen.ret ? legParam(chosen.ret) : undefined,
  };
  const href = (
    pages: { page?: number; returnPage?: number },
    override: Partial<typeof extra> = {},
  ) =>
    `${ROUTES.flights}?${toQueryString(
      search,
      { page: search.page, returnPage: search.returnPage, ...pages },
      { ...extra, ...override },
    )}`;

  const empty = (label: string) => (
    <EmptyState
      icon={SearchX}
      title={`No ${label} flights match`}
      description={
        search.minPrice || search.maxPrice || search.cabin
          ? 'Try a wider price range, any cabin, or another date.'
          : 'Try another date or nearby airports.'
      }
    />
  );

  if (!round) {
    return (
      <section aria-labelledby="results-heading" className="grid gap-4">
        <ResultsHeading
          id="results-heading"
          icon="out"
          title={`${search.from} to ${search.to}`}
          date={search.depart}
          total={outbound.total}
        />
        {outbound.items.length === 0
          ? empty('')
          : outbound.items.map((f) => (
              <FlightCard
                key={`${f.flightId}-${f.cabinId}`}
                flight={f}
                currency={currency}
                passengers={passengers}
                actions={
                  <>
                    <Button asChild variant="outline">
                      <Link
                        href={
                          detailsHref(f.flightId, search, {
                            cabinId: f.cabinId,
                          }) as Route
                        }
                      >
                        Details
                      </Link>
                    </Button>
                    <Button asChild>
                      <Link href={checkoutHref(choiceOf(f), search) as Route}>
                        Book
                      </Link>
                    </Button>
                  </>
                }
              />
            ))}
        <Pagination
          page={outbound.page}
          totalPages={outbound.totalPages}
          hrefFor={(page) => href({ page })}
        />
      </section>
    );
  }

  const leg = (
    kind: 'out' | 'ret',
    page: Page<FlightResult>,
    pageKey: 'page' | 'returnPage',
  ) => {
    const picked = chosen[kind];
    const other = kind === 'out' ? chosen.ret : chosen.out;
    return page.items.length === 0 ? (
      empty(kind === 'out' ? 'outbound' : 'return')
    ) : (
      <>
        {page.items.map((f) => {
          const isPicked = same(picked, f);
          return (
            <FlightCard
              key={`${f.flightId}-${f.cabinId}`}
              flight={f}
              currency={currency}
              passengers={passengers}
              selected={isPicked}
              actions={
                <>
                  <Button asChild variant="outline">
                    <Link
                      href={
                        detailsHref(f.flightId, search, {
                          cabinId: f.cabinId,
                          pairedWith: other,
                          leg: kind === 'out' ? 'outbound' : 'return',
                        }) as Route
                      }
                    >
                      Details
                    </Link>
                  </Button>
                  <Button asChild variant={isPicked ? 'secondary' : 'default'}>
                    <Link
                      scroll={false}
                      href={
                        href(
                          {},
                          {
                            [kind]: isPicked
                              ? undefined
                              : legParam(choiceOf(f)),
                          },
                        ) as Route
                      }
                      aria-pressed={isPicked}
                    >
                      {isPicked ? 'Selected' : 'Select'}
                    </Link>
                  </Button>
                </>
              }
            />
          );
        })}
        <Pagination
          page={page.page}
          totalPages={page.totalPages}
          hrefFor={(p) => href({ [pageKey]: p })}
        />
      </>
    );
  };

  return (
    <div className="grid gap-8">
      <RoundTripSummary search={search} chosen={chosen} />
      <section aria-labelledby="outbound-heading" className="grid gap-4">
        <ResultsHeading
          id="outbound-heading"
          icon="out"
          title={`Outbound: ${search.from} to ${search.to}`}
          date={search.depart}
          total={outbound.total}
        />
        {leg('out', outbound, 'page')}
      </section>
      <section aria-labelledby="return-heading" className="grid gap-4">
        <ResultsHeading
          id="return-heading"
          icon="in"
          title={`Return: ${search.to} to ${search.from}`}
          date={search.return}
          total={returns?.total ?? 0}
        />
        {returns ? leg('ret', returns, 'returnPage') : empty('return')}
      </section>
    </div>
  );
}

function ResultsHeading({
  id,
  icon,
  title,
  date,
  total,
}: {
  id: string;
  icon: 'out' | 'in';
  title: string;
  date: string;
  total: number;
}) {
  const Icon = icon === 'out' ? PlaneTakeoff : PlaneLanding;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="flex items-center gap-2 text-lg font-semibold">
        <Icon aria-hidden="true" className="size-5 text-primary" />
        {title}
        <span className="text-sm font-normal text-muted-foreground">
          {formatCalendarDate(date)}
        </span>
      </h2>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total} flight{total === 1 ? '' : 's'} found
      </p>
    </div>
  );
}

/** Sticky progress for a round trip: what is chosen and the one button that books both. */
function RoundTripSummary({
  search,
  chosen,
}: {
  search: FlightSearch;
  chosen: SearchResultsProps['chosen'];
}) {
  const { out, ret } = chosen;
  const step = !chosen.out
    ? 'Step 1 of 2: select your outbound flight.'
    : !chosen.ret
      ? 'Step 2 of 2: select your return flight.'
      : 'Both flights selected.';
  return (
    <div
      role="status"
      className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur"
    >
      <p className="text-sm">{step}</p>
      {out && ret ? (
        <Button asChild>
          <Link href={checkoutHref(out, search, ret) as Route}>
            Book round trip
          </Link>
        </Button>
      ) : (
        <Button disabled>Book round trip</Button>
      )}
    </div>
  );
}
