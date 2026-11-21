import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  FLIGHT_BOOKINGS_LOOKUP,
  transitionBooking,
  type FlightBookingsLookup,
  UPCOMING_BOOKINGS,
  type UpcomingBookings,
} from '../src/common/contracts';
import {
  BookingLifecycleService,
  FlightBooking,
  HotelReservation,
} from '../src/modules/bookings';
import { loginAs, TEST_PASSWORD } from './support/auth';
import { createTestApp } from './support/create-test-app';

const NOW = new Date('2027-03-01T12:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const oid = () => new Types.ObjectId();

/** A minimal valid flight booking; tests override what they care about. */
function flightBooking(over: Partial<Record<string, unknown>> = {}) {
  const flightId = (over.flightId as Types.ObjectId | undefined) ?? oid();
  return {
    userId: oid(),
    tripType: 'ONE_WAY',
    segments: [
      {
        flightId,
        cabinId: oid(),
        cabinClass: 'ECONOMY',
        airlineId: oid(),
        flightNumber: 'MS101',
        from: 'CAI',
        to: 'DXB',
        departureUtc: hours(48),
        arrivalUtc: hours(52),
        seats: 1,
        fareMinor: 150_000,
      },
    ],
    passengers: [
      {
        type: 'ADULT',
        firstName: 'Mona',
        lastName: 'Adel',
        dateOfBirth: '1990-05-01',
        documentNumber: 'A1234567',
        extraBags: 0,
      },
    ],
    totalMinor: 150_000,
    currency: 'EGP',
    status: BookingStatus.Confirmed,
    holdExpiresAt: hours(-1),
    startsAt: hours(48),
    endsAt: hours(52),
    ...over,
  };
}

function hotelReservation(over: Partial<Record<string, unknown>> = {}) {
  return {
    userId: oid(),
    hotelId: oid(),
    hotelName: 'Lifecycle Hotel',
    checkIn: '2027-03-05',
    checkOut: '2027-03-07',
    nights: 2,
    timeZone: 'Africa/Cairo',
    rooms: [
      {
        roomId: oid(),
        roomNumber: '101',
        adults: 2,
        childrenAges: [5],
        nightlyPriceMinor: 80_000,
        subtotalMinor: 160_000,
      },
    ],
    totalMinor: 160_000,
    currency: 'EGP',
    status: BookingStatus.Confirmed,
    holdExpiresAt: hours(-1),
    startsAt: hours(96),
    endsAt: hours(144),
    ...over,
  };
}

describe('Booking lifecycle (e2e): GEN-11, ACC-12', () => {
  let app: INestApplication<App>;
  let flights: Model<FlightBooking>;
  let hotels: Model<HotelReservation>;

  beforeAll(async () => {
    app = await createTestApp();
    flights = app.get(getModelToken(FlightBooking.name));
    hotels = app.get(getModelToken(HotelReservation.name));
    await Promise.all([flights.syncIndexes(), hotels.syncIndexes()]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('schemas (TRVL-139)', () => {
    it('lets many unconfirmed bookings have no reference, but never two with the same one', async () => {
      await flights.create([
        flightBooking({ status: BookingStatus.PendingPayment }),
        flightBooking({ status: BookingStatus.PendingPayment }),
      ]);
      await flights.create(flightBooking({ reference: 'FL-AAAAAAAA' }));
      await expect(
        flights.create(flightBooking({ reference: 'FL-AAAAAAAA' })),
      ).rejects.toMatchObject({ code: 11000 });
      await hotels.create([
        hotelReservation({ status: BookingStatus.PendingPayment }),
        hotelReservation({ status: BookingStatus.PendingPayment }),
      ]);
      await hotels.create(hotelReservation({ reference: 'HT-AAAAAAAA' }));
      await expect(
        hotels.create(hotelReservation({ reference: 'HT-AAAAAAAA' })),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('rejects copied trip data that contradicts itself', async () => {
      await expect(
        flights.create(flightBooking({ tripType: 'ROUND_TRIP' })),
      ).rejects.toThrow(/round trip/i);
      await expect(
        flights.create(flightBooking({ endsAt: hours(47) })),
      ).rejects.toThrow(/endsAt/);
      await expect(
        hotels.create(hotelReservation({ checkOut: '2027-03-05' })),
      ).rejects.toThrow(/checkOut/);
      await expect(
        flights.create(flightBooking({ reference: 'FL-ILOU0000' })),
      ).rejects.toThrow(/reference/);
    });

    it('rejects a status outside the GEN-11 lifecycle and a non-integer amount', async () => {
      await expect(
        flights.create(flightBooking({ status: 'BOOKED' })),
      ).rejects.toThrow(/status/);
      await expect(
        hotels.create(hotelReservation({ totalMinor: 10.5 })),
      ).rejects.toThrow(/totalMinor/);
    });
  });

  describe('UPCOMING_BOOKINGS (ACC-12 needs it)', () => {
    it("counts the user's unfinished Confirmed bookings and unexpired holds, in flights and hotels", async () => {
      const userId = oid();
      await flights.create([
        flightBooking({ userId }), // counts: Confirmed, not started
        flightBooking({ userId, startsAt: hours(-1), endsAt: hours(3) }), // counts: trip in progress
        flightBooking({
          userId,
          status: BookingStatus.PendingPayment,
          holdExpiresAt: hours(0.1),
        }), // counts: paid hold may be confirmed by the webhook any moment
        flightBooking({ userId, status: BookingStatus.PendingPayment }), // hold expired
        flightBooking({ userId, status: BookingStatus.Cancelled }),
        flightBooking(), // someone else
      ]);
      await hotels.create([
        hotelReservation({ userId }), // counts
        hotelReservation({ userId, status: BookingStatus.Expired }),
        hotelReservation({
          userId,
          status: BookingStatus.Completed,
          startsAt: hours(-100),
          endsAt: hours(-50),
        }),
      ]);
      const upcoming = app.get<UpcomingBookings>(UPCOMING_BOOKINGS);
      await expect(
        upcoming.countUpcomingConfirmed(userId.toHexString(), NOW),
      ).resolves.toBe(4);
      await expect(
        upcoming.countUpcomingConfirmed(oid().toHexString(), NOW),
      ).resolves.toBe(0);
    });

    it('blocks self-deactivation through the real endpoint while a Confirmed trip is upcoming', async () => {
      const user = await loginAs(app, Role.User);
      await hotels.create(
        hotelReservation({
          userId: new Types.ObjectId(user.userId),
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 3 * 86_400_000),
        }),
      );
      const res = await request(app.getHttpServer())
        .delete('/api/users/me')
        .set('Cookie', user.cookie)
        .send({ password: TEST_PASSWORD })
        .expect(409);
      expect(res.body.code).toBe('UPCOMING_BOOKINGS_EXIST');
    });
  });

  it('fails closed on a malformed id instead of answering "no bookings"', async () => {
    const upcoming = app.get<UpcomingBookings>(UPCOMING_BOOKINGS);
    const lookup = app.get<FlightBookingsLookup>(FLIGHT_BOOKINGS_LOOKUP);
    await expect(upcoming.countUpcomingConfirmed('nope', NOW)).rejects.toThrow(
      /invalid/i,
    );
    await expect(lookup.confirmedBookings('nope')).rejects.toThrow(/invalid/i);
  });

  describe('FLIGHT_BOOKINGS_LOOKUP (FLT-05 needs it)', () => {
    it('lists the Confirmed bookings on a flight, with the account to notify', async () => {
      const flightId = oid();
      const confirmed = await flights.create(flightBooking({ flightId }));
      await flights.create([
        flightBooking({ flightId, status: BookingStatus.PendingPayment }),
        flightBooking({ flightId, status: BookingStatus.Cancelled }),
        flightBooking(),
      ]);
      const lookup = app.get<FlightBookingsLookup>(FLIGHT_BOOKINGS_LOOKUP);
      await expect(
        lookup.confirmedBookings(flightId.toHexString()),
      ).resolves.toEqual([
        { bookingId: confirmed.id, userId: confirmed.userId.toHexString() },
      ]);
    });
  });

  describe('transitionBooking on the replica set (R-GEN-11-02)', () => {
    it('lets exactly one of two concurrent writers move the same booking', async () => {
      const booking = await flights.create(
        flightBooking({ status: BookingStatus.PendingPayment }),
      );
      const results = await Promise.all(
        [1, 2].map(() =>
          transitionBooking(
            flights,
            booking.id,
            BookingStatus.PendingPayment,
            BookingStatus.Expired,
          ),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await flights.findById(booking.id).lean())?.status).toBe(
        BookingStatus.Expired,
      );
    });

    it('cannot confirm a booking that already expired (late webhook)', async () => {
      const booking = await flights.create(
        flightBooking({ status: BookingStatus.Expired }),
      );
      await expect(
        transitionBooking(
          flights,
          booking.id,
          BookingStatus.PendingPayment,
          BookingStatus.Confirmed,
          {
            set: { paymentId: oid(), reference: 'FL-BBBBBBBB' },
          },
        ),
      ).resolves.toBe(false);
      expect(await flights.findById(booking.id).lean()).toMatchObject({
        status: BookingStatus.Expired,
        reference: null,
      });
    });
  });

  describe('completion job: Confirmed -> Completed', () => {
    it('completes Confirmed bookings whose trip has ended, and nothing else', async () => {
      const lifecycle = app.get(BookingLifecycleService);
      // The job is collection-wide: start from no bookings so earlier tests' rows do not count.
      // Safe because test:e2e runs suites one at a time (--runInBand) and only this suite uses these collections.
      await Promise.all([flights.deleteMany({}), hotels.deleteMany({})]);
      const [ended, future, pendingEnded] = await flights.create([
        flightBooking({ startsAt: hours(-10), endsAt: hours(-1) }),
        flightBooking(),
        flightBooking({
          status: BookingStatus.PendingPayment,
          startsAt: hours(-10),
          endsAt: hours(-1),
        }),
      ]);
      const [stayOver, stayOn] = await hotels.create([
        hotelReservation({ startsAt: hours(-50), endsAt: NOW }),
        hotelReservation({ startsAt: hours(-50), endsAt: hours(1) }),
      ]);

      await expect(lifecycle.completeFinished(NOW)).resolves.toEqual({
        flights: 1,
        hotels: 1,
      });

      const status = async (m: Model<never>, id: string) =>
        ((await m.findById(id).lean()) as { status: string } | null)?.status;
      expect(await status(flights as never, ended.id)).toBe(
        BookingStatus.Completed,
      );
      expect(await status(flights as never, future.id)).toBe(
        BookingStatus.Confirmed,
      );
      expect(await status(flights as never, pendingEnded.id)).toBe(
        BookingStatus.PendingPayment,
      );
      expect(await status(hotels as never, stayOver.id)).toBe(
        BookingStatus.Completed,
      );
      expect(await status(hotels as never, stayOn.id)).toBe(
        BookingStatus.Confirmed,
      );

      // Running it again changes nothing (several API instances may run it at once).
      await expect(lifecycle.completeFinished(NOW)).resolves.toEqual({
        flights: 0,
        hotels: 0,
      });
    });
  });
});
