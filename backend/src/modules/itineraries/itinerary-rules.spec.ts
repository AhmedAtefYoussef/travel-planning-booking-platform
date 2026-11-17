import {
  groupConsecutiveDaysByCity,
  itineraryDayDate,
} from './itinerary-rules';

describe('itinerary rules', () => {
  it('derives one-based day dates with the shared date helper, including month and year changes', () => {
    expect(itineraryDayDate('2026-12-31', 1)).toBe('2026-12-31');
    expect(itineraryDayDate('2026-12-31', 2)).toBe('2027-01-01');
  });

  it.each([0, 1.5, 61])('rejects invalid day order %p', (order) => {
    expect(() => itineraryDayDate('2026-12-01', order)).toThrow(RangeError);
  });

  it('preserves day order and groups only adjacent days in the same city', () => {
    const days = [
      { order: 4, cityId: 'cairo', label: 'return' },
      { order: 2, cityId: 'cairo', label: 'second' },
      { order: 1, cityId: 'cairo', label: 'first' },
      { order: 3, cityId: 'luxor', label: 'visit' },
    ];

    expect(groupConsecutiveDaysByCity(days)).toEqual([
      {
        cityId: 'cairo',
        days: [days[2], days[1]],
      },
      { cityId: 'luxor', days: [days[3]] },
      { cityId: 'cairo', days: [days[0]] },
    ]);
  });
});
