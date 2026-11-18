import { Types } from 'mongoose';
import {
  sumByCurrency,
  toItineraryDto,
  type ActivityLike,
  type ItineraryLike,
} from './itinerary-view';
import { ItineraryVisibility } from './schemas/itinerary.schema';

const day = (order: number, cityId: string) => ({
  _id: new Types.ObjectId(),
  order,
  cityId,
  notes: '',
});

function itinerary(days: ReturnType<typeof day>[]): ItineraryLike {
  return {
    _id: new Types.ObjectId(),
    ownerId: new Types.ObjectId(),
    title: 'View test',
    countries: ['EG'],
    startDate: '2027-01-30',
    visibility: ItineraryVisibility.Private,
    days,
    isHidden: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('itinerary view (ITN-03, ITN-05, ITN-09)', () => {
  it('sums amounts per currency, sorted by code', () => {
    expect(
      sumByCurrency([
        { currency: 'USD', amountMinor: 5 },
        { currency: 'EGP', amountMinor: 10 },
        { currency: 'USD', amountMinor: 7 },
      ]),
    ).toEqual([
      { currency: 'EGP', amountMinor: 10 },
      { currency: 'USD', amountMinor: 12 },
    ]);
    expect(sumByCurrency([])).toEqual([]);
  });

  it('orders days by number, derives dates and groups consecutive cities with subtotals', () => {
    // Stored out of order on purpose: the view sorts by day number.
    const days = [day(3, 'cairo'), day(1, 'cairo'), day(2, 'luxor')];
    const it = itinerary(days);
    const activity = (dayId: Types.ObjectId, cost?: number): ActivityLike =>
      ({
        _id: new Types.ObjectId(),
        itineraryId: it._id,
        dayId,
        name: 'A',
        description: 'B',
        images: [],
        ...(cost !== undefined ? { costMinor: cost, currency: 'EGP' } : {}),
      }) as unknown as ActivityLike;
    const dto = toItineraryDto(it, {
      activities: [activity(days[1]._id, 100), activity(days[1]._id)],
      cityNames: new Map([['cairo', 'Cairo']]),
      dayBudgets: new Map([
        [days[0]._id.toHexString(), [{ currency: 'EGP', amountMinor: 50 }]],
      ]),
    });
    expect(dto.days.map((d) => [d.dayNumber, d.date, d.cityName])).toEqual([
      [1, '2027-01-30', 'Cairo'],
      [2, '2027-01-31', null],
      [3, '2027-02-01', 'Cairo'],
    ]);
    expect(dto.endDate).toBe('2027-02-01');
    expect(dto.days[0].activities[1]).toMatchObject({
      costMinor: null,
      currency: null,
      time: null,
    });
    expect(
      dto.cityGroups.map((g) => [g.cityId, g.fromDay, g.toDay, g.subtotals]),
    ).toEqual([
      ['cairo', 1, 1, [{ currency: 'EGP', amountMinor: 100 }]],
      ['luxor', 2, 2, []],
      ['cairo', 3, 3, [{ currency: 'EGP', amountMinor: 50 }]],
    ]);
  });

  it('an itinerary without days has no end date and no groups', () => {
    const dto = toItineraryDto(itinerary([]), {
      activities: [],
      cityNames: new Map(),
    });
    expect(dto).toMatchObject({ endDate: null, days: [], cityGroups: [] });
  });
});
