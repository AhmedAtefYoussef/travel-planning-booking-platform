import { SearchX } from 'lucide-react';
import type { Page } from '@/shared/api/types';
import { ROUTES } from '@/shared/config/routes';
import { EmptyState } from '@/shared/ui/empty-state';
import { Pagination } from '@/shared/ui/pagination';
import type { HotelResult } from '../api/search.server';
import { toQueryString, type HotelSearch } from '../model/search-params';
import { HotelCard } from './hotel-card';

type SearchResultsProps = {
  search: HotelSearch;
  results: Page<HotelResult>;
  currency: string;
};

/** HTL-11 / HTL-12 results: 10 per page (GEN-05), with the page kept in the URL. */
export function SearchResults({
  search,
  results,
  currency,
}: SearchResultsProps) {
  const hasRefinements = Boolean(
    search.minPrice || search.maxPrice || search.minRating,
  );
  return (
    <section aria-labelledby="results-heading" className="grid gap-4">
      <h2
        id="results-heading"
        aria-live="polite"
        className="text-lg font-semibold"
      >
        {results.total} hotel{results.total === 1 ? '' : 's'} found
      </h2>
      {results.items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No hotels match"
          description={
            hasRefinements
              ? 'Try other dates, a wider price range or any rating.'
              : 'Try other dates, fewer rooms or a wider destination.'
          }
        />
      ) : (
        <ul className="grid gap-4">
          {results.items.map((hotel) => (
            <li key={hotel.hotelId}>
              <HotelCard hotel={hotel} currency={currency} stay={search} />
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={results.page}
        totalPages={results.totalPages}
        hrefFor={(p) => `${ROUTES.hotels}?${toQueryString(search, p)}`}
      />
    </section>
  );
}
