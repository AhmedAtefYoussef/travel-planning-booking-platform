import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  FLIGHT_BOOKINGS_LOOKUP,
  FLIGHT_PAYABLE_BOOKING,
  HOLD_DURATION_MS,
  type FlightBookingsLookup,
  type PayableBooking,
} from '../src/common/contracts';
import { FlightBooking } from '../src/modules/flight-bookings';
import { FlightBookingLifecycleService } from '../src/modules/flight-bookings/flight-booking-lifecycle.service';
import { Airline, Flight } from '../src/modules/flights';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const id = () => new Types.ObjectId().toHexString();

/**
 * FLT-22 seat holds, FLT-12/FLT-19 pricing, GEN-11 lifecycle and the FLIGHT_PAYABLE_BOOKING contract,
 * on their own route and dates (CDG <-> DXB, May 2028).
 */
describe('Flight bookings (e2e): FLT-22, FLT-12, FLT-19, GEN-11', () => {
  let app: INestApplication<App>;
  let flights: Model<Flight>;
  let bookings: Model<FlightBooking>;
  let airlines: Model<Airline>;
  let lifecycle: FlightBookingLifecycleService;
  let payable: PayableBooking;
  const http = () => request(app.getHttpServer());

  const userA = id();
  const userB = id();
  const asA = `USER:${userA}`;
  const asB = `USER:${userB}`;
  let moderator: string;
  let airlineId: string;
  let noBagsModerator: string;

  interface Created {
    flightId: string;
    cabins: Record<string, string>;
  }
  let out: Created; // CDG -> DXB, 10 May 2028 09:00, Economy 30000 x 5 seats, Business 2 seats
  let back: Created; // DXB -> CDG, 17 May 2028
  let early: Created; // DXB -> CDG, 10 May 2028 12:00 (departs before `out` lands)
  let noBags: Created; // another airline with no extra-bag policy, CDG -> DXB 11 May

  async function createFlight(
    as: string,
    flightNumber: string,
    from: string,
    to: string,
    departureLocal: string,
    arrivalLocal: string,
    cabins: { class: string; totalSeats: number; priceMinor: number }[],
  ): Promise<Created> {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', as)
      .send({ flightNumber, from, to, departureLocal, arrivalLocal })
      .expect(201);
    const created: Created = { flightId: res.body.id as string, cabins: {} };
    for (const cabin of cabins) {
      const c = await http()
        .post(`/api/flights/${created.flightId}/cabins`)
        .set('x-dev-user', as)
        .send({ ...cabin, freeBags: 1, maxKgPerBag: 23 })
        .expect(201);
      const added = (c.body.cabins as { id: string; class: string }[]).find(
        (x) => x.class === cabin.class,
      );
      created.cabins[cabin.class] = added?.id as string;
    }
    return created;
  }

  const adult = (extra: Record<string, unknown> = {}) => ({
    fullName: 'Mona Adel Hassan',
    dateOfBirth: '1990-01-15',
    documentNumber: 'a1234 5678',
    ...extra,
  });
  const infant = {
    fullName: 'Baby Hassan',
    dateOfBirth: '2027-08-01',
    documentNumber: 'B7654321',
  };
  const child = {
    fullName: 'Omar Hassan',
    dateOfBirth: '2020-03-03',
    documentNumber: 'C1234567',
  };

  const hold = (body: unknown, as = asA) =>
    http()
      .post('/api/flight-bookings/hold')
      .set('x-dev-user', as)
      .send(body as object);
  const seg = (c: Created, cabin = 'ECONOMY') => ({
    flightId: c.flightId,
    cabinId: c.cabins[cabin],
  });
  const seatsLeft = async (c: Created, cabin = 'ECONOMY') => {
    const f = await flights.findById(c.flightId).lean().exec();
    return f?.cabins.find((x) => x._id.toHexString() === c.cabins[cabin])
      ?.seatsAvailable;
  };
  const resetSeats = async (c: Created) => {
    const f = await flights.findById(c.flightId).exec();
    for (const cabin of f?.cabins ?? [])
      cabin.seatsAvailable = cabin.totalSeats;
    await f?.save();
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    bookings = app.get<Model<FlightBooking>>(getModelToken(FlightBooking.name));
    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    lifecycle = app.get(FlightBookingLifecycleService);
    payable = app.get<PayableBooking>(FLIGHT_PAYABLE_BOOKING);

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Booking Test Air', code: 'BK' })
      .expect(201);
    airlineId = airline.body.id as string;
    moderator = `AIRLINE_MODERATOR:${id()}:${airlineId}`;
    await http()
      .put(`/api/airlines/${airlineId}/baggage-policy`)
      .set('x-dev-user', moderator)
      .send({ pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 })
      .expect(200);
    await http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('x-dev-user', moderator)
      .send({ tiers: [{ daysBefore: 7, refundPercent: 50 }] })
      .expect(200);

    out = await createFlight(
      moderator,
      'BK100',
      'CDG',
      'DXB',
      '2028-05-10T09:00',
      '2028-05-10T18:00',
      [
        { class: 'ECONOMY', totalSeats: 5, priceMinor: 30000 },
        { class: 'BUSINESS', totalSeats: 2, priceMinor: 120000 },
      ],
    );
    back = await createFlight(
      moderator,
      'BK200',
      'DXB',
      'CDG',
      '2028-05-17T08:00',
      '2028-05-17T13:00',
      [{ class: 'ECONOMY', totalSeats: 50, priceMinor: 28000 }],
    );
    early = await createFlight(
      moderator,
      'BK300',
      'DXB',
      'CDG',
      '2028-05-10T12:00',
      '2028-05-10T17:00',
      [{ class: 'ECONOMY', totalSeats: 50, priceMinor: 28000 }],
    );

    const other = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'No Bags Air', code: 'NB' })
      .expect(201);
    noBagsModerator = `AIRLINE_MODERATOR:${id()}:${other.body.id as string}`;
    noBags = await createFlight(
      noBagsModerator,
      'NB100',
      'CDG',
      'DXB',
      '2028-05-11T09:00',
      '2028-05-11T18:00',
      [{ class: 'ECONOMY', totalSeats: 10, priceMinor: 25000 }],
    );
  });

  beforeEach(async () => {
    await bookings.deleteMany({});
    for (const c of [out, back, early, noBags]) await resetSeats(c);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/flight-bookings/hold', () => {
    it('holds the seats for 10 minutes as PENDING_PAYMENT and prices the booking on the server', async () => {
      const before = Date.now();
      const res = await hold({
        segments: [seg(out)],
        passengers: [adult({ extraBags: 1 }), infant, child],
      }).expect(201);
      const holdEnd = new Date(res.body.holdExpiresAt as string).getTime();
      expect(holdEnd - before).toBeGreaterThanOrEqual(HOLD_DURATION_MS - 1000);
      expect(holdEnd - Date.now()).toBeLessThanOrEqual(HOLD_DURATION_MS);
      expect(res.body).toMatchObject({
        status: 'PENDING_PAYMENT',
        reference: null,
        currency: 'USD',
        policiesAcceptedAt: null,
        // 2 seats x 300.00 + 1 infant x 30.00 + 1 extra bag x 40.00
        priceBreakdown: {
          faresMinor: 60000,
          infantFaresMinor: 3000,
          baggageMinor: 4000,
        },
        totalMinor: 67000,
      });
      expect(res.body.segments[0]).toMatchObject({
        flightNumber: 'BK100',
        cabinClass: 'ECONOMY',
        seats: 2,
        farePerSeatMinor: 30000,
        infantFareMinor: 3000,
        extraBaggage: { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 },
        cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        departure: {
          airport: 'CDG',
          timeZone: 'Europe/Paris',
          local: '2028-05-10T09:00:00.000+02:00',
        },
        arrival: { airport: 'DXB', timeZone: 'Asia/Dubai' },
        subtotalMinor: 67000,
      });
      expect(
        res.body.passengers.map((p: { types: string[] }) => p.types),
      ).toEqual([['ADULT'], ['INFANT'], ['CHILD']]);
      expect(res.body.passengers[0].documentNumber).toBe('A12345678');
      // Infants take no seat: 5 - 2.
      expect(await seatsLeft(out)).toBe(3);
    });

    it('a round trip is one booking with two segments; seats are held on both flights', async () => {
      const res = await hold({
        segments: [seg(out), seg(back)],
        passengers: [
          adult(),
          adult({ fullName: 'Karim Hassan', documentNumber: 'K9999999' }),
        ],
      }).expect(201);
      expect(
        res.body.segments.map((s: { flightNumber: string }) => s.flightNumber),
      ).toEqual(['BK100', 'BK200']);
      expect(res.body.totalMinor).toBe(2 * 30000 + 2 * 28000);
      expect(await seatsLeft(out)).toBe(3);
      expect(await seatsLeft(back)).toBe(48);
    });

    it('a baby who turns 2 between the flights is an infant out and a child back (needs a seat back)', async () => {
      const res = await hold({
        segments: [seg(out), seg(back)],
        passengers: [adult(), { ...infant, dateOfBirth: '2026-05-12' }],
      }).expect(201);
      expect(res.body.passengers[1].types).toEqual(['INFANT', 'CHILD']);
      expect(res.body.segments.map((s: { seats: number }) => s.seats)).toEqual([
        1, 2,
      ]);
      expect(res.body.totalMinor).toBe(30000 + 3000 + 2 * 28000);
    });

    it.each([
      [
        'no adult',
        { passengers: [child] },
        'passengers',
        'Each booking needs at least one adult (12 or older)',
      ],
      [
        'more infants than adults',
        {
          passengers: [
            adult(),
            infant,
            { ...infant, documentNumber: 'B1111111' },
          ],
        },
        'passengers',
        'No more infants than adults: 2 infant(s) for 1 adult(s)',
      ],
      [
        'a birth date after the flight',
        { passengers: [adult({ dateOfBirth: '2028-06-01' })] },
        'passengers[0].dateOfBirth',
        'The date of birth must not be after the travel date',
      ],
      [
        'an impossible birth date',
        { passengers: [adult({ dateOfBirth: '1990-02-30' })] },
        'passengers[0].dateOfBirth',
        '"1990-02-30" is not a valid YYYY-MM-DD date',
      ],
      [
        'more extra bags than the airline allows',
        { passengers: [adult({ extraBags: 3 })] },
        'passengers[0].extraBags',
        'Booking Test Air allows at most 2 extra bag(s) per passenger',
      ],
    ])(
      'rejects %s with a field error and holds nothing',
      async (_n, body, field, message) => {
        const res = await hold({ segments: [seg(out)], ...body }).expect(400);
        expect(res.body.fieldErrors).toContainEqual({ field, message });
        expect(await seatsLeft(out)).toBe(5);
        expect(await bookings.countDocuments()).toBe(0);
      },
    );

    it('rejects the same passport twice in one booking', async () => {
      const res = await hold({
        segments: [seg(out)],
        passengers: [adult(), adult({ fullName: 'Someone Else' })],
      }).expect(400);
      expect(res.body.fieldErrors).toEqual([
        {
          field: 'passengers[1].documentNumber',
          message: 'Passengers 1 and 2 have the same passport/ID number',
        },
      ]);
    });

    it('rejects extra bags on an airline that sells none', async () => {
      const res = await hold({
        segments: [seg(noBags)],
        passengers: [adult({ extraBags: 1 })],
      }).expect(400);
      expect(res.body.fieldErrors).toEqual([
        {
          field: 'passengers[0].extraBags',
          message: 'No Bags Air sells no extra bags on flight NB100',
        },
      ]);
    });

    it.each([
      [
        'a return that does not fly back',
        () => [seg(out), seg(noBags)],
        'A round trip returns from DXB to CDG; this flight goes from CDG to DXB',
      ],
      [
        'a return that leaves before the outbound lands',
        () => [seg(out), seg(early)],
        'The return flight must depart after the outbound flight lands',
      ],
      [
        'the same flight twice',
        () => [seg(out), seg(out)],
        'The return flight must be a different flight',
      ],
    ])('rejects %s', async (_n, segments, message) => {
      const res = await hold({
        segments: segments(),
        passengers: [adult()],
      }).expect(400);
      expect(res.body.fieldErrors).toEqual([
        { field: 'segments[1].flightId', message },
      ]);
    });

    it('validates the request shape with one message per field', async () => {
      const res = await hold({
        segments: [{ flightId: 'x', cabinId: out.cabins.ECONOMY }],
        passengers: [
          {
            fullName: '1',
            dateOfBirth: '15/01/1990',
            documentNumber: '12',
            extraBags: -1,
          },
        ],
      }).expect(400);
      expect(
        res.body.fieldErrors.map((e: { field: string }) => e.field).sort(),
      ).toEqual([
        'passengers[0].dateOfBirth',
        'passengers[0].documentNumber',
        'passengers[0].extraBags',
        'passengers[0].fullName',
        'segments[0].flightId',
      ]);
      await hold({ segments: [], passengers: [adult()] }).expect(400);
      await hold({
        segments: [seg(out), seg(back), seg(early)],
        passengers: [adult()],
      }).expect(400);
      await hold({ segments: [seg(out)], passengers: [] }).expect(400);
      await hold({
        segments: [seg(out)],
        passengers: [adult({ extraBags: null })],
      }).expect(400);
    });

    it('answers 404 for an unknown flight and 400 for a cabin of another flight', async () => {
      await hold({
        segments: [{ flightId: id(), cabinId: id() }],
        passengers: [adult()],
      }).expect(404);
      const res = await hold({
        segments: [{ flightId: out.flightId, cabinId: back.cabins.ECONOMY }],
        passengers: [adult()],
      }).expect(400);
      expect(res.body.fieldErrors[0].field).toBe('segments[0].cabinId');
    });

    it('answers 409 INSUFFICIENT_INVENTORY when too few seats remain, and takes none', async () => {
      const res = await hold({
        segments: [seg(out, 'BUSINESS')],
        passengers: [
          adult(),
          adult({ documentNumber: 'X1111111' }),
          adult({ documentNumber: 'X2222222' }),
        ],
      }).expect(409);
      expect(res.body).toMatchObject({
        code: 'INSUFFICIENT_INVENTORY',
        message: 'Only 2 seat(s) left in BK100 BUSINESS; 3 needed',
      });
      expect(await seatsLeft(out, 'BUSINESS')).toBe(2);
    });

    it('a round trip is all or nothing: a full return leaves the outbound untouched', async () => {
      await flights.updateOne(
        { _id: back.flightId, 'cabins._id': back.cabins.ECONOMY },
        { $set: { 'cabins.$.seatsAvailable': 0 } },
      );
      await hold({
        segments: [seg(out), seg(back)],
        passengers: [adult()],
      }).expect(409);
      expect(await seatsLeft(out)).toBe(5);
      expect(await bookings.countDocuments()).toBe(0);
    });

    it('refuses flights that are no longer bookable: cancelled, departed, or of a deactivated airline', async () => {
      await flights.updateOne(
        { _id: out.flightId },
        { $set: { status: 'CANCELLED' } },
      );
      await hold({ segments: [seg(out)], passengers: [adult()] }).expect(409);
      await flights.updateOne(
        { _id: out.flightId },
        { $set: { status: 'SCHEDULED' } },
      );

      await airlines.updateOne(
        { _id: airlineId },
        { $set: { isActive: false } },
      );
      const res = await hold({
        segments: [seg(out)],
        passengers: [adult()],
      }).expect(409);
      expect(res.body.message).toContain('airline is not active (ACC-15)');
      await airlines.updateOne(
        { _id: airlineId },
        { $set: { isActive: true } },
      );
      expect(await seatsLeft(out)).toBe(5);
    });

    it('only registered users can hold seats', async () => {
      const body = { segments: [seg(out)], passengers: [adult()] };
      await http().post('/api/flight-bookings/hold').send(body).expect(401);
      await hold(body, 'ADMIN').expect(403);
      await hold(body, moderator).expect(403);
    });
  });

  describe('GET /api/flight-bookings/:id', () => {
    it('the owner and admins can view it; other users cannot', async () => {
      const created = await hold({
        segments: [seg(out)],
        passengers: [adult()],
      }).expect(201);
      const url = `/api/flight-bookings/${created.body.id as string}`;
      const own = await http().get(url).set('x-dev-user', asA).expect(200);
      expect(own.body).toEqual(created.body);
      await http().get(url).set('x-dev-user', 'ADMIN').expect(200);
      await http().get(url).set('x-dev-user', asB).expect(403);
      await http().get(url).set('x-dev-user', moderator).expect(403);
      await http().get(url).expect(401);
      await http()
        .get(`/api/flight-bookings/${id()}`)
        .set('x-dev-user', asA)
        .expect(404);
      await http()
        .get('/api/flight-bookings/nope')
        .set('x-dev-user', asA)
        .expect(400);
    });
  });

  describe('hold expiry (FLT-22, GEN-11)', () => {
    it('an unpaid hold becomes EXPIRED and its seats return, exactly once', async () => {
      const res = await hold({
        segments: [seg(out), seg(back)],
        passengers: [adult(), child],
      }).expect(201);
      expect(await seatsLeft(out)).toBe(3);
      expect(await seatsLeft(back)).toBe(48);

      // Not yet due: nothing happens.
      expect(await lifecycle.expireHolds()).toBe(0);

      const later = new Date(Date.now() + HOLD_DURATION_MS + 1000);
      expect(await lifecycle.expireHolds(later)).toBe(1);
      expect(await lifecycle.expireHolds(later)).toBe(0);
      expect(await seatsLeft(out)).toBe(5);
      expect(await seatsLeft(back)).toBe(50);
      const view = await http()
        .get(`/api/flight-bookings/${res.body.id as string}`)
        .set('x-dev-user', asA)
        .expect(200);
      expect(view.body).toMatchObject({ status: 'EXPIRED' });
      expect(view.body.expiredAt).not.toBeNull();
    });
  });

  describe('FLIGHT_PAYABLE_BOOKING (PAY-01, FLT-23) and FLIGHT_BOOKINGS_LOOKUP (FLT-05)', () => {
    it('getPayable shows the owner what to pay and refuses anyone else', async () => {
      const res = await hold({
        segments: [seg(out)],
        passengers: [adult()],
      }).expect(201);
      await expect(
        payable.getPayable(res.body.id as string, userA),
      ).resolves.toMatchObject({
        bookingType: 'FLIGHT',
        status: 'PENDING_PAYMENT',
        amountMinor: 30000,
        currency: 'USD',
        policiesAcceptedAt: null,
        reference: null,
      });
      await expect(
        payable.getPayable(res.body.id as string, userB),
      ).rejects.toMatchObject({ status: 403 });
      await expect(payable.getPayable(id(), userA)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('markConfirmed confirms once with a unique reference; seats stay taken; replays are harmless', async () => {
      const res = await hold({
        segments: [seg(out)],
        passengers: [adult()],
      }).expect(201);
      const bookingId = res.body.id as string;
      const paymentId = id();
      await payable.markConfirmed(bookingId, { paymentId });
      const confirmed = await bookings.findById(bookingId).lean().exec();
      expect(confirmed).toMatchObject({ status: 'CONFIRMED' });
      expect(confirmed?.reference).toMatch(
        /^F[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{7}$/,
      );
      expect(await seatsLeft(out)).toBe(4);

      // The same payment again (a replayed webhook) changes nothing.
      await payable.markConfirmed(bookingId, { paymentId });
      expect(
        (await bookings.findById(bookingId).lean().exec())?.reference,
      ).toBe(confirmed?.reference);
      // A different payment cannot confirm it again.
      await expect(
        payable.markConfirmed(bookingId, { paymentId: id() }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_STATE_TRANSITION',
      });
      // Confirmed bookings are never expired by the job.
      expect(
        await lifecycle.expireHolds(
          new Date(Date.now() + 2 * HOLD_DURATION_MS),
        ),
      ).toBe(0);
      expect(await seatsLeft(out)).toBe(4);

      const lookup = app.get<FlightBookingsLookup>(FLIGHT_BOOKINGS_LOOKUP);
      await expect(lookup.confirmedBookings(out.flightId)).resolves.toEqual([
        { bookingId, userId: userA },
      ]);
      await expect(lookup.confirmedBookings(back.flightId)).resolves.toEqual(
        [],
      );
    });

    it('a payment after the hold ended cannot confirm the booking (HOLD_EXPIRED)', async () => {
      const res = await hold({
        segments: [seg(out)],
        passengers: [adult()],
      }).expect(201);
      await bookings.updateOne(
        { _id: res.body.id },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      await expect(
        payable.markConfirmed(res.body.id as string, { paymentId: id() }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'HOLD_EXPIRED',
      });
      expect(await lifecycle.expireHolds()).toBe(1);
      await expect(
        payable.markConfirmed(res.body.id as string, { paymentId: id() }),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
      });
    });

    it('a payment cannot confirm a booking whose flight was cancelled during the hold', async () => {
      const res = await hold({
        segments: [seg(out)],
        passengers: [adult()],
      }).expect(201);
      await flights.updateOne(
        { _id: out.flightId },
        { $set: { status: 'CANCELLED' } },
      );
      await expect(
        payable.markConfirmed(res.body.id as string, { paymentId: id() }),
      ).rejects.toMatchObject({
        status: 409,
      });
      expect((await bookings.findById(res.body.id).lean().exec())?.status).toBe(
        'PENDING_PAYMENT',
      );
      await flights.updateOne(
        { _id: out.flightId },
        { $set: { status: 'SCHEDULED' } },
      );
    });

    it('markPaymentFailed records the reason and keeps the booking payable', async () => {
      const res = await hold({
        segments: [seg(out)],
        passengers: [adult()],
      }).expect(201);
      await payable.markPaymentFailed(res.body.id as string, {
        paymentId: id(),
        reason: 'Your card was declined.',
      });
      const view = await http()
        .get(`/api/flight-bookings/${res.body.id as string}`)
        .set('x-dev-user', asA)
        .expect(200);
      expect(view.body).toMatchObject({
        status: 'PENDING_PAYMENT',
        lastPaymentError: 'Your card was declined.',
      });
    });

    it('a confirmed trip becomes COMPLETED after its last flight lands', async () => {
      const res = await hold({
        segments: [seg(out), seg(back)],
        passengers: [adult()],
      }).expect(201);
      await payable.markConfirmed(res.body.id as string, { paymentId: id() });
      expect(
        await lifecycle.completeTrips(new Date('2028-05-17T10:00:00Z')),
      ).toBe(0);
      expect(
        await lifecycle.completeTrips(new Date('2028-05-17T12:00:01Z')),
      ).toBe(1);
      expect((await bookings.findById(res.body.id).lean().exec())?.status).toBe(
        'COMPLETED',
      );
    });
  });
});
