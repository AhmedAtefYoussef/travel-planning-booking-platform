import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Flight } from '../src/modules/flights';
import { FlightStatusService } from '../src/modules/flights/flight-status.service';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** FLT-30 on its own route (LHR -> CDG): Scheduled -> Departed; only Scheduled flights are usable. */
describe('Flight status lifecycle (e2e): FLT-30', () => {
  let app: INestApplication<App>;
  let flights: Model<Flight>;
  const http = () => request(app.getHttpServer());
  let moderator: string;

  const economy = {
    class: 'ECONOMY',
    totalSeats: 100,
    priceMinor: 15000,
    freeBags: 1,
    maxKgPerBag: 23,
  };

  async function newFlight(flightNumber: string): Promise<string> {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({
        flightNumber,
        from: 'LHR',
        to: 'CDG',
        departureLocal: '2027-12-01T09:00',
        arrivalLocal: '2027-12-01T11:15',
      })
      .expect(201);
    await http()
      .post(`/api/flights/${res.body.id}/cabins`)
      .set('x-dev-user', moderator)
      .send(economy)
      .expect(201);
    return res.body.id as string;
  }

  const search = () =>
    http()
      .get('/api/flights/search')
      .query({
        from: 'LHR',
        to: 'CDG',
        departureDate: '2027-12-01',
        passengers: 1,
      })
      .expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const airline = await request(app.getHttpServer())
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Status Test Air', code: 'ST' })
      .expect(201);
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('new flights start Scheduled', async () => {
    const id = await newFlight('ST100');
    const stored = await flights.findById(id).lean().exec();
    expect(stored?.status).toBe('SCHEDULED');
  });

  it('the job marks a flight Departed once its departure time has passed, and only that one', async () => {
    const past = await newFlight('ST200');
    const future = await newFlight('ST300');
    // Simulate the clock passing ST200's departure.
    await flights.updateOne(
      { _id: past },
      {
        $set: {
          departureUtc: new Date(Date.now() - 60_000),
          arrivalUtc: new Date(Date.now() + 3_600_000),
        },
      },
    );

    const changed = await app.get(FlightStatusService).markDeparted();
    expect(changed).toBeGreaterThanOrEqual(1);
    expect((await flights.findById(past).lean().exec())?.status).toBe(
      'DEPARTED',
    );
    expect((await flights.findById(future).lean().exec())?.status).toBe(
      'SCHEDULED',
    );

    // Running it again changes nothing for these flights.
    await app.get(FlightStatusService).markDeparted();
    expect((await flights.findById(future).lean().exec())?.status).toBe(
      'SCHEDULED',
    );
  });

  it('only Scheduled flights are searchable', async () => {
    const id = await newFlight('ST400');
    const before = await search();
    expect(
      before.body.items.map((i: { flightNumber: string }) => i.flightNumber),
    ).toContain('ST400');
    await flights.updateOne({ _id: id }, { $set: { status: 'DEPARTED' } });
    const after = await search();
    expect(
      after.body.items.map((i: { flightNumber: string }) => i.flightNumber),
    ).not.toContain('ST400');
  });

  it('only Scheduled flights are editable, including right after departure before the job runs', async () => {
    const departed = await newFlight('ST500');
    await flights.updateOne(
      { _id: departed },
      { $set: { status: 'DEPARTED' } },
    );
    await http()
      .post(`/api/flights/${departed}/cabins`)
      .set('x-dev-user', moderator)
      .send({ ...economy, class: 'BUSINESS' })
      .expect(409);

    const justLeft = await newFlight('ST600');
    await flights.updateOne(
      { _id: justLeft },
      {
        $set: {
          departureUtc: new Date(Date.now() - 1_000),
          arrivalUtc: new Date(Date.now() + 3_600_000),
        },
      },
    );
    const res = await http()
      .post(`/api/flights/${justLeft}/cabins`)
      .set('x-dev-user', moderator)
      .send({ ...economy, class: 'BUSINESS' })
      .expect(409);
    expect(res.body.message).toBe(
      'This flight has already departed and can no longer be changed (FLT-30)',
    );
  });
});
