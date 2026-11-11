import {
  infantFareMinor,
  partyFareMinor,
  passengerMixErrors,
  passengerTypeFor,
  PassengerType,
  seatsFor,
} from './passengers.contract';

describe('passenger types (FLT-12)', () => {
  describe('passengerTypeFor', () => {
    it.each([
      ['2014-12-01', PassengerType.Adult, '12th birthday on the travel day'],
      ['2014-12-02', PassengerType.Child, 'one day short of 12'],
      ['2024-12-01', PassengerType.Child, '2nd birthday on the travel day'],
      ['2024-12-02', PassengerType.Infant, 'one day short of 2'],
      ['2026-12-01', PassengerType.Infant, 'born on the travel day'],
      ['1950-01-01', PassengerType.Adult, 'older adult'],
    ])('born %s -> %s (%s)', (dob, type) => {
      expect(passengerTypeFor(dob, '2026-12-01')).toBe(type);
    });

    it('someone born on 29 February is a year older on 1 March of a common year', () => {
      expect(passengerTypeFor('2024-02-29', '2026-02-28')).toBe(
        PassengerType.Infant,
      );
      expect(passengerTypeFor('2024-02-29', '2026-03-01')).toBe(
        PassengerType.Child,
      );
    });

    it('rejects a birth date after the travel date and malformed dates', () => {
      expect(() => passengerTypeFor('2026-12-02', '2026-12-01')).toThrow(
        'must not be after the travel date',
      );
      expect(() => passengerTypeFor('2026-02-30', '2026-12-01')).toThrow(
        'not a valid YYYY-MM-DD date',
      );
      expect(() => passengerTypeFor('01/02/2000', '2026-12-01')).toThrow();
    });
  });

  describe('party rules', () => {
    it('counts a seat for every adult and child but not for infants', () => {
      expect(seatsFor({ adults: 2, children: 1, infants: 2 })).toBe(3);
    });

    it('accepts one adult alone and as many infants as adults', () => {
      expect(
        passengerMixErrors({ adults: 1, children: 0, infants: 0 }),
      ).toEqual([]);
      expect(
        passengerMixErrors({ adults: 2, children: 3, infants: 2 }),
      ).toEqual([]);
    });

    it('needs at least one adult and no more infants than adults', () => {
      expect(
        passengerMixErrors({ adults: 0, children: 2, infants: 1 }),
      ).toEqual([
        {
          field: 'adults',
          message: 'Each booking needs at least one adult (12 or older)',
        },
        {
          field: 'infants',
          message: 'No more infants than adults: 1 infant(s) for 0 adult(s)',
        },
      ]);
      expect(
        passengerMixErrors(
          { adults: 1, children: 0, infants: 2 },
          { adults: 'passengers', children: 'children', infants: 'passengers' },
        ),
      ).toEqual([
        {
          field: 'passengers',
          message: 'No more infants than adults: 2 infant(s) for 1 adult(s)',
        },
      ]);
    });
  });

  it('rejects counts that are not whole, safe and non-negative, before the party rules', () => {
    expect(
      passengerMixErrors({ adults: 1, children: -1, infants: 0.5 }),
    ).toEqual([
      {
        field: 'children',
        message: 'children must be a whole number of 0 or more',
      },
      {
        field: 'infants',
        message: 'infants must be a whole number of 0 or more',
      },
    ]);
    expect(
      passengerMixErrors({ adults: Number.NaN, children: 0, infants: 0 }),
    ).toEqual([
      {
        field: 'adults',
        message: 'adults must be a whole number of 0 or more',
      },
    ]);
    expect(
      passengerMixErrors({ adults: 2 ** 53, children: 0, infants: 0 }),
    ).toHaveLength(1);
  });

  describe('fares', () => {
    it('an infant pays 10% of the fare, rounded down', () => {
      expect(infantFareMinor(27500)).toBe(2750);
      expect(infantFareMinor(27509)).toBe(2750);
      expect(infantFareMinor(9)).toBe(0);
    });

    it('the party pays seats x fare plus infants x 10%', () => {
      // 2 adults + 1 child + 1 infant on a 275.00 fare: 3 x 275.00 + 27.50 = 852.50
      expect(
        partyFareMinor(27500, { adults: 2, children: 1, infants: 1 }),
      ).toBe(85250);
      expect(
        partyFareMinor(27500, { adults: 1, children: 0, infants: 0 }),
      ).toBe(27500);
    });
  });
});
