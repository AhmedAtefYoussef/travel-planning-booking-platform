import { describe, expect, it } from 'vitest';
import {
  addDays,
  apiFieldToFormField,
  defaultValues,
  parseSearch,
  toQueryString,
  validate,
} from './search-params';

const NOW = new Date('2026-11-24T12:00:00Z');

describe('parseSearch (FLT-11, FLT-12, FLT-15)', () => {
  it('is idle with sensible defaults when no airports are given (GEN-15)', () => {
    const parsed = parseSearch({}, NOW);
    expect(parsed.status).toBe('idle');
    expect(parsed.values).toMatchObject({
      trip: 'oneway',
      adults: 1,
      children: 0,
      infants: 0,
      cabin: '',
      sort: 'departure',
    });
    expect(parsed.values.depart > '2026-11-24').toBe(true);
  });

  it('reads a full round trip, normalising case', () => {
    const parsed = parseSearch(
      {
        trip: 'round',
        from: 'cai',
        to: 'dxb',
        depart: '2026-12-01',
        return: '2026-12-08',
        adults: '2',
        children: '1',
        infants: '1',
        cabin: 'business',
        minPrice: '100',
        maxPrice: '450.50',
        sort: 'PRICE',
        page: '2',
        returnPage: '3',
      },
      NOW,
    );
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.search).toMatchObject({
      trip: 'round',
      from: 'CAI',
      to: 'DXB',
      cabin: 'BUSINESS',
      sort: 'price',
      page: 2,
      returnPage: 3,
    });
  });

  it('falls back to page 1 for a junk page number', () => {
    const parsed = parseSearch(
      { from: 'CAI', to: 'DXB', depart: '2026-12-01', page: '-4' },
      NOW,
    );
    expect(parsed.status === 'ok' && parsed.search.page).toBe(1);
  });

  it('reports every problem at once, on the right field', () => {
    const parsed = parseSearch(
      {
        trip: 'round',
        from: 'CAI',
        to: 'CAI',
        depart: '2026-02-30',
        return: '2026-12-01',
        adults: '1',
        infants: '2',
        minPrice: '500',
        maxPrice: 'abc',
      },
      NOW,
    );
    expect(parsed.status).toBe('invalid');
    if (parsed.status !== 'invalid') return;
    expect(Object.keys(parsed.errors).sort()).toEqual(
      ['depart', 'infants', 'maxPrice', 'to'].sort(),
    );
  });
});

describe('validate', () => {
  const ok = {
    ...defaultValues(NOW),
    from: 'CAI',
    to: 'DXB',
    depart: '2026-12-01',
  };

  it('accepts a valid one-way search', () => {
    expect(validate(ok)).toEqual({});
  });

  it('refuses a return before departure', () => {
    expect(
      validate({ ...ok, trip: 'round', return: '2026-11-30' }).return,
    ).toMatch(/before/);
  });

  it('refuses min price above max price (FLT-15)', () => {
    expect(
      validate({ ...ok, minPrice: '300', maxPrice: '200' }).maxPrice,
    ).toMatch(/at least/);
  });

  it('refuses more than 9 passengers and zero adults (FLT-12)', () => {
    expect(validate({ ...ok, adults: 8, children: 2 }).adults).toMatch(/9/);
    expect(validate({ ...ok, adults: 0 }).adults).toMatch(/adult/);
  });
});

describe('toQueryString', () => {
  it('leaves defaults out and keeps the URL readable', () => {
    const q = toQueryString({
      ...defaultValues(NOW),
      from: 'CAI',
      to: 'DXB',
      depart: '2026-12-01',
    });
    expect(q).toBe('from=CAI&to=DXB&depart=2026-12-01&adults=1');
  });

  it('round-trips through parseSearch', () => {
    const values = {
      ...defaultValues(NOW),
      trip: 'round' as const,
      from: 'CAI',
      to: 'DXB',
      depart: '2026-12-01',
      return: '2026-12-08',
      adults: 2,
      infants: 1,
      cabin: 'ECONOMY' as const,
      maxPrice: '400',
      sort: 'duration' as const,
    };
    const params = Object.fromEntries(
      new URLSearchParams(toQueryString(values, { page: 2 })),
    );
    const parsed = parseSearch(params, NOW);
    expect(parsed.status === 'ok' && parsed.search).toMatchObject({
      ...values,
      page: 2,
      returnPage: 1,
    });
  });
});

describe('helpers', () => {
  it('adds days across a month end', () => {
    expect(addDays('2026-11-30', 2)).toBe('2026-12-02');
  });

  it('maps API field names onto form fields', () => {
    expect(apiFieldToFormField('maxPriceMinor')).toBe('maxPrice');
    expect(apiFieldToFormField('departureDate')).toBe('depart');
    expect(apiFieldToFormField('nonsense')).toBeNull();
  });
});
