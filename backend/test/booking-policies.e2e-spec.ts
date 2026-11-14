import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  assertPayable,
  BookingStatus,
  FLIGHT_PAYABLE_BOOKING,
  HOTEL_PAYABLE_BOOKING,
  type PayableBooking,
} from '../src/common/contracts';
import { FlightBooking, HotelReservation } from '../src/modules/bookings';
import { Hotel } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';
import { TEST_ENV } from './support/test-env';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * PAY-02: the provider's policies are shown before payment and must be accepted (timestamped) before
 * the booking can be paid; PAY-04: the payment gate refuses any other currency. Own airline, hotel and
 * dates (CDG -> HND and Cairo, June 2028).
 */
describe('Booking policies (e2e): PAY-02, PAY-04', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let flightBookings: Model<FlightBooking>;
  let reservations: Model<HotelReservation>;
  let flightPayable: PayableBooking;
  let hotelPayable: PayableBooking;
  let airlineId: string;
  let airlineMod: string;
  let hotelId: string;
  let hotelMod: string;
  let flight: { flightId: string; cabinId: string };
  let roomId: string;
  let owner: LoggedIn;
  let other: LoggedIn;

  const policies = (who: LoggedIn | null, type: string, id: string) => {
    const req = http().get(`/api/bookings/${type}/${id}/policies`);
    if (who) req.set('Cookie', who.cookie);
    return req;
  };
  const accept = (
    who: LoggedIn | null,
    type: string,
    id: string,
    body: object,
  ) => {
    const req = http().post(`/api/bookings/${type}/${id}/accept-policies`);
    if (who) req.set('Cookie', who.cookie);
    return req.send(body);
  };
  const holdFlight = async (who: LoggedIn) =>
    (
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', who.cookie)
        .send({
          outbound: flight,
          passengers: [
            {
              type: 'ADULT',
              firstName: 'Mona',
              lastName: 'Adel',
              dateOfBirth: '1990-05-01',
              documentNumber: `P${new Types.ObjectId().toHexString().slice(-8)}`,
            },
          ],
        })
        .expect(201)
    ).body.id as string;
  let night = 0;
  const holdHotel = async (who: LoggedIn) => {
    const day = 10 + night++;
    return (
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', who.cookie)
        .send({
          hotelId,
          checkIn: `2028-06-${day}`,
          checkOut: `2028-06-${day + 1}`,
          rooms: [{ roomId, adults: 1 }],
        })
        .expect(201)
    ).body.id as string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    flightBookings = app.get(getModelToken(FlightBooking.name));
    reservations = app.get(getModelToken(HotelReservation.name));
    flightPayable = app.get(FLIGHT_PAYABLE_BOOKING);
    hotelPayable = app.get(HOTEL_PAYABLE_BOOKING);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Policy Air', code: 'PQ' })
      .expect(201);
    airlineId = airline.body.id as string;
    airlineMod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;
    await http()
      .put(`/api/airlines/${airlineId}/baggage-policy`)
      .set('x-dev-user', airlineMod)
      .send({ pricePerBagMinor: 4_000, maxExtraBagsPerPassenger: 2 })
      .expect(200);
    await http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('x-dev-user', airlineMod)
      .send({
        tiers: [
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
        ],
      })
      .expect(200);
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', airlineMod)
      .send({
        flightNumber: 'PQ100',
        from: 'CDG',
        to: 'HND',
        departureLocal: '2028-06-10T10:00',
        arrivalLocal: '2028-06-11T06:00',
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${f.body.id}/cabins`)
      .set('x-dev-user', airlineMod)
      .send({
        class: 'ECONOMY',
        totalSeats: 50,
        priceMinor: 90_000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    flight = {
      flightId: f.body.id as string,
      cabinId: (cabin.body.cabins as { id: string }[])[0].id,
    };

    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({ name: 'Policy Nile', address: '2 Nile St', cityId: 'cairo' })
        .expect(201)
    ).body.id as string;
    hotelMod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    // HTL-09/HTL-10 have no endpoints on develop yet, so their stored values are set directly.
    await app.get<Model<Hotel>>(getModelToken(Hotel.name)).updateOne(
      { _id: hotelId },
      {
        $set: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [{ daysBefore: 3, refundPercent: 80 }],
        },
      },
    );
    roomId = (
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('x-dev-user', hotelMod)
        .send({
          number: 'P1',
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          priceMinor: 5_000,
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .set('x-dev-user', hotelMod)
      .send({ ranges: [{ from: '2028-06-01', to: '2028-06-30' }] })
      .expect(201);
    other = await loginAs(app, Role.User);
  });

  // A fresh owner per test, so the 3-unpaid-holds cap (API6) never couples tests.
  beforeEach(async () => {
    owner = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/bookings/:type/:id/policies', () => {
    it('shows the airline cancellation and baggage policies of each flight, not yet accepted', async () => {
      const id = await holdFlight(owner);
      const res = await policies(owner, 'flight', id).expect(200);
      expect(res.body).toMatchObject({
        bookingType: 'FLIGHT',
        bookingId: id,
        status: BookingStatus.PendingPayment,
        accepted: false,
        acceptedAt: null,
        version: expect.stringMatching(/^[0-9a-f]{16}$/) as string,
        airlines: [
          {
            airlineId,
            airlineName: 'Policy Air',
            airlineCode: 'PQ',
            flightNumber: 'PQ100',
            cabinClass: 'ECONOMY',
            freeBags: 1,
            maxKgPerBag: 23,
            cancellationTiers: [
              { daysBefore: 7, refundPercent: 50 },
              { daysBefore: 30, refundPercent: 100 },
            ],
            extraBaggage: {
              pricePerBagMinor: 4_000,
              maxExtraBagsPerPassenger: 2,
            },
          },
        ],
      });
      expect(res.body.hotel).toBeUndefined();
    });

    it('shows the hotel cancellation policy and check-in/check-out times', async () => {
      const id = await holdHotel(owner);
      const res = await policies(owner, 'hotel', id).expect(200);
      expect(res.body).toMatchObject({
        bookingType: 'HOTEL',
        accepted: false,
        hotel: {
          hotelId,
          hotelName: 'Policy Nile',
          cancellationTiers: [{ daysBefore: 3, refundPercent: 80 }],
          checkInTime: '14:00',
          checkOutTime: '12:00',
        },
      });
    });

    it('answers 404 to anyone but the owner, 400 for an unknown type, 401 signed out', async () => {
      const id = await holdHotel(owner);
      await policies(other, 'hotel', id).expect(404);
      await policies(owner, 'flight', id).expect(404); // right id, wrong type
      const bad = await policies(owner, 'train', id).expect(400);
      await policies(owner, 'constructor', id).expect(400);
      expect(bad.body.fieldErrors?.[0]?.field).toBe('type');
      await policies(null, 'hotel', id).expect(401);
    });
  });

  describe('POST /api/bookings/:type/:id/accept-policies', () => {
    it('stores the acceptance with a timestamp and a snapshot of exactly the terms shown', async () => {
      const id = await holdHotel(owner);
      const shown = await policies(owner, 'hotel', id).expect(200);
      const before = Date.now();
      const res = await accept(owner, 'hotel', id, {
        accepted: true,
        version: shown.body.version,
      }).expect(200);
      expect(res.body.accepted).toBe(true);
      const at = new Date(res.body.acceptedAt as string).getTime();
      expect(at).toBeGreaterThanOrEqual(before - 1000);
      const stored = await reservations.findById(id).lean();
      expect(stored?.policiesAcceptedAt?.getTime()).toBe(at);
      expect(stored?.policySnapshot).toMatchObject({
        version: shown.body.version,
        hotel: shown.body.hotel as object,
      });
      // A repeat is idempotent: the first acceptance time is kept.
      const again = await accept(owner, 'hotel', id, {
        accepted: true,
        version: shown.body.version,
      }).expect(200);
      expect(again.body.acceptedAt).toBe(res.body.acceptedAt);
      // Another version is not what was accepted: refused, the stored terms stay.
      const other = await accept(owner, 'hotel', id, {
        accepted: true,
        version: 'ffffffffffffffff',
      }).expect(409);
      expect(other.body.code).toBe('POLICIES_CHANGED');
    });

    it('requires the checkbox: accepted must be true (400 on accepted), and a version', async () => {
      const id = await holdFlight(owner);
      const unticked = await accept(owner, 'flight', id, {
        accepted: false,
        version: '0123456789abcdef',
      }).expect(400);
      expect(
        unticked.body.fieldErrors.map((e: { field: string }) => e.field),
      ).toContain('accepted');
      const missing = await accept(owner, 'flight', id, {
        accepted: true,
      }).expect(400);
      expect(
        missing.body.fieldErrors.map((e: { field: string }) => e.field),
      ).toContain('version');
      expect(
        (await flightBookings.findById(id).lean())?.policiesAcceptedAt,
      ).toBeNull();
    });

    it('refuses terms that changed after they were shown (409), so nothing is accepted unseen', async () => {
      const id = await holdFlight(owner);
      const shown = await policies(owner, 'flight', id).expect(200);
      await http()
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .set('x-dev-user', airlineMod)
        .send({ pricePerBagMinor: 6_000, maxExtraBagsPerPassenger: 2 })
        .expect(200);
      try {
        const res = await accept(owner, 'flight', id, {
          accepted: true,
          version: shown.body.version,
        }).expect(409);
        expect(res.body.code).toBe('POLICIES_CHANGED');
        expect(
          (await flightBookings.findById(id).lean())?.policiesAcceptedAt,
        ).toBeNull();
        const fresh = await policies(owner, 'flight', id).expect(200);
        expect(fresh.body.version).not.toBe(shown.body.version);
        await accept(owner, 'flight', id, {
          accepted: true,
          version: fresh.body.version,
        }).expect(200);
      } finally {
        await http()
          .put(`/api/airlines/${airlineId}/baggage-policy`)
          .set('x-dev-user', airlineMod)
          .send({ pricePerBagMinor: 4_000, maxExtraBagsPerPassenger: 2 })
          .expect(200);
      }
    });

    it('refuses an expired hold (409 HOLD_EXPIRED) and another account (404)', async () => {
      const id = await holdHotel(owner);
      const shown = await policies(owner, 'hotel', id).expect(200);
      await accept(other, 'hotel', id, {
        accepted: true,
        version: shown.body.version,
      }).expect(404);
      await reservations.updateOne(
        { _id: id },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      const res = await accept(owner, 'hotel', id, {
        accepted: true,
        version: shown.body.version,
      }).expect(409);
      expect(res.body.code).toBe('HOLD_EXPIRED');
    });
  });

  describe('payment is blocked until the policies are accepted (PAY-02, PAY-04)', () => {
    const platform = TEST_ENV.PLATFORM_CURRENCY;

    it('the payment gate refuses before acceptance and passes after it', async () => {
      const id = await holdFlight(owner);
      const before = await flightPayable.getPayable(id, owner.userId);
      expect(before.currency).toBe(platform);
      expect(() =>
        assertPayable(before, { now: new Date(), platformCurrency: platform }),
      ).toThrow(
        expect.objectContaining({ code: 'POLICIES_NOT_ACCEPTED' }) as Error,
      );
      const shown = await policies(owner, 'flight', id).expect(200);
      await accept(owner, 'flight', id, {
        accepted: true,
        version: shown.body.version,
      }).expect(200);
      const after = await flightPayable.getPayable(id, owner.userId);
      expect(after.policiesAcceptedAt).toBeInstanceOf(Date);
      expect(() =>
        assertPayable(after, { now: new Date(), platformCurrency: platform }),
      ).not.toThrow();
    });

    it('hotel reservations go through the same gate', async () => {
      const id = await holdHotel(owner);
      const snap = await hotelPayable.getPayable(id, owner.userId);
      expect(() =>
        assertPayable(snap, { now: new Date(), platformCurrency: platform }),
      ).toThrow(
        expect.objectContaining({ code: 'POLICIES_NOT_ACCEPTED' }) as Error,
      );
    });
  });
});
