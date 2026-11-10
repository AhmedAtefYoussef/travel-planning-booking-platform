import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Airline, Flight } from '../src/modules/flights';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** FLT-04 (+ the FLT-05 seat floor): cabins per flight, owned by the airline's moderator. */
describe('Flight cabins (e2e): FLT-04', () => {
  let app: INestApplication<App>;
  let flights: Model<Flight>;
  const http = () => request(app.getHttpServer());
  let moderator: string;
  let flightId: string;
  let economyId: string;

  const economy = {
    class: 'ECONOMY',
    totalSeats: 150,
    priceMinor: 25000,
    freeBags: 1,
    maxKgPerBag: 23,
  };

  const newFlight = async (flightNumber: string) =>
    (
      await http()
        .post('/api/flights')
        .set('x-dev-user', moderator)
        .send({
          flightNumber,
          from: 'CAI',
          to: 'DXB',
          departureLocal: '2027-12-01T14:30',
          arrivalLocal: '2027-12-01T18:45',
        })
        .expect(201)
    ).body.id as string;

  /** Simulates seats taken by holds or bookings (FLT-22 / ADR-0002 conditional decrement). */
  const takeSeats = (id: string, cabinId: string, n: number) =>
    flights.updateOne(
      {
        _id: id,
        cabins: { $elemMatch: { _id: cabinId, seatsAvailable: { $gte: n } } },
      },
      { $inc: { 'cabins.$.seatsAvailable': -n } },
    );

  beforeAll(async () => {
    app = await createTestApp();
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const airline = await request(app.getHttpServer())
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Cabin Test Air', code: 'CB' })
      .expect(201);
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    flightId = await newFlight('CB100');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/flights/:id/cabins', () => {
    it('adds a cabin with every seat available', async () => {
      const res = await http()
        .post(`/api/flights/${flightId}/cabins`)
        .set('x-dev-user', moderator)
        .send({ ...economy, class: 'economy' })
        .expect(201);
      expect(res.body.cabins).toHaveLength(1);
      expect(res.body.cabins[0]).toMatchObject({
        class: 'ECONOMY',
        totalSeats: 150,
        seatsAvailable: 150,
        priceMinor: 25000,
        freeBags: 1,
        maxKgPerBag: 23,
      });
      expect(res.body.departure.local).toBe('2027-12-01T14:30:00.000+02:00');
      economyId = res.body.cabins[0].id;
    });

    it('allows each class at most once per flight (409)', async () => {
      const res = await http()
        .post(`/api/flights/${flightId}/cabins`)
        .set('x-dev-user', moderator)
        .send(economy)
        .expect(409);
      expect(res.body.message).toContain('already has a ECONOMY cabin');
    });

    it('adds a second, different class', async () => {
      const res = await http()
        .post(`/api/flights/${flightId}/cabins`)
        .set('x-dev-user', moderator)
        .send({
          class: 'BUSINESS',
          totalSeats: 20,
          priceMinor: 90000,
          freeBags: 2,
          maxKgPerBag: 32,
        })
        .expect(201);
      expect(res.body.cabins.map((c: { class: string }) => c.class)).toEqual([
        'ECONOMY',
        'BUSINESS',
      ]);
    });

    it('never creates the same class twice under parallel requests', async () => {
      const id = await newFlight('CB101');
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          http()
            .post(`/api/flights/${id}/cabins`)
            .set('x-dev-user', moderator)
            .send(economy),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      const stored = await flights.findById(id).lean().exec();
      expect(stored?.cabins).toHaveLength(1);
    });

    it('validates the fixed class set, whole positive seats and prices, and baggage limits', async () => {
      const res = await http()
        .post(`/api/flights/${flightId}/cabins`)
        .set('x-dev-user', moderator)
        .send({
          class: 'LUXURY',
          totalSeats: 0,
          priceMinor: 99.5,
          freeBags: -1,
          maxKgPerBag: 0,
        })
        .expect(400);
      expect(
        res.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
      ).toEqual([
        'class',
        'freeBags',
        'maxKgPerBag',
        'priceMinor',
        'totalSeats',
      ]);
    });

    it("only the flight's airline moderator may add cabins", async () => {
      const other = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`;
      await http()
        .post(`/api/flights/${flightId}/cabins`)
        .set('x-dev-user', other)
        .send({ ...economy, class: 'FIRST' })
        .expect(403);
      await http()
        .post(`/api/flights/${flightId}/cabins`)
        .set('x-dev-user', `USER:${new Types.ObjectId().toHexString()}`)
        .send({ ...economy, class: 'FIRST' })
        .expect(403);
      await http()
        .post(`/api/flights/${new Types.ObjectId().toHexString()}/cabins`)
        .set('x-dev-user', moderator)
        .send({ ...economy, class: 'FIRST' })
        .expect(404);
    });
  });

  describe('PATCH /api/flights/:id/cabins/:cabinId', () => {
    it('rejects null for every field and changes nothing', async () => {
      const before = await flights.findById(flightId).lean();
      for (const field of [
        'totalSeats',
        'priceMinor',
        'freeBags',
        'maxKgPerBag',
      ]) {
        const res = await http()
          .patch(`/api/flights/${flightId}/cabins/${economyId}`)
          .set('x-dev-user', moderator)
          .send({ [field]: null })
          .expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(
          res.body.fieldErrors.map((f: { field: string }) => f.field),
        ).toContain(field);
      }
      const after = await flights.findById(flightId).lean();
      expect(after?.cabins).toEqual(before?.cabins);
    });

    it('rejects 1e20 and 1e300 for every field (400) and changes nothing', async () => {
      const before = await flights.findById(flightId).lean();
      for (const field of [
        'totalSeats',
        'priceMinor',
        'freeBags',
        'maxKgPerBag',
      ]) {
        for (const value of [1e20, 1e300]) {
          const res = await http()
            .patch(`/api/flights/${flightId}/cabins/${economyId}`)
            .set('x-dev-user', moderator)
            .send({ [field]: value })
            .expect(400);
          expect(res.body.code).toBe('VALIDATION_FAILED');
          expect(
            res.body.fieldErrors.map((f: { field: string }) => f.field),
          ).toEqual([field]);
        }
      }
      const after = await flights.findById(flightId).lean();
      expect(after?.cabins).toEqual(before?.cabins);
    });

    it('changes the price without touching seats', async () => {
      const res = await http()
        .patch(`/api/flights/${flightId}/cabins/${economyId}`)
        .set('x-dev-user', moderator)
        .send({ priceMinor: 27500 })
        .expect(200);
      expect(res.body.cabins[0]).toMatchObject({
        priceMinor: 27500,
        totalSeats: 150,
        seatsAvailable: 150,
      });
    });

    it('raising totalSeats raises seatsAvailable by the same amount', async () => {
      const res = await http()
        .patch(`/api/flights/${flightId}/cabins/${economyId}`)
        .set('x-dev-user', moderator)
        .send({ totalSeats: 180 })
        .expect(200);
      expect(res.body.cabins[0]).toMatchObject({
        totalSeats: 180,
        seatsAvailable: 180,
      });
    });

    it('cannot reduce seats below those already booked or held (FLT-05 floor)', async () => {
      await takeSeats(flightId, economyId, 30);
      const res = await http()
        .patch(`/api/flights/${flightId}/cabins/${economyId}`)
        .set('x-dev-user', moderator)
        .send({ totalSeats: 29 })
        .expect(409);
      expect(res.body.message).toBe(
        'Cannot reduce ECONOMY to 29 seats: 30 are already booked or held',
      );
      const exact = await http()
        .patch(`/api/flights/${flightId}/cabins/${economyId}`)
        .set('x-dev-user', moderator)
        .send({ totalSeats: 30 })
        .expect(200);
      expect(exact.body.cabins[0]).toMatchObject({
        totalSeats: 30,
        seatsAvailable: 0,
      });
      const back = await http()
        .patch(`/api/flights/${flightId}/cabins/${economyId}`)
        .set('x-dev-user', moderator)
        .send({ totalSeats: 100 })
        .expect(200);
      expect(back.body.cabins[0]).toMatchObject({
        totalSeats: 100,
        seatsAvailable: 70,
      });
    });

    it('never oversells when seats are taken while the moderator lowers the total', async () => {
      // 100 seats, 30 already taken. 20 one-seat holds race a reduction to 40.
      const results = await Promise.all([
        ...Array.from({ length: 20 }, () => takeSeats(flightId, economyId, 1)),
        http()
          .patch(`/api/flights/${flightId}/cabins/${economyId}`)
          .set('x-dev-user', moderator)
          .send({ totalSeats: 40 }),
      ]);
      const patch = results[20] as request.Response;
      expect([200, 409]).toContain(patch.status);
      const stored = await flights.findById(flightId).lean().exec();
      const cabin = stored!.cabins.find(
        (c) => c._id.toHexString() === economyId,
      )!;
      const holds = (
        results.slice(0, 20) as { modifiedCount: number }[]
      ).filter((r) => r.modifiedCount === 1).length;
      // Invariants: never negative, never more taken than exist, and every seat accounted for.
      expect(cabin.seatsAvailable).toBeGreaterThanOrEqual(0);
      expect(cabin.totalSeats - cabin.seatsAvailable).toBe(30 + holds);
      expect(cabin.totalSeats).toBe(patch.status === 200 ? 40 : 100);
    });

    it('rejects an empty edit, a class change and an unknown cabin', async () => {
      await http()
        .patch(`/api/flights/${flightId}/cabins/${economyId}`)
        .set('x-dev-user', moderator)
        .send({})
        .expect(400);
      const res = await http()
        .patch(`/api/flights/${flightId}/cabins/${economyId}`)
        .set('x-dev-user', moderator)
        .send({ class: 'FIRST' })
        .expect(400);
      expect(res.body.fieldErrors[0].field).toBe('class');
      await http()
        .patch(
          `/api/flights/${flightId}/cabins/${new Types.ObjectId().toHexString()}`,
        )
        .set('x-dev-user', moderator)
        .send({ priceMinor: 1 })
        .expect(404);
    });

    it('only Scheduled flights can be changed (FLT-30)', async () => {
      const id = await newFlight('CB102');
      const added = await http()
        .post(`/api/flights/${id}/cabins`)
        .set('x-dev-user', moderator)
        .send(economy)
        .expect(201);
      await flights.updateOne({ _id: id }, { $set: { status: 'CANCELLED' } });
      await http()
        .patch(`/api/flights/${id}/cabins/${added.body.cabins[0].id}`)
        .set('x-dev-user', moderator)
        .send({ priceMinor: 1 })
        .expect(409);
      await http()
        .post(`/api/flights/${id}/cabins`)
        .set('x-dev-user', moderator)
        .send({ ...economy, class: 'FIRST' })
        .expect(409);
    });
  });

  describe('limits (review of #11)', () => {
    it('accepts large seat counts and free-bag allowances; only maxKgPerBag is capped (100 kg)', async () => {
      const id = await newFlight('CB800');
      await http()
        .post(`/api/flights/${id}/cabins`)
        .set('x-dev-user', moderator)
        .send({ ...economy, totalSeats: 5000, freeBags: 12 })
        .expect(201);
      const heavy = await http()
        .post(`/api/flights/${id}/cabins`)
        .set('x-dev-user', moderator)
        .send({ ...economy, class: 'BUSINESS', maxKgPerBag: 101 })
        .expect(400);
      expect(heavy.body.fieldErrors[0].field).toBe('maxKgPerBag');
    });
  });

  it("a deactivated airline's moderator cannot add or change cabins (ACC-15)", async () => {
    const other = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Inactive Cabin Air', code: 'CX' })
      .expect(201);
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${other.body.id}`;
    const created = await http()
      .post('/api/flights')
      .set('x-dev-user', mod)
      .send({
        flightNumber: 'CX100',
        from: 'CAI',
        to: 'DXB',
        departureLocal: '2027-12-01T14:30',
        arrivalLocal: '2027-12-01T18:45',
      })
      .expect(201);
    const withCabin = await http()
      .post(`/api/flights/${created.body.id}/cabins`)
      .set('x-dev-user', mod)
      .send(economy)
      .expect(201);
    await app
      .get<Model<Airline>>(getModelToken(Airline.name))
      .updateOne({ _id: other.body.id }, { isActive: false });
    await http()
      .post(`/api/flights/${created.body.id}/cabins`)
      .set('x-dev-user', mod)
      .send({ ...economy, class: 'FIRST' })
      .expect(403);
    await http()
      .patch(
        `/api/flights/${created.body.id}/cabins/${withCabin.body.cabins[0].id}`,
      )
      .set('x-dev-user', mod)
      .send({ priceMinor: 1 })
      .expect(403);
  });
});
