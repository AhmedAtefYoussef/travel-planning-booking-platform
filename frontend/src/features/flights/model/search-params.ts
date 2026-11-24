/**
 * Flight search criteria (FLT-11, FLT-12, FLT-15) kept in the URL, so a search survives refresh,
 * back/forward and can be shared (GEN-15). Pure: no React, no fetch.
 *
 *   /flights?trip=round&from=CAI&to=DXB&depart=2026-12-01&return=2026-12-08
 *     &adults=2&children=1&infants=0&cabin=ECONOMY&minPrice=100&maxPrice=500&sort=price&page=1&returnPage=1
 *
 * The checks here only help the user before a request is made; the API stays the authority (GEN-13)
 * and its field errors are mapped back onto these fields (see apiFieldToFormField).
 */
import { compositionError, MAX_PASSENGERS } from '@/features/checkout';

export const CABIN_CLASSES = [
  'ECONOMY',
  'PREMIUM_ECONOMY',
  'BUSINESS',
  'FIRST',
] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const CABIN_LABELS: Record<CabinClass, string> = {
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'Premium economy',
  BUSINESS: 'Business',
  FIRST: 'First',
};

export const SORTS = ['departure', 'price', 'duration'] as const;
export type SortKey = (typeof SORTS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  departure: 'Earliest departure',
  price: 'Lowest price',
  duration: 'Shortest flight',
};

export type TripType = 'oneway' | 'round';

/** Everything the search form holds, as text (what the inputs show). */
export type SearchFormValues = {
  trip: TripType;
  from: string;
  to: string;
  depart: string;
  return: string;
  adults: number;
  children: number;
  infants: number;
  /** '' means any cabin. */
  cabin: CabinClass | '';
  /** Per passenger, in major units as typed (e.g. "150"); '' means no limit. */
  minPrice: string;
  maxPrice: string;
  sort: SortKey;
};

/** A complete, valid search, ready to send to the API. */
export type FlightSearch = SearchFormValues & {
  page: number;
  returnPage: number;
};

export type FieldErrors = Partial<Record<keyof SearchFormValues, string>>;

export type ParsedSearch =
  /** No search yet (the page was opened without criteria): show the form only. */
  | { status: 'idle'; values: SearchFormValues }
  | { status: 'invalid'; values: SearchFormValues; errors: FieldErrors }
  | { status: 'ok'; values: SearchFormValues; search: FlightSearch };

type SearchParams = Record<string, string | string[] | undefined>;

const IATA = /^[A-Z]{3}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PRICE = /^\d{1,9}(\.\d{1,3})?$/;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export function isRealDate(ymd: string): boolean {
  if (!YMD.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** `YYYY-MM-DD` of `date` plus `days`, in UTC (calendar arithmetic only). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today's calendar date in the visitor's zone; `now` is injectable for tests. */
export function todayLocal(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Sensible defaults (GEN-15): one adult, any cabin, departing tomorrow, cheapest first. */
export function defaultValues(now: Date = new Date()): SearchFormValues {
  const tomorrow = addDays(todayLocal(now), 1);
  return {
    trip: 'oneway',
    from: '',
    to: '',
    depart: tomorrow,
    return: addDays(tomorrow, 7),
    adults: 1,
    children: 0,
    infants: 0,
    cabin: '',
    minPrice: '',
    maxPrice: '',
    sort: 'departure',
  };
}

function count(raw: string, fallback: number): number {
  if (raw === '') return fallback;
  return /^\d{1,2}$/.test(raw) ? Number(raw) : Number.NaN;
}

function pageNumber(raw: string): number {
  return /^\d{1,5}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}

/** Field-level problems with the values, or an empty object when they can be searched. */
export function validate(values: SearchFormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!IATA.test(values.from))
    errors.from = 'Choose where you are flying from.';
  if (!IATA.test(values.to)) errors.to = 'Choose where you are flying to.';
  else if (values.to === values.from)
    errors.to = 'Departure and arrival airports must be different.';

  if (!isRealDate(values.depart)) errors.depart = 'Choose a departure date.';
  if (values.trip === 'round') {
    if (!isRealDate(values.return)) errors.return = 'Choose a return date.';
    else if (isRealDate(values.depart) && values.return < values.depart)
      errors.return = 'The return date cannot be before the departure date.';
  }

  const counts = [values.adults, values.children, values.infants];
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) {
    errors.adults = 'Passenger numbers must be whole numbers.';
  } else {
    const problem = compositionError({
      ADULT: values.adults,
      CHILD: values.children,
      INFANT: values.infants,
    });
    if (problem)
      errors[values.infants > values.adults ? 'infants' : 'adults'] = problem;
  }

  if (values.minPrice !== '' && !PRICE.test(values.minPrice))
    errors.minPrice = 'Enter a price such as 150 or 150.50.';
  if (values.maxPrice !== '' && !PRICE.test(values.maxPrice))
    errors.maxPrice = 'Enter a price such as 150 or 150.50.';
  if (
    !errors.minPrice &&
    !errors.maxPrice &&
    values.minPrice !== '' &&
    values.maxPrice !== '' &&
    Number(values.minPrice) > Number(values.maxPrice)
  )
    errors.maxPrice = 'The maximum price must be at least the minimum price.';
  return errors;
}

/** Reads the URL into form values plus, when complete and valid, a search to run. */
export function parseSearch(
  params: SearchParams,
  now: Date = new Date(),
): ParsedSearch {
  const defaults = defaultValues(now);
  const cabin = one(params.cabin).toUpperCase();
  const sort = one(params.sort).toLowerCase();
  const values: SearchFormValues = {
    trip: one(params.trip) === 'round' ? 'round' : 'oneway',
    from: one(params.from).toUpperCase(),
    to: one(params.to).toUpperCase(),
    depart: one(params.depart) || defaults.depart,
    return:
      one(params.return) ||
      (isRealDate(one(params.depart))
        ? addDays(one(params.depart), 7)
        : defaults.return),
    adults: count(one(params.adults), 1),
    children: count(one(params.children), 0),
    infants: count(one(params.infants), 0),
    cabin: (CABIN_CLASSES as readonly string[]).includes(cabin)
      ? (cabin as CabinClass)
      : '',
    minPrice: one(params.minPrice),
    maxPrice: one(params.maxPrice),
    sort: (SORTS as readonly string[]).includes(sort)
      ? (sort as SortKey)
      : 'departure',
  };
  if (!one(params.from) && !one(params.to))
    return { status: 'idle', values: withSafeCounts(values) };

  const errors = validate(values);
  if (Object.keys(errors).length)
    return { status: 'invalid', values: withSafeCounts(values), errors };
  return {
    status: 'ok',
    values,
    search: {
      ...values,
      page: pageNumber(one(params.page)),
      returnPage: pageNumber(one(params.returnPage)),
    },
  };
}

/** Counts the form can show even when the URL held junk. */
function withSafeCounts(values: SearchFormValues): SearchFormValues {
  const safe = (n: number, fallback: number) =>
    Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_PASSENGERS) : fallback;
  return {
    ...values,
    adults: safe(values.adults, 1),
    children: safe(values.children, 0),
    infants: safe(values.infants, 0),
  };
}

/**
 * The URL query for a search. Defaults are left out so links stay short; pages are only written
 * when past the first. `extra` carries round-trip selections (`out`, `ret`).
 */
export function toQueryString(
  values: SearchFormValues,
  pages: { page?: number; returnPage?: number } = {},
  extra: Record<string, string | undefined> = {},
): string {
  const q = new URLSearchParams();
  if (values.trip === 'round') q.set('trip', 'round');
  q.set('from', values.from);
  q.set('to', values.to);
  q.set('depart', values.depart);
  if (values.trip === 'round') q.set('return', values.return);
  q.set('adults', String(values.adults));
  if (values.children) q.set('children', String(values.children));
  if (values.infants) q.set('infants', String(values.infants));
  if (values.cabin) q.set('cabin', values.cabin);
  if (values.minPrice) q.set('minPrice', values.minPrice);
  if (values.maxPrice) q.set('maxPrice', values.maxPrice);
  if (values.sort !== 'departure') q.set('sort', values.sort);
  if (pages.page && pages.page > 1) q.set('page', String(pages.page));
  if (pages.returnPage && pages.returnPage > 1)
    q.set('returnPage', String(pages.returnPage));
  for (const [key, value] of Object.entries(extra))
    if (value) q.set(key, value);
  return q.toString();
}

/** API field name -> form field, so the API's field errors appear on the right input (GEN-02). */
const API_TO_FORM: Record<string, keyof SearchFormValues> = {
  from: 'from',
  to: 'to',
  departureDate: 'depart',
  returnDate: 'return',
  adults: 'adults',
  children: 'children',
  infants: 'infants',
  passengers: 'adults',
  cabinClass: 'cabin',
  minPriceMinor: 'minPrice',
  maxPriceMinor: 'maxPrice',
  sort: 'sort',
};

export function apiFieldToFormField(
  apiField: string,
): keyof SearchFormValues | null {
  return API_TO_FORM[apiField] ?? null;
}
