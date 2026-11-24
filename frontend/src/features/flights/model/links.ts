/**
 * Links out of flight search (pure). The checkout entry contract is documented in
 * frontend/README.md: /checkout/flight?outbound=<flightId>:<cabinId>&return=<flightId>:<cabinId>
 * &adults=&children=&infants=
 */
import { ROUTES } from '@/shared/config/routes';
import type { FlightSearch, SearchFormValues } from './search-params';

export type LegChoice = { flightId: string; cabinId: string };

type Party = Pick<SearchFormValues, 'adults' | 'children' | 'infants'>;

const MONGO_ID = /^[a-f0-9]{24}$/i;

export function legParam(leg: LegChoice): string {
  return `${leg.flightId}:${leg.cabinId}`;
}

/** `<flightId>:<cabinId>` from the URL, or null. */
export function parseLeg(raw: string | string[] | undefined): LegChoice | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const [flightId, cabinId, extra] = value.split(':');
  if (extra !== undefined) return null;
  if (!MONGO_ID.test(flightId ?? '') || !MONGO_ID.test(cabinId ?? ''))
    return null;
  return { flightId, cabinId };
}

function partyQuery(party: Party, q: URLSearchParams): URLSearchParams {
  q.set('adults', String(party.adults));
  if (party.children) q.set('children', String(party.children));
  if (party.infants) q.set('infants', String(party.infants));
  return q;
}

/** Straight to checkout with the chosen legs and passengers (GEN-15: no re-typing). */
export function checkoutHref(
  outbound: LegChoice,
  party: Party,
  ret?: LegChoice | null,
): string {
  const q = new URLSearchParams({ outbound: legParam(outbound) });
  if (ret) q.set('return', legParam(ret));
  return `${ROUTES.checkoutFlight}?${partyQuery(party, q).toString()}`;
}

/**
 * The details page for one flight, carrying the passengers, the highlighted cabin and, for a round
 * trip, the other leg already chosen so "Book" there still books both.
 */
export function detailsHref(
  flightId: string,
  party: Party,
  options: {
    cabinId?: string;
    pairedWith?: LegChoice | null;
    leg?: 'outbound' | 'return';
  } = {},
): string {
  const q = new URLSearchParams();
  if (options.cabinId) q.set('cabin', options.cabinId);
  partyQuery(party, q);
  if (options.pairedWith) {
    q.set('leg', options.leg ?? 'outbound');
    q.set('paired', legParam(options.pairedWith));
  }
  return `${ROUTES.flights}/${flightId}?${q.toString()}`;
}

/** The API query for one-way or round-trip search; prices go out in minor units (PAY-04). */
export function toApiQuery(
  search: FlightSearch,
  toMinor: (amount: number) => number,
) {
  return {
    from: search.from,
    to: search.to,
    departureDate: search.depart,
    adults: search.adults,
    children: search.children,
    infants: search.infants,
    ...(search.cabin ? { cabinClass: search.cabin } : {}),
    ...(search.minPrice !== ''
      ? { minPriceMinor: toMinor(Number(search.minPrice)) }
      : {}),
    ...(search.maxPrice !== ''
      ? { maxPriceMinor: toMinor(Number(search.maxPrice)) }
      : {}),
    sort: search.sort,
    page: search.page,
    ...(search.trip === 'round'
      ? { returnDate: search.return, returnPage: search.returnPage }
      : {}),
  };
}

type SearchParams = Record<string, string | string[] | undefined>;

export type DetailsQuery = {
  adults: number;
  children: number;
  infants: number;
  cabinId?: string;
  paired: { leg: 'outbound' | 'return'; with: LegChoice } | null;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** What the details page was opened with (see detailsHref); junk falls back to one adult. */
export function parseDetailsQuery(params: SearchParams): DetailsQuery {
  const n = (raw: string, fallback: number) =>
    /^\d{1,2}$/.test(raw) ? Number(raw) : fallback;
  let adults = n(first(params.adults), 1);
  let children = n(first(params.children), 0);
  let infants = n(first(params.infants), 0);
  if (adults < 1 || infants > adults || adults + children + infants > 9) {
    adults = 1;
    children = 0;
    infants = 0;
  }
  const cabin = first(params.cabin);
  const pairedLeg = parseLeg(params.paired);
  return {
    adults,
    children,
    infants,
    ...(MONGO_ID.test(cabin) ? { cabinId: cabin } : {}),
    paired: pairedLeg
      ? {
          leg: first(params.leg) === 'return' ? 'return' : 'outbound',
          with: pairedLeg,
        }
      : null,
  };
}
