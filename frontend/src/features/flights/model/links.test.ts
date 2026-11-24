import { describe, expect, it } from 'vitest';
import { parseFlightSelection } from '@/features/checkout';
import {
  checkoutHref,
  detailsHref,
  parseDetailsQuery,
  parseLeg,
  toApiQuery,
} from './links';
import { defaultValues } from './search-params';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);
const D = 'd'.repeat(24);
const party = { adults: 2, children: 1, infants: 1 };

describe('checkoutHref', () => {
  it('builds a link checkout accepts as-is (one way and round trip)', () => {
    for (const ret of [null, { flightId: C, cabinId: D }]) {
      const href = checkoutHref({ flightId: A, cabinId: B }, party, ret);
      const [path, query] = href.split('?');
      expect(path).toBe('/checkout/flight');
      const parsed = parseFlightSelection(
        Object.fromEntries(new URLSearchParams(query)),
      );
      expect(parsed).toEqual({
        ok: true,
        selection: {
          outbound: { flightId: A, cabinId: B },
          ...(ret ? { return: ret } : {}),
          counts: { ADULT: 2, CHILD: 1, INFANT: 1 },
        },
      });
    }
  });
});

describe('detailsHref and parseLeg', () => {
  it('carries the cabin, passengers and the paired leg', () => {
    const href = detailsHref(A, party, {
      cabinId: B,
      pairedWith: { flightId: C, cabinId: D },
      leg: 'return',
    });
    expect(href).toBe(
      `/flights/${A}?cabin=${B}&adults=2&children=1&infants=1&leg=return&paired=${C}%3A${D}`,
    );
    expect(parseLeg(`${C}:${D}`)).toEqual({ flightId: C, cabinId: D });
    expect(parseLeg('x:y')).toBeNull();
    expect(parseLeg(`${C}:${D}:extra`)).toBeNull();
  });
});

describe('toApiQuery', () => {
  const search = {
    ...defaultValues(),
    from: 'CAI',
    to: 'DXB',
    depart: '2026-12-01',
    page: 1,
    returnPage: 2,
  };

  it('sends prices in minor units and only what is set', () => {
    expect(
      toApiQuery({ ...search, minPrice: '100', maxPrice: '250.5' }, (n) =>
        Math.round(n * 100),
      ),
    ).toEqual({
      from: 'CAI',
      to: 'DXB',
      departureDate: '2026-12-01',
      adults: 1,
      children: 0,
      infants: 0,
      minPriceMinor: 10000,
      maxPriceMinor: 25050,
      sort: 'departure',
      page: 1,
    });
  });

  it('adds the return date and page for a round trip', () => {
    expect(
      toApiQuery(
        { ...search, trip: 'round', return: '2026-12-08', cabin: 'FIRST' },
        (n) => n,
      ),
    ).toMatchObject({
      cabinClass: 'FIRST',
      returnDate: '2026-12-08',
      returnPage: 2,
    });
  });
});

describe('parseDetailsQuery', () => {
  it('reads what detailsHref wrote', () => {
    const href = detailsHref(A, party, {
      cabinId: B,
      pairedWith: { flightId: C, cabinId: D },
      leg: 'return',
    });
    const params = Object.fromEntries(new URLSearchParams(href.split('?')[1]));
    expect(parseDetailsQuery(params)).toEqual({
      ...party,
      cabinId: B,
      paired: { leg: 'return', with: { flightId: C, cabinId: D } },
    });
  });

  it('falls back to one adult for an impossible party', () => {
    expect(
      parseDetailsQuery({ adults: '1', infants: '3', cabin: 'x' }),
    ).toEqual({
      adults: 1,
      children: 0,
      infants: 0,
      paired: null,
    });
  });
});
