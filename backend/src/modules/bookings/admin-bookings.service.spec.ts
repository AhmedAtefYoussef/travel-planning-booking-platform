import { Types } from 'mongoose';
import { BookingStatus, BookingType } from '../../common/contracts';
import { AdminBookingsService } from './admin-bookings.service';

const AIRLINE = new Types.ObjectId();
const HOTEL = new Types.ObjectId();
const USER = new Types.ObjectId();
const GONE = new Types.ObjectId();

const flightRow = {
  _id: new Types.ObjectId(),
  type: BookingType.Flight,
  reference: 'FL-7K3M9QX2',
  status: BookingStatus.Confirmed,
  userId: USER,
  providerId: AIRLINE,
  hotelName: null,
  segments: [
    { flightNumber: 'WA100', from: 'CAI', to: 'DXB' },
    { flightNumber: 'WA101', from: 'DXB', to: 'CAI' },
  ],
  roomNumbers: null,
  startsAt: new Date('2028-06-10T12:30:00Z'),
  endsAt: new Date('2028-06-17T20:00:00Z'),
  checkIn: null,
  checkOut: null,
  totalMinor: 200_000,
  currency: 'EGP',
  createdAt: new Date('2028-01-02T00:00:00Z'),
};
const hotelRow = {
  ...flightRow,
  _id: new Types.ObjectId(),
  type: BookingType.Hotel,
  reference: null,
  status: BookingStatus.PendingPayment,
  userId: GONE,
  providerId: HOTEL,
  hotelName: 'Admin View Hotel',
  segments: null,
  roomNumbers: ['101', '102'],
  checkIn: '2028-06-10',
  checkOut: '2028-06-12',
};

function service(
  items: object[] = [flightRow, hotelRow],
  total = items.length,
) {
  const pipelines: { model: string; pipeline: unknown[] }[] = [];
  const model = (name: string) => ({
    aggregate: jest.fn((pipeline: unknown[]) => {
      pipelines.push({ model: name, pipeline });
      return {
        exec: () =>
          Promise.resolve([{ items, total: total ? [{ n: total }] : [] }]),
      };
    }),
  });
  const airlines = {
    find: jest.fn((id: string) =>
      Promise.resolve(
        id === AIRLINE.toHexString()
          ? { id, name: 'Admin Air', isActive: true }
          : null,
      ),
    ),
  };
  const users = {
    findProfile: jest.fn((id: string) =>
      Promise.resolve(
        id === USER.toHexString()
          ? { name: 'Mona Adel', email: 'mona@example.com' }
          : null,
      ),
    ),
  };
  const svc = new AdminBookingsService(
    model('flights') as never,
    model('hotels') as never,
    airlines as never,
    users as never,
  );
  return { svc, pipelines, airlines };
}

describe('AdminBookingsService (ACC-17)', () => {
  it('reads both collections in one aggregation, newest first, 10 per page', async () => {
    const { svc, pipelines } = service();
    const page = await svc.list({ page: 3 });
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].model).toBe('flights');
    const stages = pipelines[0].pipeline as Record<string, unknown>[];
    expect(stages[0]).toEqual({ $match: {} });
    expect(stages[2]).toMatchObject({
      $unionWith: { coll: 'hotel_reservations' },
    });
    expect(stages[3]).toEqual({ $sort: { createdAt: -1, _id: -1 } });
    expect(stages[4]).toEqual({
      $facet: {
        items: [{ $skip: 20 }, { $limit: 10 }],
        total: [{ $count: 'n' }],
      },
    });
    expect(page).toMatchObject({ page: 3, limit: 10, total: 2, totalPages: 1 });
  });

  it('shows reference, user, provider, summary, dates, amount and status for each row', async () => {
    const { svc } = service();
    const page = await svc.list({ page: 1 });
    expect(page.items[0]).toEqual({
      id: flightRow._id.toHexString(),
      type: BookingType.Flight,
      reference: 'FL-7K3M9QX2',
      status: BookingStatus.Confirmed,
      user: {
        id: USER.toHexString(),
        name: 'Mona Adel',
        email: 'mona@example.com',
      },
      provider: {
        type: 'AIRLINE',
        id: AIRLINE.toHexString(),
        name: 'Admin Air',
      },
      summary: 'WA100 CAI -> DXB, WA101 DXB -> CAI',
      startsAt: flightRow.startsAt,
      endsAt: flightRow.endsAt,
      checkIn: null,
      checkOut: null,
      totalMinor: 200_000,
      currency: 'EGP',
      createdAt: flightRow.createdAt,
    });
    expect(page.items[1]).toMatchObject({
      type: BookingType.Hotel,
      reference: null,
      user: { id: GONE.toHexString(), name: 'Deleted user', email: null },
      provider: {
        type: 'HOTEL',
        id: HOTEL.toHexString(),
        name: 'Admin View Hotel',
      },
      summary: '2 room(s): 101, 102',
      checkIn: '2028-06-10',
      checkOut: '2028-06-12',
    });
  });

  it('filters by type: flights stay on flight_bookings, hotels run on hotel_reservations', async () => {
    const flights = service([flightRow]);
    await flights.svc.list({ page: 1, type: BookingType.Flight });
    expect(flights.pipelines[0].model).toBe('flights');
    expect(JSON.stringify(flights.pipelines[0].pipeline)).not.toContain(
      '$unionWith',
    );

    const hotels = service([hotelRow]);
    await hotels.svc.list({ page: 1, type: BookingType.Hotel });
    expect(hotels.pipelines[0].model).toBe('hotels');
    expect(JSON.stringify(hotels.pipelines[0].pipeline)).not.toContain(
      '$unionWith',
    );
    // No airline lookup for hotel rows.
    expect(hotels.airlines.find).not.toHaveBeenCalled();
  });

  it('filters by status and by trips overlapping the date range, both days included (UTC)', async () => {
    const { svc, pipelines } = service([]);
    const page = await svc.list({
      page: 1,
      status: BookingStatus.Cancelled,
      from: '2028-06-01',
      to: '2028-06-30',
    });
    expect(pipelines[0].pipeline[0]).toEqual({
      $match: {
        status: BookingStatus.Cancelled,
        endsAt: { $gt: new Date('2028-06-01T00:00:00Z') },
        startsAt: { $lt: new Date('2028-07-01T00:00:00Z') },
      },
    });
    expect(page).toMatchObject({ items: [], total: 0 });
  });

  it('rejects a range that ends before it starts with a 400 on "to" (GEN-02)', async () => {
    const { svc, pipelines } = service();
    await expect(
      svc.list({ page: 1, from: '2028-06-02', to: '2028-06-01' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'to', message: 'to must be on or after from' }],
    });
    expect(pipelines).toHaveLength(0);
    // A one-day range is valid.
    await expect(
      svc.list({ page: 1, from: '2028-06-02', to: '2028-06-02' }),
    ).resolves.toBeDefined();
  });
});
