import { Types } from 'mongoose';
import {
  ProviderType,
  Role,
  type AuthUser,
} from '../../common/auth/auth.types';
import { BookingStatus } from '../../common/contracts';
import { csvCell, ProviderBookingsService } from './provider-bookings.service';
import { PassengerType, TripType } from './schemas/flight-booking.schema';

const NOW = new Date('2027-11-01T08:00:00Z');
const AIRLINE = new Types.ObjectId();
const HOTEL = new Types.ObjectId();
const FLIGHT = new Types.ObjectId();
const RETURN_FLIGHT = new Types.ObjectId();
const ECONOMY = new Types.ObjectId();
const BUSINESS = new Types.ObjectId();

const airlineMod = (providerId = AIRLINE): AuthUser => ({
  id: new Types.ObjectId().toHexString(),
  role: Role.AirlineModerator,
  assignedProvider: {
    type: ProviderType.Airline,
    providerId: providerId.toHexString(),
  },
});
const hotelMod = (providerId = HOTEL): AuthUser => ({
  id: new Types.ObjectId().toHexString(),
  role: Role.HotelModerator,
  assignedProvider: {
    type: ProviderType.Hotel,
    providerId: providerId.toHexString(),
  },
});

const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value) });

/** find().sort().skip().limit().lean().exec() and find().lean().exec(), recording the filter. */
function listModel(rows: object[]) {
  const seen: { filter?: unknown; sort?: unknown } = {};
  const chain = {
    sort: (s: unknown) => {
      seen.sort = s;
      return chain;
    },
    skip: () => chain,
    limit: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(rows),
  };
  return {
    seen,
    find: jest.fn((filter: unknown) => {
      seen.filter = filter;
      return chain;
    }),
    countDocuments: jest.fn(() => exec(rows.length)),
    aggregate: jest.fn(() =>
      exec([
        { _id: { cabinId: ECONOMY, held: false }, seats: 3 },
        { _id: { cabinId: ECONOMY, held: true }, seats: 1 },
      ]),
    ),
  };
}

const byId = (doc: object | null) => ({
  findById: jest.fn(() => ({ lean: () => exec(doc) })),
});

const flightDoc = {
  _id: FLIGHT,
  airlineId: AIRLINE,
  flightNumber: 'WP200',
  from: 'CAI',
  to: 'DXB',
  departureUtc: new Date('2027-12-01T12:30:00Z'),
  departureLocalDate: '2027-12-01',
  status: 'SCHEDULED',
  cabins: [
    { _id: ECONOMY, class: 'ECONOMY', totalSeats: 10, seatsAvailable: 6 },
    { _id: BUSINESS, class: 'BUSINESS', totalSeats: 4, seatsAvailable: 4 },
  ],
};

const booking = (over: object = {}) => ({
  _id: new Types.ObjectId(),
  userId: new Types.ObjectId(),
  reference: 'FL-7K3M9QX2',
  status: BookingStatus.Confirmed,
  tripType: TripType.RoundTrip,
  segments: [
    {
      flightId: RETURN_FLIGHT,
      cabinId: new Types.ObjectId(),
      cabinClass: 'FIRST',
      seats: 2,
    },
    { flightId: FLIGHT, cabinId: ECONOMY, cabinClass: 'ECONOMY', seats: 2 },
  ],
  passengers: [
    {
      type: PassengerType.Adult,
      firstName: 'Mona',
      lastName: 'Zaki',
      extraBags: 1,
    },
    {
      type: PassengerType.Child,
      firstName: '=HYPERLINK("x")',
      lastName: 'Adel',
      extraBags: 0,
    },
  ],
  confirmedAt: new Date('2027-10-01T08:00:00Z'),
  cancelledAt: null,
  ...over,
});

function service(opts: {
  flight?: object | null;
  hotel?: object | null;
  bookings?: object[];
  reservations?: object[];
  names?: Record<string, string>;
}) {
  const flightBookings = listModel(opts.bookings ?? []);
  const reservations = listModel(opts.reservations ?? []);
  const users = {
    findProfile: jest.fn((id: string) =>
      Promise.resolve(opts.names?.[id] ? { name: opts.names[id] } : null),
    ),
  };
  const svc = new ProviderBookingsService(
    flightBookings as never,
    reservations as never,
    byId(opts.flight === undefined ? flightDoc : opts.flight) as never,
    byId(opts.hotel === undefined ? { _id: HOTEL } : opts.hotel) as never,
    users as never,
  );
  return { svc, flightBookings, reservations };
}

describe('csvCell (FLT-29 passenger export)', () => {
  it('quotes every cell and doubles quotes (RFC 4180)', () => {
    expect(csvCell('Mona')).toBe('"Mona"');
    expect(csvCell('O"Neil, Jr')).toBe('"O""Neil, Jr"');
  });

  it.each(['=1+1', '+20', '-3', '@SUM(A1)', '\tx', '\rx'])(
    'neutralises a formula-like cell %j (CSV injection)',
    (value) => {
      expect(csvCell(value).startsWith(`"'`)).toBe(true);
    },
  );
});

describe('ProviderBookingsService (FLT-29, HTL-22)', () => {
  it('FLT-29 lists Confirmed, Completed and Cancelled bookings of the flight, newest first', async () => {
    const b = booking();
    const { svc, flightBookings } = service({ bookings: [b] });
    const page = await svc.flightBookingsPage(
      airlineMod(),
      FLIGHT.toHexString(),
      { page: 1 },
      NOW,
    );
    expect(flightBookings.seen.filter).toEqual({
      'segments.flightId': FLIGHT,
      status: {
        $in: [
          BookingStatus.Confirmed,
          BookingStatus.Completed,
          BookingStatus.Cancelled,
        ],
      },
    });
    expect(flightBookings.seen.sort).toEqual({ createdAt: -1, _id: -1 });
    // The cabin and seats of THIS flight's segment of a round trip.
    expect(page.items[0]).toMatchObject({
      reference: 'FL-7K3M9QX2',
      status: BookingStatus.Confirmed,
      cabinClass: 'ECONOMY',
      seats: 2,
      passengers: [
        { firstName: 'Mona', lastName: 'Zaki' },
        { firstName: '=HYPERLINK("x")', lastName: 'Adel' },
      ],
    });
  });

  it('FLT-29 narrows to one status when asked', async () => {
    const { svc, flightBookings } = service({ bookings: [] });
    await svc.flightBookingsPage(
      airlineMod(),
      FLIGHT.toHexString(),
      { page: 1, status: BookingStatus.Cancelled },
      NOW,
    );
    expect(flightBookings.seen.filter).toMatchObject({
      status: BookingStatus.Cancelled,
    });
  });

  it('FLT-29 gives seats remaining, booked and held per cabin category', async () => {
    const { svc } = service({ bookings: [] });
    const page = await svc.flightBookingsPage(
      airlineMod(),
      FLIGHT.toHexString(),
      { page: 1 },
      NOW,
    );
    expect(page.flight).toMatchObject({
      flightNumber: 'WP200',
      cabins: [
        {
          cabinClass: 'ECONOMY',
          totalSeats: 10,
          seatsRemaining: 6,
          seatsBooked: 3,
          seatsHeld: 1,
        },
        {
          cabinClass: 'BUSINESS',
          totalSeats: 4,
          seatsRemaining: 4,
          seatsBooked: 0,
          seatsHeld: 0,
        },
      ],
    });
  });

  it("FLT-29 refuses another airline's moderator (403) and an unknown flight (404)", async () => {
    await expect(
      service({}).svc.flightBookingsPage(
        airlineMod(new Types.ObjectId()),
        FLIGHT.toHexString(),
        { page: 1 },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service({ flight: null }).svc.passengerCsv(
        airlineMod(),
        FLIGHT.toHexString(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FLT-29 exports every confirmed passenger by last name, with formulas neutralised', async () => {
    const { svc, flightBookings } = service({ bookings: [booking()] });
    const { filename, csv } = await svc.passengerCsv(
      airlineMod(),
      FLIGHT.toHexString(),
    );
    expect(filename).toBe('passengers-WP200-2027-12-01.csv');
    expect(flightBookings.seen.filter).toEqual({
      'segments.flightId': FLIGHT,
      status: { $in: [BookingStatus.Confirmed, BookingStatus.Completed] },
    });
    const text = csv.toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.slice(1).split('\r\n')).toEqual([
      '"Booking reference","Booking status","Cabin","Passenger type","Last name","First name","Extra bags"',
      '"FL-7K3M9QX2","CONFIRMED","ECONOMY","CHILD","Adel","\'=HYPERLINK(""x"")","0"',
      '"FL-7K3M9QX2","CONFIRMED","ECONOMY","ADULT","Zaki","Mona","1"',
      '',
    ]);
  });

  it('HTL-22 lists the hotel reservations except expired holds, latest check-in first', async () => {
    const guest = new Types.ObjectId();
    const ghost = new Types.ObjectId();
    const reservation = (userId: Types.ObjectId) => ({
      _id: new Types.ObjectId(),
      userId,
      reference: 'HT-7K3M9QX2',
      status: BookingStatus.Confirmed,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomNumber: '101',
          adults: 2,
          childrenAges: [5],
        },
      ],
      checkIn: '2027-12-10',
      checkOut: '2027-12-12',
      nights: 2,
      totalMinor: 30_000,
      currency: 'EGP',
      holdExpiresAt: new Date('2027-10-01T08:10:00Z'),
      endsAt: new Date('2027-12-12T22:00:00Z'),
      createdAt: new Date('2027-10-01T08:00:00Z'),
    });
    const { svc, reservations } = service({
      reservations: [reservation(guest), reservation(ghost)],
      names: { [guest.toHexString()]: 'Mona Adel' },
    });
    const page = await svc.hotelReservationsPage(
      hotelMod(),
      HOTEL.toHexString(),
      { page: 1 },
      NOW,
    );
    expect(reservations.seen.filter).toEqual({
      hotelId: HOTEL,
      status: {
        $in: [
          BookingStatus.PendingPayment,
          BookingStatus.Confirmed,
          BookingStatus.Completed,
          BookingStatus.Cancelled,
        ],
      },
    });
    expect(reservations.seen.sort).toEqual({ startsAt: -1, _id: -1 });
    expect(page.items.map((r) => r.guestName)).toEqual([
      'Mona Adel',
      'Deleted user',
    ]);
    expect(page.items[0]).toMatchObject({
      status: BookingStatus.Confirmed,
      adults: 2,
      children: 1,
      checkIn: '2027-12-10',
      checkOut: '2027-12-12',
    });
  });

  it("HTL-22 refuses another hotel's moderator (403), an airline moderator (403) and an unknown hotel (404)", async () => {
    await expect(
      service({}).svc.hotelReservationsPage(
        hotelMod(new Types.ObjectId()),
        HOTEL.toHexString(),
        { page: 1 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service({}).svc.hotelReservationsPage(
        airlineMod(HOTEL),
        HOTEL.toHexString(),
        { page: 1 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service({ hotel: null }).svc.hotelReservationsPage(
        hotelMod(),
        HOTEL.toHexString(),
        { page: 1 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
