import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Flight, FlightStatus } from '../src/modules/flights';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

interface FlightRow {
  id: string;
  airlineId: string;
  flightNumber: string;
  status: string;
  departure: { local: string };
}

/**
 * FLT-03 / FE-07: GET /api/airlines/:id/flights lists one airline's flights for its moderator's
 * dashboard: 10 per page (GEN-05), soonest departure first, local times (GEN-06), optional status.
 */
describe('Airline flights list (e2e): FLT-03 / FE-07', () => {
  let app: INestApplication<App>;
  let flights: Model<Flight>;
  const http = () => request(app.getHttpServer());
  let airlineId: string;
  let moderator: string;
  let otherModerator: string;
  const ids: string[] = [];

  async function airline(name: string, code: string): Promise<string> {
    const res = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name, code })
      .expect(201);
    return res.body.id as string;
  }

  async function flight(as: string, flightNumber: string, day: number) {
    const date = `2027-12-${String(day).padStart(2, '0')}`;
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', as)
      .send({
        flightNumber,
        from: 'CAI',
        to: 'DXB',
        departureLocal: `${date}T10:00`,
        arrivalLocal: `${date}T14:00`,
      })
      .expect(201);
    return res.body.id as string;
  }

  const list = (query = '', as: string | null = moderator) => {
    const req = http().get(`/api/airlines/${airlineId}/flights${query}`);
    return as ? req.set('x-dev-user', as) : req;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));

    airlineId = await airline('List Test Air', 'LT');
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;
    const otherAirline = await airline('Other Test Air', 'OT');
    otherModerator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${otherAirline}`;

    // Created out of order, so the response order proves the sort: days 12, 11, ..., 1.
    for (let day = 12; day >= 1; day--) {
      ids.push(await flight(moderator, `LT${100 + day}`, day));
    }
    // A flight of another airline must never appear.
    await flight(otherModerator, 'OT100', 5);
    // Day 3 is cancelled.
    await flights
      .updateOne(
        { flightNumber: 'LT103' },
        { $set: { status: FlightStatus.Cancelled } },
      )
      .exec();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists only this airline, soonest departure first, 10 per page with local times', async () => {
    const first = await list().expect(200);
    expect(first.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    const rows = first.body.items as FlightRow[];
    expect(rows).toHaveLength(10);
    expect(rows.map((f) => f.flightNumber)).toEqual(
      Array.from({ length: 10 }, (_, i) => `LT${101 + i}`),
    );
    expect(rows.every((f) => f.airlineId === airlineId)).toBe(true);
    // Cairo is UTC+2 in December (GEN-06).
    expect(rows[0].departure.local).toBe('2027-12-01T10:00:00.000+02:00');

    const second = await list('?page=2').expect(200);
    expect(
      (second.body.items as FlightRow[]).map((f) => f.flightNumber),
    ).toEqual(['LT111', 'LT112']);
  });

  it('filters by status, case-insensitively', async () => {
    const cancelled = await list('?status=cancelled').expect(200);
    expect(cancelled.body.total).toBe(1);
    expect((cancelled.body.items as FlightRow[])[0]).toMatchObject({
      flightNumber: 'LT103',
      status: 'CANCELLED',
    });
    const scheduled = await list('?status=SCHEDULED').expect(200);
    expect(scheduled.body.total).toBe(11);
  });

  it('rejects a bad status or page with field errors', async () => {
    const res = await list('?status=LANDED&page=0').expect(400);
    const fields = (res.body.fieldErrors as { field: string }[]).map(
      (e) => e.field,
    );
    expect(fields).toEqual(expect.arrayContaining(['status', 'page']));
  });

  it("refuses another airline's moderator, other roles and guests", async () => {
    await list('', otherModerator).expect(403);
    await list('', `USER:${new Types.ObjectId().toHexString()}`).expect(403);
    await list('', null).expect(401);
  });

  it('rejects an airline id that is not an ObjectId', async () => {
    await http()
      .get('/api/airlines/not-an-id/flights')
      .set('x-dev-user', moderator)
      .expect(400);
  });
});
