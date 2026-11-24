import { describe, expect, it } from 'vitest';
import {
  baggageSchema,
  cabinChanges,
  cabinSchema,
  createFlightSchema,
  flightChanges,
  logoProblem,
  profileSchema,
  refundFor,
  tiersSchema,
  toInputLocal,
  toMajorText,
} from './forms';

const cents = (n: number) => Math.round(n * 100);

const messages = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  Object.fromEntries(
    (r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
  );

describe('profile and logo (FLT-01, GEN-08)', () => {
  it('trims and upper-cases the code', () => {
    expect(profileSchema.parse({ name: ' EgyptAir ', code: 'ms' })).toEqual({
      name: 'EgyptAir',
      code: 'MS',
    });
  });

  it('refuses a bad code and a short name', () => {
    const r = profileSchema.safeParse({ name: 'E', code: 'EGYPT' });
    expect(Object.keys(messages(r)).sort()).toEqual(['code', 'name']);
  });

  it('accepts JPG/PNG up to 5 MB only', () => {
    expect(
      logoProblem({ type: 'image/png', size: 5 * 1024 * 1024 }),
    ).toBeNull();
    expect(
      logoProblem({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }),
    ).toMatch(/5 MB/);
    expect(logoProblem({ type: 'application/pdf', size: 10 })).toMatch(
      /JPG or PNG/,
    );
  });
});

describe('baggage (FLT-08)', () => {
  it('sends the price in minor units', () => {
    expect(baggageSchema(cents).parse({ price: '40.5', maxBags: '2' })).toEqual(
      {
        price: 4050,
        maxBags: 2,
      },
    );
  });

  it('refuses a free extra bag and a fractional count', () => {
    const r = baggageSchema(cents).safeParse({ price: '0', maxBags: '1.5' });
    expect(Object.keys(messages(r)).sort()).toEqual(['maxBags', 'price']);
  });
});

describe('cancellation tiers (FLT-09)', () => {
  it('accepts up to two decimals and an empty list', () => {
    expect(
      tiersSchema.parse({
        tiers: [{ daysBefore: '7', refundPercent: '50.25' }],
      }),
    ).toEqual({ tiers: [{ daysBefore: 7, refundPercent: 50.25 }] });
    expect(tiersSchema.parse({ tiers: [] })).toEqual({ tiers: [] });
  });

  it('flags a repeated threshold on the second row and a refund above 100%', () => {
    const r = tiersSchema.safeParse({
      tiers: [
        { daysBefore: '7', refundPercent: '50' },
        { daysBefore: '7', refundPercent: '120' },
      ],
    });
    expect(messages(r)).toMatchObject({
      'tiers.1.daysBefore': expect.stringMatching(/already used/),
      'tiers.1.refundPercent': expect.stringMatching(/0 to 100/),
    });
  });

  it('applies the highest threshold not above the days left', () => {
    const tiers = [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 1, refundPercent: 25 },
    ];
    expect(refundFor(tiers, 10)).toBe(50);
    expect(refundFor(tiers, 7)).toBe(50);
    expect(refundFor(tiers, 0)).toBe(0);
    expect(refundFor([], 100)).toBe(0);
  });
});

describe('flights (FLT-03, FLT-05)', () => {
  const ok = {
    flightNumber: 'ms777',
    from: 'CAI',
    to: 'DXB',
    departureLocal: '2027-12-01T14:30',
    arrivalLocal: '2027-12-01T18:45',
  };

  it('normalises the flight number', () => {
    expect(createFlightSchema.parse(ok).flightNumber).toBe('MS777');
  });

  it('refuses the same airport twice and a missing time', () => {
    const r = createFlightSchema.safeParse({
      ...ok,
      to: 'CAI',
      arrivalLocal: '',
    });
    expect(Object.keys(messages(r)).sort()).toEqual(['arrivalLocal', 'to']);
  });

  it('sends only the changed fields', () => {
    const before = {
      from: 'CAI',
      to: 'DXB',
      departureLocal: 'a',
      arrivalLocal: 'b',
    };
    expect(flightChanges(before, { ...before, arrivalLocal: 'c' })).toEqual({
      arrivalLocal: 'c',
    });
  });

  it('turns an API local time into a datetime-local value', () => {
    expect(toInputLocal('2027-12-01T14:30:00.000+02:00')).toBe(
      '2027-12-01T14:30',
    );
  });
});

describe('cabins (FLT-04)', () => {
  it('parses the form and sends only what changed', () => {
    const parsed = cabinSchema(cents).parse({
      class: 'ECONOMY',
      totalSeats: '150',
      price: '275',
      freeBags: '1',
      maxKgPerBag: '23',
    });
    expect(parsed).toEqual({
      class: 'ECONOMY',
      totalSeats: 150,
      price: 27500,
      freeBags: 1,
      maxKgPerBag: 23,
    });
    expect(
      cabinChanges(
        { totalSeats: 150, priceMinor: 25000, freeBags: 1, maxKgPerBag: 23 },
        parsed,
      ),
    ).toEqual({ priceMinor: 27500 });
  });

  it('refuses zero seats and a weight over 100 kg', () => {
    const r = cabinSchema(cents).safeParse({
      class: 'ECONOMY',
      totalSeats: '0',
      price: '10',
      freeBags: '0',
      maxKgPerBag: '101',
    });
    expect(Object.keys(messages(r)).sort()).toEqual([
      'maxKgPerBag',
      'totalSeats',
    ]);
  });

  it('shows minor units as editable text', () => {
    expect(toMajorText(27550, 2)).toBe('275.50');
    expect(toMajorText(1234, 0)).toBe('1234');
  });
});
