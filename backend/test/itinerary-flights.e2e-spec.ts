import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * ITN-26: flights from an origin airport to the city of the itinerary's first day (and back from it
 * for a round trip), through the shared FLT-11/FLT-12 search (FLIGHTS_SEARCH).
 */
describe('Itinerary flight search (e2e): ITN-26', () => {
  let app: INestApplication<App>;
  let owner: LoggedIn;
  let id: string;
  const http = () => request(app.getHttpServer());

  async function flight(
    moderator: string,
    from: string,
    to: string,
    local: string,
    number: string,
  ) {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({
        flightNumber: number,
        from,
        to,
        departureLocal: `${local}T10:00`,
        arrivalLocal: `${local}T14:00`,
      })
      .expect(201);
    await http()
      .post(`/api/flights/${res.body.id as string}/cabins`)
      .set('x-dev-user', moderator)
      .send({
        class: 'ECONOMY',
        totalSeats: 10,
        priceMinor: 30000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    return res.body.id as string;
  }

  let outboundId: string;
  let returnId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    owner = await loginAs(app, Role.User);
    let airline: request.Response | undefined;
    for (let attempt = 0; attempt < 5 && airline?.status !== 201; attempt++) {
      const code = `I${Math.floor(Math.random() * 90 + 10)}`;
      airline = await http()
        .post('/api/airlines')
        .set('x-dev-user', 'ADMIN')
        .send({ name: `Itinerary Air ${code}`, code });
    }
    const moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline?.body.id as string}`;
    outboundId = await flight(moderator, 'RUH', 'CAI', '2028-03-01', 'IT100');
    returnId = await flight(moderator, 'DXB', 'RUH', '2028-03-04', 'IT200');
    await flight(moderator, 'RUH', 'CAI', '2028-03-02', 'IT101');
    id = (
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Flights',
          countries: ['EG', 'AE'],
          startDate: '2028-03-01',
        })
        .expect(201)
    ).body.id as string;
    for (const cityId of ['cairo', 'cairo', 'dubai', 'dubai']) {
      await http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (qs: string, as: LoggedIn = owner) =>
    http().get(`/api/itineraries/${id}/flights?${qs}`).set('Cookie', as.cookie);

  it('one way: from the origin to the first day city on the start date by default', async () => {
    const res = await get('origin=ruh').expect(200);
    expect(res.body).toMatchObject({
      origin: 'RUH',
      destinationCityId: 'cairo',
      destinationAirports: ['CAI'],
      tripType: 'ONE_WAY',
      departureDate: '2028-03-01',
      returnDate: null,
      return: null,
    });
    expect(
      res.body.outbound.items.map((f: { flightId: string }) => f.flightId),
    ).toEqual([outboundId]);
    const other = await get('origin=RUH&departureDate=2028-03-02').expect(200);
    expect(other.body.outbound.items).toHaveLength(1);
    expect(other.body.outbound.items[0].flightId).not.toBe(outboundId);
  });

  it('round trip: the return date defaults to the last day, from the first city', async () => {
    const res = await get(
      'origin=RUH&tripType=ROUND_TRIP&adults=2&children=1&infants=1',
    ).expect(200);
    expect(res.body).toMatchObject({
      tripType: 'ROUND_TRIP',
      returnDate: '2028-03-04',
    });
    expect(res.body.outbound.items).toHaveLength(1);
    // The return leg leaves the first day's city (Cairo), so the Dubai flight is not offered.
    expect(res.body.return).toMatchObject({ items: [], total: 0 });
    expect(returnId).toBeDefined();
  });

  it('validates the origin, passengers and dates', async () => {
    expect((await get('origin=XXX').expect(400)).body.fieldErrors).toEqual([
      expect.objectContaining({ field: 'origin' }),
    ]);
    expect((await get('origin=CAI').expect(400)).body.fieldErrors).toEqual([
      expect.objectContaining({ field: 'origin' }),
    ]);
    await get('').expect(400);
    await get('origin=RUH&adults=0').expect(400);
    await get('origin=RUH&adults=1&infants=2').expect(400);
    await get('origin=RUH&tripType=BOTH').expect(400);
    await get('origin=RUH&returnDate=2028-03-04').expect(400);
    await get('origin=RUH&tripType=ROUND_TRIP&returnDate=2028-02-01').expect(
      400,
    );
    await get('origin=RUH&departureDate=2028-02-30').expect(400);
    await get('origin=RUH&cabinClass=LUXURY').expect(400);
  });

  it('an itinerary without days is 400; another user gets 404', async () => {
    const empty = (
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({ title: 'Empty', countries: ['EG'], startDate: '2028-03-01' })
        .expect(201)
    ).body.id as string;
    await http()
      .get(`/api/itineraries/${empty}/flights?origin=RUH`)
      .set('Cookie', owner.cookie)
      .expect(400);
    const stranger = await loginAs(app, Role.User);
    await get('origin=RUH', stranger).expect(404);
  });
});
