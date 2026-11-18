import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { BookingStatus } from '../../common/contracts';
import { BookingGroup } from './booking-groups';
import { MyBookingsService } from './my-bookings.service';
import { PassengerType, TripType } from './schemas/flight-booking.schema';

const NOW = new Date('2027-11-01T08:00:00Z');
const USER: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.User,
};

/** A model whose find() chain returns `rows` and records the filter, sort and skip it was given. */
function fakeModel(rows: object[], total = rows.length) {
  const calls: { filter?: unknown; sort?: unknown; skip?: number } = {};
  interface Chain {
    sort(s: unknown): Chain;
    skip(n: number): Chain;
    limit(): Chain;
    lean(): Chain;
    exec(): Promise<object[]>;
  }
  const chain: Chain = {
    sort: (s) => {
      calls.sort = s;
      return chain;
    },
    skip: (n) => {
      calls.skip = n;
      return chain;
    },
    limit: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(rows),
  };
  const model = {
    find: (filter: unknown) => {
      calls.filter = filter;
      return chain;
    },
    countDocuments: () => ({ exec: () => Promise.resolve(total) }),
  };
  return { model, calls };
}

const AIRPORTS: Record<string, string> = {
  CAI: 'Africa/Cairo',
  DXB: 'Asia/Dubai',
};
const reference = {
  getAirport: jest.fn((code: string) =>
    Promise.resolve(
      AIRPORTS[code] ? { iataCode: code, timeZone: AIRPORTS[code] } : null,
    ),
  ),
};

const flightRow = (over: object = {}) => ({
  _id: new Types.ObjectId(),
  userId: new Types.ObjectId(USER.id),
  reference: 'FL-7K3M9QX2',
  status: BookingStatus.Confirmed,
  tripType: TripType.OneWay,
  segments: [
    {
      flightNumber: 'MS901',
      from: 'CAI',
      to: 'DXB',
      cabinClass: 'ECONOMY',
      departureUtc: new Date('2027-12-01T12:30:00Z'),
      arrivalUtc: new Date('2027-12-01T14:45:00Z'),
      seats: 1,
      fareMinor: 100_000,
    },
  ],
  passengers: [
    {
      type: PassengerType.Adult,
      firstName: 'Mona',
      lastName: 'Adel',
      dateOfBirth: '1990-05-01',
      documentNumber: 'A1234567',
    },
    {
      type: PassengerType.Infant,
      firstName: 'Lina',
      lastName: 'Adel',
      dateOfBirth: '2027-01-01',
      documentNumber: 'B7654321',
    },
  ],
  totalMinor: 110_000,
  currency: 'EGP',
  holdExpiresAt: new Date('2027-10-01T08:10:00Z'),
  startsAt: new Date('2027-12-01T12:30:00Z'),
  endsAt: new Date('2027-12-01T14:45:00Z'),
  createdAt: new Date('2027-10-01T08:00:00Z'),
  ...over,
});

const hotelRow = (over: object = {}) => ({
  _id: new Types.ObjectId(),
  userId: new Types.ObjectId(USER.id),
  reference: 'HT-7K3M9QX2',
  status: BookingStatus.Confirmed,
  hotelId: new Types.ObjectId(),
  hotelName: 'Nile View Hotel',
  checkIn: '2027-12-10',
  checkOut: '2027-12-13',
  nights: 3,
  rooms: [
    {
      roomId: new Types.ObjectId(),
      roomNumber: '101',
      adults: 2,
      childrenAges: [6],
    },
    {
      roomId: new Types.ObjectId(),
      roomNumber: '102',
      adults: 1,
      childrenAges: [],
    },
  ],
  totalMinor: 90_000,
  currency: 'EGP',
  holdExpiresAt: new Date('2027-10-01T08:10:00Z'),
  startsAt: new Date('2027-12-09T22:00:00Z'),
  endsAt: new Date('2027-12-13T22:00:00Z'),
  createdAt: new Date('2027-10-01T08:00:00Z'),
  ...over,
});

function service(flights: object[] = [], hotels: object[] = []) {
  const f = fakeModel(flights);
  const h = fakeModel(hotels);
  return {
    svc: new MyBookingsService(
      f.model as never,
      h.model as never,
      reference as never,
    ),
    flights: f,
    hotels: h,
  };
}

describe('MyBookingsService (FLT-25, HTL-20)', () => {
  beforeEach(() => reference.getAirport.mockClear());

  it('FLT-25 reads only the caller bookings of the group, sorted, 10 per page', async () => {
    const { svc, flights } = service([flightRow()]);
    const page = await svc.flightBookings(
      USER,
      { group: BookingGroup.Upcoming, page: 2 },
      NOW,
    );
    expect(flights.calls.filter).toEqual({
      userId: new Types.ObjectId(USER.id),
      $or: [
        { status: BookingStatus.Confirmed, endsAt: { $gt: NOW } },
        { status: BookingStatus.PendingPayment, holdExpiresAt: { $gt: NOW } },
      ],
    });
    expect(flights.calls.sort).toEqual({ startsAt: 1, _id: 1 });
    expect(flights.calls.skip).toBe(10);
    expect(page).toMatchObject({ page: 2, limit: 10, total: 1 });
  });

  it('FLT-25 shows reference, local times in each airport zone (GEN-06), cabin and passengers', async () => {
    const row = flightRow();
    const { svc } = service([row]);
    const page = await svc.flightBookings(
      USER,
      { group: BookingGroup.Upcoming, page: 1 },
      NOW,
    );
    expect(page.items[0]).toEqual({
      id: row._id.toHexString(),
      reference: 'FL-7K3M9QX2',
      status: BookingStatus.Confirmed,
      group: BookingGroup.Upcoming,
      tripType: TripType.OneWay,
      cabinClass: 'ECONOMY',
      segments: [
        expect.objectContaining({
          flightNumber: 'MS901',
          departureLocal: '2027-12-01T14:30:00.000+02:00',
          arrivalLocal: '2027-12-01T18:45:00.000+04:00',
          departureTimeZone: 'Africa/Cairo',
          arrivalTimeZone: 'Asia/Dubai',
        }),
      ],
      passengers: [
        { type: PassengerType.Adult, firstName: 'Mona', lastName: 'Adel' },
        { type: PassengerType.Infant, firstName: 'Lina', lastName: 'Adel' },
      ],
      passengerCount: 2,
      totalMinor: 110_000,
      currency: 'EGP',
      holdExpiresAt: null,
      createdAt: row.createdAt,
    });
    // One lookup per distinct airport, and no passport number in the list.
    expect(reference.getAirport).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(page.items[0])).not.toContain('A1234567');
  });

  it('FLT-25 lists a confirmed trip that has ended as PAST and COMPLETED', async () => {
    const { svc, flights } = service([
      flightRow({ endsAt: new Date(NOW.getTime() - 60_000) }),
    ]);
    const page = await svc.flightBookings(
      USER,
      { group: BookingGroup.Past, page: 1 },
      NOW,
    );
    expect(flights.calls.sort).toEqual({ startsAt: -1, _id: -1 });
    expect(page.items[0]).toMatchObject({
      status: BookingStatus.Completed,
      group: BookingGroup.Past,
    });
  });

  it('FLT-25 shows the hold end only while the booking is an unpaid hold', async () => {
    const holdEnds = new Date(NOW.getTime() + 5 * 60_000);
    const { svc } = service([
      flightRow({
        status: BookingStatus.PendingPayment,
        reference: null,
        holdExpiresAt: holdEnds,
      }),
    ]);
    const page = await svc.flightBookings(
      USER,
      { group: BookingGroup.Upcoming, page: 1 },
      NOW,
    );
    expect(page.items[0]).toMatchObject({
      status: BookingStatus.PendingPayment,
      reference: null,
      holdExpiresAt: holdEnds,
    });
  });

  it('FLT-25 falls back to UTC for an airport missing from the reference data', async () => {
    const row = flightRow();
    row.segments[0].to = 'ZZZ';
    const { svc } = service([row]);
    const page = await svc.flightBookings(
      USER,
      { group: BookingGroup.Upcoming, page: 1 },
      NOW,
    );
    expect(page.items[0].segments[0]).toMatchObject({
      arrivalTimeZone: 'UTC',
      arrivalLocal: '2027-12-01T14:45:00.000Z',
    });
  });

  it('HTL-20 reads the caller cancelled reservations, latest cancellation first', async () => {
    const { svc, hotels } = service(
      [],
      [hotelRow({ status: BookingStatus.Cancelled })],
    );
    const page = await svc.hotelReservations(
      USER,
      { group: BookingGroup.Cancelled, page: 1 },
      NOW,
    );
    expect(hotels.calls.filter).toEqual({
      userId: new Types.ObjectId(USER.id),
      status: BookingStatus.Cancelled,
    });
    expect(hotels.calls.sort).toEqual({ cancelledAt: -1, _id: -1 });
    expect(page.items[0].group).toBe(BookingGroup.Cancelled);
  });

  it('HTL-20 shows reference, hotel, rooms, dates, guest totals, total and status', async () => {
    const row = hotelRow();
    const { svc } = service([], [row]);
    const page = await svc.hotelReservations(
      USER,
      { group: BookingGroup.Upcoming, page: 1 },
      NOW,
    );
    expect(page.items[0]).toEqual({
      id: row._id.toHexString(),
      reference: 'HT-7K3M9QX2',
      status: BookingStatus.Confirmed,
      group: BookingGroup.Upcoming,
      hotelId: row.hotelId.toHexString(),
      hotelName: 'Nile View Hotel',
      checkIn: '2027-12-10',
      checkOut: '2027-12-13',
      nights: 3,
      rooms: [
        {
          roomId: row.rooms[0].roomId.toHexString(),
          roomNumber: '101',
          adults: 2,
          childrenAges: [6],
        },
        {
          roomId: row.rooms[1].roomId.toHexString(),
          roomNumber: '102',
          adults: 1,
          childrenAges: [],
        },
      ],
      guests: { adults: 3, children: 1 },
      totalMinor: 90_000,
      currency: 'EGP',
      holdExpiresAt: null,
      createdAt: row.createdAt,
    });
  });
});
