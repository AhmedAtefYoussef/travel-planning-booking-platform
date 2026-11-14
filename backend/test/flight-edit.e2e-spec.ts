import { join } from 'node:path';
import { Global, INestApplication, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  FLIGHT_BOOKINGS_LOOKUP,
  NOTIFICATIONS_SERVICE,
  type ConfirmedFlightBooking,
  type FlightBookingsLookup,
  type NotificationInput,
  type NotificationsService,
} from '../src/common/contracts';
import { Flight, FlightStatus } from '../src/modules/flights';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** Stand-ins for Karim's flight-bookings (FLIGHT_BOOKINGS_LOOKUP) and notifications (GEN-01). */
const confirmed = new Map<string, ConfirmedFlightBooking[]>();
const sent: NotificationInput[] = [];
const lookup: FlightBookingsLookup = {
  confirmedBookings: (flightId) =>
    Promise.resolve(confirmed.get(flightId) ?? []),
};
const notifications: NotificationsService = {
  notify: (input) => {
    sent.push(input);
    return Promise.resolve();
  },
  notifyMany: (inputs) => {
    sent.push(...inputs);
    return Promise.resolve();
  },
};

@Global()
@Module({
  providers: [{ provide: NOTIFICATIONS_SERVICE, useValue: notifications }],
  exports: [NOTIFICATIONS_SERVICE],
})
class FakeNotificationsModule {}

/** FLT-05 on its own airline (code FE, CDG -> FRA, both UTC+1 in December). */
describe('Edit flights (e2e): FLT-05', () => {
  let app: INestApplication<App>;
  let flights: Model<Flight>;
  const http = () => request(app.getHttpServer());
  let moderator: string;
  let otherModerator: string;

  async function newFlight(flightNumber: string, seats = 100): Promise<string> {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({
        flightNumber,
        from: 'CDG',
        to: 'FRA',
        departureLocal: '2027-12-01T10:00',
        arrivalLocal: '2027-12-01T11:15',
      })
      .expect(201);
    await http()
      .post(`/api/flights/${res.body.id}/cabins`)
      .set('x-dev-user', moderator)
      .send({
        class: 'ECONOMY',
        totalSeats: seats,
        priceMinor: 12000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    return res.body.id as string;
  }

  const edit = (id: string, body: object, as = moderator) =>
    http().patch(`/api/flights/${id}`).set('x-dev-user', as).send(body);

  beforeAll(async () => {
    app = await createTestApp(
      [FakeNotificationsModule],
      // The real bookings module provides FLIGHT_BOOKINGS_LOOKUP; replace it with the stand-in.
      [{ provide: FLIGHT_BOOKINGS_LOOKUP, useValue: lookup }],
    );
    expect(app.get(FLIGHT_BOOKINGS_LOOKUP)).toBe(lookup);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Edit Test Air', code: 'FE' })
      .expect(201);
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    otherModerator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`;
  });

  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('the moderator changes the times; Confirmed passengers get an in-app notification', async () => {
    const id = await newFlight('FE100');
    confirmed.set(id, [
      { bookingId: 'booking-1', userId: 'user-1' },
      { bookingId: 'booking-2', userId: 'user-2' },
    ]);
    const res = await edit(id, {
      departureLocal: '2027-12-01T12:30',
      arrivalLocal: '2027-12-01T13:45',
    }).expect(200);
    expect(res.body).toMatchObject({
      departure: {
        airport: 'CDG',
        local: '2027-12-01T12:30:00.000+01:00',
        utc: '2027-12-01T11:30:00.000Z',
      },
      arrival: { airport: 'FRA', local: '2027-12-01T13:45:00.000+01:00' },
      durationMinutes: 75,
    });
    expect(sent).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        type: 'FLIGHT_SCHEDULE_CHANGED',
        title: 'Flight FE100 has a new schedule',
        body: 'CDG → FRA now departs 2027-12-01 12:30 and arrives 2027-12-01 13:45 (local times).',
        link: '/bookings/flights/booking-1',
      }),
      expect.objectContaining({ userId: 'user-2' }),
    ]);
  });

  it('a time not sent keeps its local time; the local date follows the new departure', async () => {
    const id = await newFlight('FE200');
    const res = await edit(id, {
      departureLocal: '2027-12-02T08:00',
      arrivalLocal: '2027-12-02T09:20',
    }).expect(200);
    expect(res.body.departureLocalDate).toBe('2027-12-02');
    const later = await edit(id, { arrivalLocal: '2027-12-02T09:40' }).expect(
      200,
    );
    expect(later.body.departure.local).toBe('2027-12-02T08:00:00.000+01:00');
    expect(later.body.durationMinutes).toBe(100);
  });

  it('airports can change while nothing is booked, not once a seat is booked or held', async () => {
    const id = await newFlight('FE300');
    const moved = await edit(id, { to: 'LHR' }).expect(200);
    expect(moved.body.arrival).toMatchObject({
      airport: 'LHR',
      local: '2027-12-01T11:15:00.000+00:00',
    });
    // An airport change without a time change notifies no one.
    expect(sent).toEqual([]);

    // Two seats taken by a booking or hold (FLT-19/FLT-20 are not built yet).
    await flights.updateOne(
      { _id: id },
      { $inc: { 'cabins.0.seatsAvailable': -2 } },
    );
    const res = await edit(id, { to: 'FRA' }).expect(409);
    expect(res.body.message).toBe(
      'Airports cannot be changed once the flight has bookings (2 seat(s) booked or held) (FLT-05)',
    );
    // Times can still change.
    await edit(id, { departureLocal: '2027-12-01T09:30' }).expect(200);
  });

  it('seat counts cannot go below booked or held seats; price changes leave the seats alone', async () => {
    const id = await newFlight('FE400', 10);
    await flights.updateOne(
      { _id: id },
      { $inc: { 'cabins.0.seatsAvailable': -6 } },
    );
    const flight = await http().get(`/api/flights/${id}`).expect(200);
    const cabinId = flight.body.cabins[0].id as string;
    await http()
      .patch(`/api/flights/${id}/cabins/${cabinId}`)
      .set('x-dev-user', moderator)
      .send({ totalSeats: 5 })
      .expect(409);
    const priced = await http()
      .patch(`/api/flights/${id}/cabins/${cabinId}`)
      .set('x-dev-user', moderator)
      .send({ priceMinor: 15000, totalSeats: 6 })
      .expect(200);
    expect(priced.body.cabins[0]).toMatchObject({
      priceMinor: 15000,
      totalSeats: 6,
      seatsAvailable: 0,
    });
  });

  it('validates the new times and airports with field errors', async () => {
    const id = await newFlight('FE500');
    const backwards = await edit(id, {
      departureLocal: '2027-12-01T16:00',
      arrivalLocal: '2027-12-01T15:00',
    }).expect(400);
    expect(
      backwards.body.fieldErrors.map((f: { field: string }) => f.field),
    ).toEqual(['arrivalLocal']);
    await edit(id, { departureLocal: '2020-01-01T10:00' }).expect(400);
    await edit(id, { departureLocal: '1 December' }).expect(400);
    await edit(id, { to: 'CDG' }).expect(400);
    await edit(id, { from: 'ZZZ' }).expect(400);
    await edit(id, {}).expect(400);
    await edit(id, { flightNumber: 'FE999' }).expect(400);
    expect(sent).toEqual([]);
  });

  it('rejects null for every field (400) and changes nothing, flight and cabin alike', async () => {
    const id = await newFlight('FE550');
    const before = await flights.findById(id).lean();
    for (const field of ['from', 'to', 'departureLocal', 'arrivalLocal']) {
      const res = await edit(id, { [field]: null }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(
        res.body.fieldErrors.map((f: { field: string }) => f.field),
      ).toContain(field);
    }
    const cabinId = String(before?.cabins[0]._id);
    for (const field of [
      'totalSeats',
      'priceMinor',
      'freeBags',
      'maxKgPerBag',
    ]) {
      await http()
        .patch(`/api/flights/${id}/cabins/${cabinId}`)
        .set('x-dev-user', moderator)
        .send({ [field]: null })
        .expect(400);
    }
    const after = await flights.findById(id).lean();
    expect(after?.from).toBe(before?.from);
    expect(after?.departureUtc).toEqual(before?.departureUtc);
    expect(after?.cabins).toEqual(before?.cabins);
    expect(sent).toEqual([]);
  });

  it('only the moderator of this airline, only Scheduled flights', async () => {
    const id = await newFlight('FE600');
    await edit(id, { arrivalLocal: '2027-12-01T11:30' }, otherModerator).expect(
      403,
    );
    await edit(id, { arrivalLocal: '2027-12-01T11:30' }, 'ADMIN').expect(403);
    await http()
      .patch(`/api/flights/${id}`)
      .send({ arrivalLocal: '2027-12-01T11:30' })
      .expect(401);
    await flights.updateOne({ _id: id }, { status: FlightStatus.Cancelled });
    await edit(id, { arrivalLocal: '2027-12-01T11:30' }).expect(409);
    await edit(new Types.ObjectId().toHexString(), {
      arrivalLocal: '2027-12-01T11:30',
    }).expect(404);
  });

  it('a new departure date that clashes with the same flight number returns 409', async () => {
    await newFlight('FE700');
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({
        flightNumber: 'FE700',
        from: 'CDG',
        to: 'FRA',
        departureLocal: '2027-12-03T10:00',
        arrivalLocal: '2027-12-03T11:15',
      })
      .expect(201);
    await edit(res.body.id, {
      departureLocal: '2027-12-01T18:00',
      arrivalLocal: '2027-12-01T19:15',
    }).expect(409);
  });
});
