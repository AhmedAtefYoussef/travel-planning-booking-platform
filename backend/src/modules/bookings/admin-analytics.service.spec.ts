import { Types } from 'mongoose';
import { BookingType } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import {
  AdminAnalyticsService,
  assertPeriod,
  totalsOf,
} from './admin-analytics.service';

const AIRLINE_A = new Types.ObjectId();
const AIRLINE_B = new Types.ObjectId();
const HOTEL = new Types.ObjectId();
const GONE = new Types.ObjectId();
const oid = () => new Types.ObjectId();

const group = (
  type: BookingType,
  providerId: Types.ObjectId,
  over: Partial<{
    bookings: number;
    cancelledBookings: number;
    grossRevenueMinor: number;
    refundableIds: Types.ObjectId[];
    currency: string;
  }> = {},
) => ({
  _id: { type, providerId, currency: over.currency ?? 'EGP' },
  bookings: over.bookings ?? 0,
  cancelledBookings: over.cancelledBookings ?? 0,
  grossRevenueMinor: over.grossRevenueMinor ?? 0,
  refundableIds: over.refundableIds ?? [],
});

function build(groups: object[]) {
  const pipelines: { model: string; pipeline: unknown[] }[] = [];
  const model = (name: string) => ({
    aggregate: jest.fn((pipeline: unknown[]) => {
      pipelines.push({ model: name, pipeline });
      return { exec: () => Promise.resolve(groups) };
    }),
  });
  const directory = (known: [Types.ObjectId, string][]) => ({
    findMany: jest.fn((ids: string[]) =>
      Promise.resolve(
        known
          .filter(([id]) => ids.includes(id.toHexString()))
          .map(([id, name]) => ({
            id: id.toHexString(),
            name,
            isActive: true,
          })),
      ),
    ),
  });
  const refunds = {
    refundedMinorFor: jest.fn(
      (_type: BookingType, ids: string[]): Promise<Map<string, number>> =>
        Promise.resolve(
          new Map(ids.filter((_, i) => i % 2 === 0).map((id) => [id, 1_000])),
        ),
    ),
  };
  const airlines = directory([
    [AIRLINE_A, 'Alpha Air'],
    [AIRLINE_B, 'Beta Air'],
  ]);
  const hotels = directory([[HOTEL, 'Nile Hotel']]);
  const service = new AdminAnalyticsService(
    model('flights') as never,
    model('hotels') as never,
    airlines as never,
    hotels as never,
    refunds as never,
  );
  return { service, pipelines, refunds, airlines, hotels };
}

describe('assertPeriod (BON-01)', () => {
  it('accepts one day and exactly 366 days', () => {
    expect(() => assertPeriod('2028-06-01', '2028-06-01')).not.toThrow();
    expect(() => assertPeriod('2028-01-01', '2028-12-31')).not.toThrow();
  });

  it('rejects a reversed period on the "to" field', () => {
    expect.assertions(2);
    try {
      assertPeriod('2028-06-02', '2028-06-01');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationFailedException);
      expect((e as ValidationFailedException).getResponse()).toMatchObject({
        fieldErrors: [{ field: 'to', message: 'to must be on or after from' }],
      });
    }
  });

  it('rejects more than 366 days', () => {
    expect(() => assertPeriod('2028-01-01', '2029-01-01')).toThrow(
      ValidationFailedException,
    );
    expect(() => assertPeriod('2027-01-01', '2028-01-02')).toThrow(
      ValidationFailedException,
    );
  });
});

describe('AdminAnalyticsService (BON-01)', () => {
  const query = { from: '2028-06-01', to: '2028-06-30' };

  it('computes confirmed, gross, refunded and net per provider, best net first', async () => {
    const [c1, c2, c3] = [oid(), oid(), oid()];
    const { service, refunds } = build([
      group(BookingType.Flight, AIRLINE_A, {
        bookings: 5,
        cancelledBookings: 3,
        grossRevenueMinor: 500_000,
        // refunds mock returns 1000 for the 1st and 3rd id
        refundableIds: [c1, c2, c3],
      }),
      group(BookingType.Flight, AIRLINE_B, {
        bookings: 2,
        grossRevenueMinor: 900_000,
      }),
      group(BookingType.Hotel, HOTEL, {
        bookings: 1,
        cancelledBookings: 1,
        grossRevenueMinor: 100_000,
      }),
    ]);
    const res = await service.analytics(query);
    expect(res.period).toEqual({ ...query, type: null });
    expect(res.providers).toEqual([
      {
        providerType: 'AIRLINE',
        providerId: AIRLINE_B.toHexString(),
        providerName: 'Beta Air',
        bookings: 2,
        confirmedBookings: 2,
        cancelledBookings: 0,
        grossRevenueMinor: 900_000,
        refundedMinor: 0,
        netRevenueMinor: 900_000,
        currency: 'EGP',
      },
      {
        providerType: 'AIRLINE',
        providerId: AIRLINE_A.toHexString(),
        providerName: 'Alpha Air',
        bookings: 5,
        confirmedBookings: 2,
        cancelledBookings: 3,
        grossRevenueMinor: 500_000,
        refundedMinor: 2_000,
        netRevenueMinor: 498_000,
        currency: 'EGP',
      },
      {
        providerType: 'HOTEL',
        providerId: HOTEL.toHexString(),
        providerName: 'Nile Hotel',
        bookings: 1,
        confirmedBookings: 0,
        cancelledBookings: 1,
        grossRevenueMinor: 100_000,
        refundedMinor: 0,
        netRevenueMinor: 100_000,
        currency: 'EGP',
      },
    ]);
    expect(res.totals).toEqual([
      {
        bookings: 8,
        confirmedBookings: 4,
        cancelledBookings: 4,
        grossRevenueMinor: 1_500_000,
        refundedMinor: 2_000,
        netRevenueMinor: 1_498_000,
        currency: 'EGP',
      },
    ]);
    expect(refunds.refundedMinorFor).toHaveBeenCalledWith(
      BookingType.Flight,
      [c1, c2, c3].map((i) => i.toHexString()),
    );
  });

  it('names a provider missing from the directory and keeps it', async () => {
    const { service } = build([
      group(BookingType.Flight, GONE, { bookings: 1, grossRevenueMinor: 10 }),
      group(BookingType.Hotel, GONE, { bookings: 1, grossRevenueMinor: 5 }),
    ]);
    const res = await service.analytics(query);
    expect(res.providers.map((p) => p.providerName)).toEqual([
      'Unknown airline',
      'Unknown hotel',
    ]);
  });

  it('keeps currencies apart in the totals', () => {
    const base = {
      bookings: 1,
      confirmedBookings: 1,
      cancelledBookings: 0,
      grossRevenueMinor: 100,
      refundedMinor: 0,
      netRevenueMinor: 100,
    };
    expect(
      totalsOf([
        { ...base, currency: 'EGP' },
        { ...base, currency: 'USD' },
        { ...base, currency: 'EGP' },
      ]),
    ).toEqual([
      {
        ...base,
        bookings: 2,
        confirmedBookings: 2,
        grossRevenueMinor: 200,
        netRevenueMinor: 200,
        currency: 'EGP',
      },
      { ...base, currency: 'USD' },
    ]);
    expect(totalsOf([])).toEqual([]);
  });

  it('returns empty providers and totals for an empty period, without calling the directories', async () => {
    const { service, airlines, hotels } = build([]);
    const res = await service.analytics(query);
    expect(res).toEqual({
      period: { ...query, type: null },
      providers: [],
      totals: [],
    });
    expect(airlines.findMany).not.toHaveBeenCalled();
    expect(hotels.findMany).not.toHaveBeenCalled();
  });

  it('runs one aggregation: counted statuses and travel overlap only, on the right collection', async () => {
    const all = build([]);
    await all.service.analytics(query);
    expect(all.pipelines).toHaveLength(1);
    expect(all.pipelines[0].model).toBe('flights');
    const [match, , union] = all.pipelines[0].pipeline as {
      $match?: Record<string, unknown>;
      $unionWith?: unknown;
    }[];
    expect(match.$match).toEqual({
      endsAt: { $gt: new Date('2028-06-01T00:00:00Z') },
      startsAt: { $lt: new Date('2028-07-01T00:00:00Z') },
      status: { $in: ['CONFIRMED', 'COMPLETED', 'CANCELLED'] },
    });
    expect(union.$unionWith).toBeDefined();

    const hotels = build([]);
    await hotels.service.analytics({ ...query, type: BookingType.Hotel });
    expect(hotels.pipelines).toHaveLength(1);
    expect(hotels.pipelines[0].model).toBe('hotels');
    expect(
      JSON.stringify(hotels.pipelines[0].pipeline).includes('unionWith'),
    ).toBe(false);
  });

  it('rejects a bad period before touching the database', async () => {
    const { service, pipelines } = build([]);
    await expect(
      service.analytics({ from: '2028-06-30', to: '2028-06-01' }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
    expect(pipelines).toHaveLength(0);
  });
});
