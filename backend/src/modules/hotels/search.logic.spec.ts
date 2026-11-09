import {
  canHostParty,
  cheapestNightlyPrice,
  sortHotels,
  validateTiers,
} from './search.logic';

const room = (maxOccupancy: number, priceMinor = 10000) => ({
  maxOccupancy,
  priceMinor,
});

describe('canHostParty (HTL-11)', () => {
  it('needs at least `rooms` free rooms', () => {
    expect(canHostParty([room(4)], 2, 2)).toBe(false);
    expect(canHostParty([room(2), room(2)], 2, 2)).toBe(true);
  });

  it('adds up the occupancy of the roomiest rooms', () => {
    expect(canHostParty([room(2), room(2)], 2, 5)).toBe(false);
    expect(canHostParty([room(2), room(3)], 2, 5)).toBe(true);
    expect(canHostParty([room(1), room(1), room(4)], 2, 5)).toBe(true);
    expect(canHostParty([room(1), room(1), room(4)], 1, 5)).toBe(false);
  });

  it('is false for no free rooms', () => {
    expect(canHostParty([], 1, 1)).toBe(false);
  });
});

describe('cheapestNightlyPrice', () => {
  it('returns the lowest nightly price', () => {
    expect(cheapestNightlyPrice([room(2, 9000), room(2, 7000)])).toBe(7000);
  });
});

describe('sortHotels (HTL-12)', () => {
  const hotels = [
    { id: '1', name: 'B', startingPriceMinor: 200, ratingAvg: 4.5 },
    { id: '2', name: 'A', startingPriceMinor: 100, ratingAvg: null },
    { id: '3', name: 'C', startingPriceMinor: 300, ratingAvg: 4.9 },
    { id: '4', name: 'D', startingPriceMinor: 100, ratingAvg: 3 },
  ];

  it('sorts by price ascending by default, ties by name', () => {
    expect(sortHotels(hotels, 'price').map((h) => h.id)).toEqual([
      '2',
      '4',
      '1',
      '3',
    ]);
  });

  it('sorts by price descending on request', () => {
    expect(sortHotels(hotels, 'price', 'desc').map((h) => h.id)).toEqual([
      '3',
      '1',
      '2',
      '4',
    ]);
  });

  it('sorts by rating descending by default with unrated hotels last', () => {
    expect(sortHotels(hotels, 'rating').map((h) => h.id)).toEqual([
      '3',
      '1',
      '4',
      '2',
    ]);
  });

  it('keeps unrated hotels last even for ascending ratings', () => {
    expect(sortHotels(hotels, 'rating', 'asc').map((h) => h.id)).toEqual([
      '4',
      '1',
      '3',
      '2',
    ]);
  });

  it('does not mutate the input', () => {
    const copy = [...hotels];
    sortHotels(hotels, 'price');
    expect(hotels).toEqual(copy);
  });
});

describe('validateTiers (HTL-10)', () => {
  it('accepts an empty list and a well-formed ladder', () => {
    expect(validateTiers([])).toBeNull();
    expect(
      validateTiers([
        { daysBefore: 14, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 2, refundPercent: 0 },
      ]),
    ).toBeNull();
  });

  it('accepts equal percentages across tiers', () => {
    expect(
      validateTiers([
        { daysBefore: 10, refundPercent: 50 },
        { daysBefore: 3, refundPercent: 50 },
      ]),
    ).toBeNull();
  });

  it('rejects two tiers with the same daysBefore', () => {
    expect(
      validateTiers([
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 7, refundPercent: 25 },
      ]),
    ).toMatch(/daysBefore = 7/);
  });

  it('rejects a later cancellation that refunds more than an earlier one', () => {
    expect(
      validateTiers([
        { daysBefore: 14, refundPercent: 50 },
        { daysBefore: 3, refundPercent: 80 },
      ]),
    ).toMatch(/cannot exceed/);
  });

  it('judges order by daysBefore, not by input order', () => {
    expect(
      validateTiers([
        { daysBefore: 3, refundPercent: 20 },
        { daysBefore: 14, refundPercent: 100 },
      ]),
    ).toBeNull();
  });
});
