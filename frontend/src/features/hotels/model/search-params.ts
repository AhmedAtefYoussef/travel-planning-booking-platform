/**
 * Hotel search criteria (HTL-11, HTL-12) kept in the URL, so a search survives refresh and
 * back/forward and can be shared (GEN-15). Pure: no React, no fetch.
 *
 *   /hotels?city=cairo&checkIn=2027-01-10&checkOut=2027-01-13&guests=2&rooms=1
 *     &minPrice=50&maxPrice=200&minRating=4&sort=rating&page=2
 *
 * The checks here only help the user before a request is made (GEN-16); the API stays the
 * authority (GEN-13) and its field errors are mapped back onto these fields (apiFieldToFormField).
 */
import { addDays, todayIn, validateStay } from '@/shared/lib/dates';

/** HTL-11 limits, as the API enforces them. */
export const MAX_STAY_NIGHTS = 30;
export const MAX_GUESTS = 50;
export const MAX_ROOMS = 10;
/**
 * The API refuses a check-in before today in the earliest time zone on Earth, then applies each
 * city's own date. Using the same lower bound never blocks a date the API would accept.
 */
export const EARLIEST_ZONE = 'Etc/GMT+12';

export const HOTEL_SORTS = ['price', 'rating'] as const;
export type HotelSort = (typeof HOTEL_SORTS)[number];

export const SORT_LABELS: Record<HotelSort, string> = {
  price: 'Lowest price',
  rating: 'Highest rating',
};

export const RATING_OPTIONS = ['', '3', '3.5', '4', '4.5'] as const;

/** A city (`city:cairo`) or a whole country (`country:EG`); '' when none is chosen. */
export type Destination = string;

/** Everything the search form holds, as the inputs show it. */
export type SearchFormValues = {
  destination: Destination;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  /** Per night, in major units as typed (e.g. "80"); '' means no limit. */
  minPrice: string;
  maxPrice: string;
  /** '' means any rating. */
  minRating: string;
  sort: HotelSort;
};

export type HotelSearch = SearchFormValues & { page: number };

export type FieldErrors = Partial<Record<keyof SearchFormValues, string>>;

export type ParsedSearch =
  /** Opened without criteria: show the form only. */
  | { status: 'idle'; values: SearchFormValues }
  | { status: 'invalid'; values: SearchFormValues; errors: FieldErrors }
  | { status: 'ok'; values: SearchFormValues; search: HotelSearch };

type SearchParams = Record<string, string | string[] | undefined>;

const CITY_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const COUNTRY = /^[A-Z]{2}$/;
const PRICE = /^\d{1,9}(\.\d{1,2})?$/;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function whole(raw: string, fallback: number): number {
  if (raw === '') return fallback;
  return /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
}

function pageNumber(raw: string): number {
  return /^\d{1,5}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}

/** The earliest check-in the form offers: today in the earliest time zone. */
export function earliestCheckIn(now: Date = new Date()): string {
  return todayIn(EARLIEST_ZONE, now);
}

/** Sensible defaults (GEN-15): two guests in one room, two nights starting tomorrow, cheapest first. */
export function defaultValues(now: Date = new Date()): SearchFormValues {
  const checkIn = addDays(earliestCheckIn(now), 1);
  return {
    destination: '',
    checkIn,
    checkOut: addDays(checkIn, 2),
    guests: 2,
    rooms: 1,
    minPrice: '',
    maxPrice: '',
    minRating: '',
    sort: 'price',
  };
}

export function parseDestination(
  destination: Destination,
): { cityId: string } | { countryCode: string } | null {
  const [kind, value = ''] = destination.split(':');
  if (kind === 'city' && CITY_ID.test(value)) return { cityId: value };
  if (kind === 'country' && COUNTRY.test(value)) return { countryCode: value };
  return null;
}

/** Field-level problems with the values, or an empty object when they can be searched. */
export function validate(
  values: SearchFormValues,
  now: Date = new Date(),
): FieldErrors {
  const errors: FieldErrors = {};
  if (!parseDestination(values.destination))
    errors.destination = 'Choose a city or a country.';

  const stay = validateStay({
    checkIn: values.checkIn,
    checkOut: values.checkOut,
    today: earliestCheckIn(now),
    maxNights: MAX_STAY_NIGHTS,
  });
  Object.assign(errors, stay);

  if (
    !Number.isInteger(values.guests) ||
    values.guests < 1 ||
    values.guests > MAX_GUESTS
  )
    errors.guests = `Guests must be a whole number from 1 to ${MAX_GUESTS}.`;
  if (
    !Number.isInteger(values.rooms) ||
    values.rooms < 1 ||
    values.rooms > MAX_ROOMS
  )
    errors.rooms = `Rooms must be a whole number from 1 to ${MAX_ROOMS}.`;
  else if (!errors.guests && values.rooms > values.guests)
    errors.rooms = 'Every room needs at least one guest.';

  if (values.minPrice !== '' && !PRICE.test(values.minPrice))
    errors.minPrice = 'Enter a price such as 80 or 80.50.';
  if (values.maxPrice !== '' && !PRICE.test(values.maxPrice))
    errors.maxPrice = 'Enter a price such as 80 or 80.50.';
  if (
    !errors.minPrice &&
    !errors.maxPrice &&
    values.minPrice !== '' &&
    values.maxPrice !== '' &&
    Number(values.minPrice) > Number(values.maxPrice)
  )
    errors.maxPrice = 'The maximum price must be at least the minimum price.';

  if (
    values.minRating !== '' &&
    !(RATING_OPTIONS as readonly string[]).includes(values.minRating)
  )
    errors.minRating = 'Choose a rating from the list.';
  return errors;
}

/** Reads the URL into form values plus, when complete and valid, a search to run. */
export function parseHotelSearch(
  params: SearchParams,
  now: Date = new Date(),
): ParsedSearch {
  const defaults = defaultValues(now);
  const city = one(params.city);
  const country = one(params.country).toUpperCase();
  const sort = one(params.sort).toLowerCase();
  const checkIn = one(params.checkIn) || defaults.checkIn;
  const values: SearchFormValues = {
    destination: city ? `city:${city}` : country ? `country:${country}` : '',
    checkIn,
    checkOut:
      one(params.checkOut) ||
      (one(params.checkIn) ? addDays(checkIn, 2) : defaults.checkOut),
    guests: whole(one(params.guests), defaults.guests),
    rooms: whole(one(params.rooms), defaults.rooms),
    minPrice: one(params.minPrice),
    maxPrice: one(params.maxPrice),
    minRating: one(params.minRating),
    sort: (HOTEL_SORTS as readonly string[]).includes(sort)
      ? (sort as HotelSort)
      : 'price',
  };
  if (!city && !country)
    return { status: 'idle', values: withSafeCounts(values, defaults) };

  const errors = validate(values, now);
  if (Object.keys(errors).length)
    return {
      status: 'invalid',
      values: withSafeCounts(values, defaults),
      errors,
    };
  return {
    status: 'ok',
    values,
    search: { ...values, page: pageNumber(one(params.page)) },
  };
}

/** Counts the form can show even when the URL held junk. */
function withSafeCounts(
  values: SearchFormValues,
  defaults: SearchFormValues,
): SearchFormValues {
  const safe = (n: number, max: number, fallback: number) =>
    Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
  return {
    ...values,
    guests: safe(values.guests, MAX_GUESTS, defaults.guests),
    rooms: safe(values.rooms, MAX_ROOMS, defaults.rooms),
  };
}

/** The URL query for a search. Defaults are left out so links stay short. */
export function toQueryString(values: SearchFormValues, page = 1): string {
  const q = new URLSearchParams();
  const destination = parseDestination(values.destination);
  if (destination && 'cityId' in destination) q.set('city', destination.cityId);
  if (destination && 'countryCode' in destination)
    q.set('country', destination.countryCode);
  q.set('checkIn', values.checkIn);
  q.set('checkOut', values.checkOut);
  q.set('guests', String(values.guests));
  if (values.rooms !== 1) q.set('rooms', String(values.rooms));
  if (values.minPrice) q.set('minPrice', values.minPrice);
  if (values.maxPrice) q.set('maxPrice', values.maxPrice);
  if (values.minRating) q.set('minRating', values.minRating);
  if (values.sort !== 'price') q.set('sort', values.sort);
  if (page > 1) q.set('page', String(page));
  return q.toString();
}

export type HotelSearchApiQuery = {
  page: number;
  cityId?: string;
  countryCode?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  minRating?: number;
  sort: HotelSort;
};

/** The GET /api/hotels/search query; prices typed in major units are sent in minor units. */
export function toApiQuery(
  search: HotelSearch,
  toMinor: (major: number) => number,
): HotelSearchApiQuery {
  return {
    page: search.page,
    ...parseDestination(search.destination),
    checkIn: search.checkIn,
    checkOut: search.checkOut,
    guests: search.guests,
    rooms: search.rooms,
    ...(search.minPrice !== '' && {
      minPriceMinor: toMinor(Number(search.minPrice)),
    }),
    ...(search.maxPrice !== '' && {
      maxPriceMinor: toMinor(Number(search.maxPrice)),
    }),
    ...(search.minRating !== '' && { minRating: Number(search.minRating) }),
    sort: search.sort,
  };
}

/** API field name -> form field, so the API's field errors appear on the right input (GEN-02). */
const API_TO_FORM: Record<string, keyof SearchFormValues> = {
  cityId: 'destination',
  countryCode: 'destination',
  checkIn: 'checkIn',
  checkOut: 'checkOut',
  guests: 'guests',
  rooms: 'rooms',
  minPriceMinor: 'minPrice',
  maxPriceMinor: 'maxPrice',
  minRating: 'minRating',
  sort: 'sort',
};

export function apiFieldToFormField(
  apiField: string,
): keyof SearchFormValues | null {
  return API_TO_FORM[apiField] ?? null;
}
