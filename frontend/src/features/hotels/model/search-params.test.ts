import { describe, expect, it } from 'vitest';
import {
  apiFieldToFormField,
  defaultValues,
  parseDestination,
  parseHotelSearch,
  toApiQuery,
  toQueryString,
  validate,
  type SearchFormValues,
} from './search-params';

const NOW = new Date('2026-11-24T12:00:00Z');
// Earliest check-in is 2026-11-24; the defaults are 2026-11-25 to 2026-11-27.
const base = (extra: Record<string, string> = {}) => ({
  city: 'cairo',
  checkIn: '2026-12-01',
  checkOut: '2026-12-04',
  guests: '2',
  ...extra,
});

function errorsOf(params: Record<string, string>) {
  const parsed = parseHotelSearch(params, NOW);
  if (parsed.status !== 'invalid') throw new Error(`got ${parsed.status}`);
  return parsed.errors;
}

describe('hotel search params (HTL-11, HTL-12)', () => {
  it('is idle without a destination and offers defaults', () => {
    const parsed = parseHotelSearch({}, NOW);
    expect(parsed.status).toBe('idle');
    expect(parsed.values).toEqual(defaultValues(NOW));
    expect(parsed.values.checkIn).toBe('2026-11-25');
    expect(parsed.values.checkOut).toBe('2026-11-27');
  });

  it('is ok for a complete city search', () => {
    const parsed = parseHotelSearch(base(), NOW);
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok')
      expect(parsed.search).toMatchObject({
        destination: 'city:cairo',
        checkIn: '2026-12-01',
        checkOut: '2026-12-04',
        guests: 2,
        rooms: 1,
        sort: 'price',
        page: 1,
      });
  });

  it('tells a city from a country', () => {
    expect(parseDestination('city:cairo')).toEqual({ cityId: 'cairo' });
    expect(parseDestination('country:EG')).toEqual({ countryCode: 'EG' });
    expect(parseDestination('country:egypt')).toBeNull();
    expect(parseDestination('')).toBeNull();
    const parsed = parseHotelSearch(base({ city: '', country: 'eg' }), NOW);
    expect(parsed.values.destination).toBe('country:EG');
    expect(parsed.status).toBe('ok');
  });

  it('rejects a malformed city id', () => {
    expect(errorsOf(base({ city: 'a b!' })).destination).toBeDefined();
  });

  it('rejects a check-in in the past', () => {
    expect(errorsOf(base({ checkIn: '2026-11-23' })).checkIn).toMatch(/past/i);
    expect(parseHotelSearch(base({ checkIn: '2026-11-24' }), NOW).status).toBe(
      'ok',
    );
  });

  it('rejects a check-out on or before check-in', () => {
    expect(errorsOf(base({ checkOut: '2026-12-01' })).checkOut).toMatch(
      /after check-in/i,
    );
    expect(errorsOf(base({ checkOut: '2026-11-30' })).checkOut).toBeDefined();
  });

  it('allows 30 nights but not 31', () => {
    expect(parseHotelSearch(base({ checkOut: '2026-12-31' }), NOW).status).toBe(
      'ok',
    );
    expect(errorsOf(base({ checkOut: '2027-01-01' })).checkOut).toMatch(
      /30 nights/,
    );
  });

  it('needs at least one guest per room', () => {
    expect(errorsOf(base({ guests: '1', rooms: '2' })).rooms).toMatch(
      /at least one guest/i,
    );
    expect(
      parseHotelSearch(base({ guests: '2', rooms: '2' }), NOW).status,
    ).toBe('ok');
  });

  it('keeps guests and rooms within bounds', () => {
    expect(errorsOf(base({ guests: '0' })).guests).toBeDefined();
    expect(errorsOf(base({ guests: '51' })).guests).toBeDefined();
    expect(errorsOf(base({ guests: 'two' })).guests).toBeDefined();
    expect(errorsOf(base({ guests: '50', rooms: '11' })).rooms).toBeDefined();
    expect(errorsOf(base({ guests: '5', rooms: '0' })).rooms).toBeDefined();
    expect(
      parseHotelSearch(base({ guests: '50', rooms: '10' }), NOW).status,
    ).toBe('ok');
  });

  it('shows safe counts in the form when the URL held junk', () => {
    const parsed = parseHotelSearch(base({ guests: 'x', rooms: '-3' }), NOW);
    expect(parsed.status).toBe('invalid');
    expect(parsed.values.guests).toBe(2);
    expect(parsed.values.rooms).toBe(1);
  });

  it('checks the price format and that min is not above max', () => {
    expect(errorsOf(base({ minPrice: 'abc' })).minPrice).toBeDefined();
    expect(errorsOf(base({ maxPrice: '1.234' })).maxPrice).toBeDefined();
    expect(errorsOf(base({ minPrice: '-5' })).minPrice).toBeDefined();
    expect(
      errorsOf(base({ minPrice: '200', maxPrice: '100' })).maxPrice,
    ).toMatch(/at least the minimum/i);
    expect(
      parseHotelSearch(base({ minPrice: '80.50', maxPrice: '200' }), NOW)
        .status,
    ).toBe('ok');
  });

  it('accepts only the listed minimum ratings', () => {
    expect(errorsOf(base({ minRating: '2' })).minRating).toBeDefined();
    for (const r of ['3', '3.5', '4', '4.5'])
      expect(parseHotelSearch(base({ minRating: r }), NOW).status).toBe('ok');
  });

  it('falls back to price sort for an unknown sort', () => {
    expect(parseHotelSearch(base({ sort: 'rating' }), NOW).values.sort).toBe(
      'rating',
    );
    expect(parseHotelSearch(base({ sort: 'RATING' }), NOW).values.sort).toBe(
      'rating',
    );
    expect(parseHotelSearch(base({ sort: 'nope' }), NOW).values.sort).toBe(
      'price',
    );
  });

  it('reads the page number, defaulting to 1', () => {
    const page = (p: string) => {
      const parsed = parseHotelSearch(base({ page: p }), NOW);
      return parsed.status === 'ok' ? parsed.search.page : null;
    };
    expect(page('3')).toBe(3);
    expect(page('0')).toBe(1);
    expect(page('-2')).toBe(1);
    expect(page('abc')).toBe(1);
  });

  it('reads the first value of a repeated parameter', () => {
    const parsed = parseHotelSearch(
      { ...base(), city: ['cairo', 'giza'] },
      NOW,
    );
    expect(parsed.values.destination).toBe('city:cairo');
  });

  it('leaves defaults out of the query string', () => {
    const values: SearchFormValues = {
      ...defaultValues(NOW),
      destination: 'city:cairo',
    };
    expect(toQueryString(values)).toBe(
      'city=cairo&checkIn=2026-11-25&checkOut=2026-11-27&guests=2',
    );
    expect(toQueryString(values, 1)).not.toContain('page');
    expect(toQueryString(values, 2)).toContain('page=2');
  });

  it('round-trips through parseHotelSearch', () => {
    const values: SearchFormValues = {
      destination: 'country:EG',
      checkIn: '2026-12-01',
      checkOut: '2026-12-05',
      guests: 4,
      rooms: 2,
      minPrice: '50',
      maxPrice: '200.50',
      minRating: '4.5',
      sort: 'rating',
    };
    const query = Object.fromEntries(
      new URLSearchParams(toQueryString(values, 3)),
    );
    const parsed = parseHotelSearch(query, NOW);
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok')
      expect(parsed.search).toEqual({ ...values, page: 3 });
  });

  it('validate() accepts a complete set of values', () => {
    expect(
      validate({ ...defaultValues(NOW), destination: 'city:cairo' }, NOW),
    ).toEqual({});
    expect(validate(defaultValues(NOW), NOW).destination).toBeDefined();
  });

  it('builds the API query, converting prices and choosing city or country', () => {
    const search = {
      ...defaultValues(NOW),
      destination: 'city:cairo',
      minPrice: '80.5',
      maxPrice: '',
      minRating: '4',
      sort: 'rating' as const,
      page: 2,
    };
    const toMinor = (n: number) => Math.round(n * 100);
    const query = toApiQuery(search, toMinor);
    expect(query).toEqual({
      page: 2,
      cityId: 'cairo',
      checkIn: '2026-11-25',
      checkOut: '2026-11-27',
      guests: 2,
      rooms: 1,
      minPriceMinor: 8050,
      minRating: 4,
      sort: 'rating',
    });
    expect(query).not.toHaveProperty('countryCode');
    expect(query).not.toHaveProperty('maxPriceMinor');

    const country = toApiQuery(
      { ...search, destination: 'country:EG', minPrice: '', minRating: '' },
      toMinor,
    );
    expect(country.countryCode).toBe('EG');
    expect(country).not.toHaveProperty('cityId');
    expect(country).not.toHaveProperty('minPriceMinor');
    expect(country).not.toHaveProperty('minRating');
  });

  it('maps API field names onto form fields', () => {
    expect(apiFieldToFormField('cityId')).toBe('destination');
    expect(apiFieldToFormField('countryCode')).toBe('destination');
    expect(apiFieldToFormField('minPriceMinor')).toBe('minPrice');
    expect(apiFieldToFormField('maxPriceMinor')).toBe('maxPrice');
    expect(apiFieldToFormField('checkOut')).toBe('checkOut');
    expect(apiFieldToFormField('page')).toBeNull();
  });
});
