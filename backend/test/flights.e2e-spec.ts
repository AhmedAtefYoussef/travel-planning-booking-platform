import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline } from '../src/modules/flights';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** FLT-03 + GEN-06: moderators create flights in airport-local time; responses show UTC and local. */
describe('Flights (e2e): FLT-03, GEN-06', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let airlineId: string;
  let moderator: string;

  const flight = (overrides: Record<string, string> = {}) => ({
    flightNumber: 'FT777',
    from: 'CAI',
    to: 'DXB',
    departureLocal: '2027-12-01T14:30',
    arrivalLocal: '2027-12-01T18:45',
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const airline = await request(app.getHttpServer())
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Flight Test Air', code: 'FT' })
      .expect(201);
    airlineId = airline.body.id;
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a Scheduled flight for the moderator’s airline, stored in UTC and shown in local time', async () => {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send(flight({ from: 'cai', to: 'dxb' }))
      .expect(201);
    expect(res.body).toMatchObject({
      airlineId,
      flightNumber: 'FT777',
      status: 'SCHEDULED',
      departureLocalDate: '2027-12-01',
      durationMinutes: 135,
      cabins: [],
      departure: {
        airport: 'CAI',
        timeZone: 'Africa/Cairo',
        utc: '2027-12-01T12:30:00.000Z',
        local: '2027-12-01T14:30:00.000+02:00',
      },
      arrival: {
        airport: 'DXB',
        timeZone: 'Asia/Dubai',
        utc: '2027-12-01T14:45:00.000Z',
        local: '2027-12-01T18:45:00.000+04:00',
      },
    });
  });

  it('rejects the same flight number for the same airline on the same local date (409)', async () => {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send(
        flight({
          departureLocal: '2027-12-01T20:00',
          arrivalLocal: '2027-12-02T00:15',
        }),
      )
      .expect(409);
    expect(res.body.code).toBe('DUPLICATE_KEY');
  });

  it('allows the same number on another local date', async () => {
    await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send(
        flight({
          departureLocal: '2027-12-02T14:30',
          arrivalLocal: '2027-12-02T18:45',
        }),
      )
      .expect(201);
  });

  it('returns field errors for identical airports, past departures and arrival before departure', async () => {
    const same = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send(
        flight({
          flightNumber: 'FT1',
          to: 'CAI',
          arrivalLocal: '2027-12-01T16:30',
        }),
      )
      .expect(400);
    expect(same.body.fieldErrors).toEqual([
      { field: 'to', message: 'Departure and arrival airports must differ' },
    ]);

    const past = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send(
        flight({
          flightNumber: 'FT2',
          departureLocal: '2024-01-01T10:00',
          arrivalLocal: '2024-01-01T14:00',
        }),
      )
      .expect(400);
    expect(past.body.fieldErrors[0].field).toBe('departureLocal');

    const backwards = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send(
        flight({
          flightNumber: 'FT3',
          departureLocal: '2027-12-01T17:00',
          arrivalLocal: '2027-12-01T18:00',
        }),
      )
      .expect(400);
    expect(backwards.body.fieldErrors).toEqual([
      {
        field: 'arrivalLocal',
        message: 'Arrival must be after departure (compared in UTC)',
      },
    ]);
  });

  it('accepts only seeded airports (FLT-02)', async () => {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send(flight({ flightNumber: 'FT4', to: 'XXX' }))
      .expect(400);
    expect(res.body.fieldErrors).toEqual([
      { field: 'to', message: 'Unknown airport "XXX" (see GET /api/airports)' },
    ]);
  });

  it('rejects a malformed body and an airlineId in the body (the airline comes from the caller)', async () => {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({ ...flight(), departureLocal: '01/12/2027 14:30', airlineId })
      .expect(400);
    expect(
      res.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
    ).toEqual(['airlineId', 'departureLocal']);
  });

  it('only airline moderators can create flights', async () => {
    await http().post('/api/flights').send(flight()).expect(401);
    await http()
      .post('/api/flights')
      .set('x-dev-user', `USER:${new Types.ObjectId().toHexString()}`)
      .send(flight())
      .expect(403);
    await http()
      .post('/api/flights')
      .set('x-dev-user', 'ADMIN')
      .send(flight())
      .expect(403);
  });

  it('returns 404 when the moderator’s airline does not exist', async () => {
    await http()
      .post('/api/flights')
      .set(
        'x-dev-user',
        `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`,
      )
      .send(flight({ flightNumber: 'FT5' }))
      .expect(404);
  });

  it("a deactivated airline's moderator cannot create flights (ACC-15)", async () => {
    const other = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Inactive Test Air', code: 'FX' })
      .expect(201);
    await app
      .get<Model<Airline>>(getModelToken(Airline.name))
      .updateOne({ _id: other.body.id }, { isActive: false });
    const res = await http()
      .post('/api/flights')
      .set(
        'x-dev-user',
        `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${other.body.id}`,
      )
      .send(flight({ flightNumber: 'FX100' }))
      .expect(403);
    expect(res.body.message).toBe(
      'This airline is deactivated (ACC-15), so its flights cannot be created or changed',
    );
  });
});
