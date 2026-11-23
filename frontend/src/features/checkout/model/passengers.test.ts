import { describe, expect, it } from 'vitest';
import {
  baggageLimits,
  isRealDate,
  parseFlightSelection,
  passengerFormSchema,
  passengerSlots,
  passengerType,
  toBookingBody,
  type FlightSelection,
  type LegInfo,
} from './passengers';

const ID_A = 'a'.repeat(24);
const ID_B = 'b'.repeat(24);
const LEG = `${ID_A}:${ID_B}`;

describe('passengerType', () => {
  it('treats the day before the 2nd birthday as an infant', () => {
    expect(passengerType('2024-06-15', '2026-06-14')).toBe('INFANT');
  });
  it('treats the 2nd birthday as a child', () => {
    expect(passengerType('2024-06-15', '2026-06-15')).toBe('CHILD');
  });
  it('treats the 12th birthday as an adult and the day before as a child', () => {
    expect(passengerType('2014-06-15', '2026-06-14')).toBe('CHILD');
    expect(passengerType('2014-06-15', '2026-06-15')).toBe('ADULT');
  });
  it('has not had a 29 Feb birthday on 28 Feb of a non-leap year', () => {
    expect(passengerType('2024-02-29', '2026-02-28')).toBe('INFANT');
    expect(passengerType('2024-02-29', '2026-03-01')).toBe('CHILD');
  });
});

describe('isRealDate', () => {
  it('accepts real dates and rejects impossible or malformed ones', () => {
    expect(isRealDate('2024-02-29')).toBe(true);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-2-3')).toBe(false);
    expect(isRealDate('')).toBe(false);
  });
});

describe('parseFlightSelection', () => {
  it('parses a one-way selection with one adult by default', () => {
    expect(parseFlightSelection({ outbound: LEG })).toEqual({
      ok: true,
      selection: {
        outbound: { flightId: ID_A, cabinId: ID_B },
        counts: { ADULT: 1, CHILD: 0, INFANT: 0 },
      },
    });
  });
  it('parses a round trip with counts', () => {
    const r = parseFlightSelection({
      outbound: LEG,
      return: `${ID_B}:${ID_A}`,
      adults: '2',
      children: '1',
      infants: '1',
    });
    expect(r).toMatchObject({
      ok: true,
      selection: {
        return: { flightId: ID_B, cabinId: ID_A },
        counts: { ADULT: 2, CHILD: 1, INFANT: 1 },
      },
    });
  });
  it.each([
    ['a bad id', { outbound: 'nope:nope' }],
    ['a missing outbound', {}],
    ['a leg with three parts', { outbound: `${LEG}:${ID_A}` }],
    ['a bad return leg', { outbound: LEG, return: 'x:y' }],
    ['more infants than adults', { outbound: LEG, adults: '1', infants: '2' }],
    ['ten passengers', { outbound: LEG, adults: '10' }],
    ['zero adults', { outbound: LEG, adults: '0', children: '1' }],
    ['a non-numeric count', { outbound: LEG, adults: 'two' }],
  ])('rejects %s', (_, params) => {
    expect(parseFlightSelection(params).ok).toBe(false);
  });
  it('uses the first value of an array param', () => {
    const r = parseFlightSelection({
      outbound: [LEG, 'junk'],
      adults: ['3', '1'],
    });
    expect(r).toMatchObject({ ok: true, selection: { counts: { ADULT: 3 } } });
  });
});

describe('passengerSlots', () => {
  it('lists adults, then children, then infants', () => {
    expect(passengerSlots({ ADULT: 2, CHILD: 1, INFANT: 1 })).toEqual([
      'ADULT',
      'ADULT',
      'CHILD',
      'INFANT',
    ]);
  });
});

const leg = (over: Partial<LegInfo> = {}): LegInfo => ({
  departureLocalDate: '2026-12-10',
  maxKgPerBag: 23,
  maxExtraBagsPerPassenger: 3,
  ...over,
});

describe('baggageLimits', () => {
  it('takes the smallest allowance across legs', () => {
    expect(
      baggageLimits([
        leg(),
        leg({ maxKgPerBag: 20, maxExtraBagsPerPassenger: 2 }),
      ]),
    ).toEqual({ maxBags: 2, maxKgPerBag: 20 });
  });
  it('treats a leg without extra bags as zero', () => {
    expect(
      baggageLimits([leg(), leg({ maxExtraBagsPerPassenger: null })]).maxBags,
    ).toBe(0);
  });
});

const adult = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-05-05',
  documentNumber: 'AB12345',
  extraBags: '',
  extraBagsWeightKg: '',
};

describe('passengerFormSchema', () => {
  const schema = passengerFormSchema([leg()], '2026-11-24');
  const parse = (...passengers: Record<string, unknown>[]) =>
    schema.safeParse({ passengers });
  const paths = (r: ReturnType<typeof parse>) =>
    r.success ? [] : r.error.issues.map((i) => i.path.join('.'));

  it('accepts a valid passenger', () => {
    expect(parse(adult).success).toBe(true);
  });
  it('rejects a bad document number', () => {
    expect(paths(parse({ ...adult, documentNumber: 'AB 1' }))).toContain(
      'passengers.0.documentNumber',
    );
  });
  it('rejects a date of birth in the future', () => {
    expect(
      paths(
        parse(adult, {
          ...adult,
          documentNumber: 'ZZ99999',
          dateOfBirth: '2027-01-01',
        }),
      ),
    ).toContain('passengers.1.dateOfBirth');
  });
  it('rejects extra bags above the cap', () => {
    expect(
      paths(parse({ ...adult, extraBags: '4', extraBagsWeightKg: '50' })),
    ).toContain('passengers.0.extraBags');
  });
  it('requires a weight when bags are chosen', () => {
    expect(paths(parse({ ...adult, extraBags: '1' }))).toContain(
      'passengers.0.extraBagsWeightKg',
    );
  });
  it('keeps the weight within one kg per bag and the per-bag maximum', () => {
    expect(
      paths(parse({ ...adult, extraBags: '2', extraBagsWeightKg: '1' })),
    ).toContain('passengers.0.extraBagsWeightKg');
    expect(
      paths(parse({ ...adult, extraBags: '2', extraBagsWeightKg: '47' })),
    ).toContain('passengers.0.extraBagsWeightKg');
    expect(
      parse({ ...adult, extraBags: '2', extraBagsWeightKg: '46' }).success,
    ).toBe(true);
  });
  it('flags a duplicate document number on the second passenger, ignoring case', () => {
    const r = parse(adult, {
      ...adult,
      firstName: 'Bob',
      documentNumber: 'ab12345',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path)).toContainEqual([
        'passengers',
        1,
        'documentNumber',
      ]);
    }
  });
  it('reports a composition error on the list when only infants travel', () => {
    const r = parse({ ...adult, dateOfBirth: '2026-01-01' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path)).toContainEqual(['passengers']);
    }
  });
  it('rejects a passenger who changes age group between the two flights', () => {
    const roundTrip = passengerFormSchema(
      [leg(), leg({ departureLocalDate: '2026-12-20' })],
      '2026-11-24',
    );
    const r = roundTrip.safeParse({
      passengers: [
        adult,
        { ...adult, documentNumber: 'CD67890', dateOfBirth: '2024-12-15' },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path)).toContainEqual([
        'passengers',
        1,
        'dateOfBirth',
      ]);
    }
  });
});

describe('toBookingBody', () => {
  const selection: FlightSelection = {
    outbound: { flightId: ID_A, cabinId: ID_B },
    counts: { ADULT: 2, CHILD: 0, INFANT: 0 },
  };
  const schema = passengerFormSchema([leg()], '2026-11-24');

  it('derives the type from the date of birth and sends 0 bags without a weight', () => {
    const parsed = schema.parse({
      passengers: [
        { ...adult, firstName: ' Ada ' },
        {
          ...adult,
          documentNumber: 'CD67890',
          dateOfBirth: '2020-01-01',
          extraBags: '0',
        },
      ],
    });
    const body = toBookingBody(selection, parsed, '2026-12-10');
    expect(body.passengers.map((p) => p.type)).toEqual(['ADULT', 'CHILD']);
    expect(body.passengers[0].firstName).toBe('Ada');
    expect(body.passengers[1].extraBags).toBe(0);
    expect(body.passengers[1]).not.toHaveProperty('extraBagsWeightKg');
    expect(body).not.toHaveProperty('return');
  });
  it('includes extra bags and weight when bags are chosen', () => {
    const parsed = schema.parse({
      passengers: [{ ...adult, extraBags: '2', extraBagsWeightKg: '30' }],
    });
    expect(
      toBookingBody(selection, parsed, '2026-12-10').passengers[0],
    ).toMatchObject({
      extraBags: 2,
      extraBagsWeightKg: 30,
    });
  });
});
