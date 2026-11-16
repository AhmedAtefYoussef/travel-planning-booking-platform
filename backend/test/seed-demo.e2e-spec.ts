import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { DEMO_ACCOUNTS, DEMO_AIRLINE, DEMO_HOTEL } from '../scripts/demo-data';
import { seedDemo } from '../scripts/demo-seed';
import { Airline, Flight, FlightStatus } from '../src/modules/flights';
import { Hotel, Room } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { User } from '../src/modules/users';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const PASSWORD = 'Demo2028pass';

/** TRVL-135: `npm run seed:demo` builds the demo data once and is safe to run again. */
describe('Demo seed (e2e): TRVL-135', () => {
  let app: INestApplication<App>;
  let ids: { airlineId: string; hotelId: string };
  const count = <T>(token: string, filter = {}) =>
    app.get<Model<T>>(getModelToken(token)).countDocuments(filter);

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the airline, hotel, flights, rooms and accounts', async () => {
    const first = await seedDemo(app, PASSWORD);
    ids = first;
    expect(first.created).toEqual(
      expect.arrayContaining(['airline', 'hotel', 'flights', 'rooms']),
    );
    expect(await count(Airline.name, { code: DEMO_AIRLINE.code })).toBe(1);
    expect(await count(Hotel.name, { name: DEMO_HOTEL.name })).toBe(1);
    expect(await count(Flight.name, { airlineId: ids.airlineId })).toBe(2);
    expect(await count(Room.name, { hotelId: ids.hotelId })).toBe(2);
    expect(
      await count(User.name, {
        email: {
          $in: Object.values(DEMO_ACCOUNTS).map((a) => a.email),
        },
      }),
    ).toBe(3);

    const airline = await app
      .get<Model<Airline>>(getModelToken(Airline.name))
      .findOne({ code: 'DM' })
      .lean();
    expect(airline?.policy?.extraBaggage).toMatchObject({
      pricePerBagMinor: 4000,
    });
    expect(airline?.policy?.cancellationTiers).toHaveLength(3);
    const flights = await app
      .get<Model<Flight>>(getModelToken(Flight.name))
      .find({ airlineId: ids.airlineId })
      .lean();
    expect(flights.every((f) => f.status === FlightStatus.Scheduled)).toBe(
      true,
    );
    expect(flights.every((f) => f.cabins.length === 1)).toBe(true);
    const hotel = await app
      .get<Model<Hotel>>(getModelToken(Hotel.name))
      .findOne({ name: DEMO_HOTEL.name })
      .lean();
    expect(hotel).toMatchObject({
      checkInTime: '14:00',
      checkOutTime: '12:00',
    });
    expect(hotel?.cancellationTiers).toHaveLength(2);
    const rooms = await app
      .get<Model<Room>>(getModelToken(Room.name))
      .find({ hotelId: ids.hotelId })
      .lean();
    expect(rooms.every((r) => r.availability.length === 1)).toBe(true);
  });

  it('moderators log in without a forced password change', async () => {
    for (const account of [
      DEMO_ACCOUNTS.airlineModerator,
      DEMO_ACCOUNTS.hotelModerator,
      DEMO_ACCOUNTS.traveller,
    ]) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: account.email, password: PASSWORD })
        .expect(200);
      expect(res.body.user.mustChangePassword).toBe(false);
    }
  });

  it('running it again creates nothing new', async () => {
    const second = await seedDemo(app, PASSWORD);
    expect(second.created).toEqual([]);
    expect(await count(Airline.name, { code: DEMO_AIRLINE.code })).toBe(1);
    expect(await count(Hotel.name, { name: DEMO_HOTEL.name })).toBe(1);
    expect(await count(Flight.name, { airlineId: ids.airlineId })).toBe(2);
    expect(await count(Room.name, { hotelId: ids.hotelId })).toBe(2);
    expect(
      await count(User.name, {
        email: { $in: Object.values(DEMO_ACCOUNTS).map((a) => a.email) },
      }),
    ).toBe(3);
  });

  it('refuses to reuse a demo email that belongs to another kind of account', async () => {
    await app
      .get<Model<User>>(getModelToken(User.name))
      .updateOne(
        { email: DEMO_ACCOUNTS.traveller.email },
        { $set: { role: 'ADMIN' } },
      );
    await expect(seedDemo(app, PASSWORD)).rejects.toThrow(
      /demo\.traveller@example\.com.*already belongs/,
    );
    await app
      .get<Model<User>>(getModelToken(User.name))
      .updateOne(
        { email: DEMO_ACCOUNTS.traveller.email },
        { $set: { role: 'USER' } },
      );
  });

  it('reports the ids it created or reused, and never a password', async () => {
    const result = await seedDemo(app, PASSWORD);
    expect(result.airlineId).toBe(ids.airlineId);
    expect(result.hotelId).toBe(ids.hotelId);
    expect(result.flights.map((f) => f.flightNumber)).toEqual([
      'DM101',
      'DM102',
    ]);
    for (const f of result.flights) {
      expect(f.id).toMatch(/^[a-f0-9]{24}$/);
      expect(f.cabinId).toMatch(/^[a-f0-9]{24}$/);
    }
    expect(result.rooms.map((r) => r.number)).toEqual(['101', '102']);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it('still recognises the demo airline and hotel after their moderators rename them', async () => {
    const airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    const hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    await airlines.updateOne(
      { _id: ids.airlineId },
      { $set: { name: 'Demo Air Express', code: 'DX' } },
    );
    await hotels.updateOne(
      { _id: ids.hotelId },
      { $set: { name: 'Demo Nile Palace', address: '2 New Street' } },
    );
    const again = await seedDemo(app, PASSWORD);
    expect(again.created).toEqual([]);
    expect(again.airlineId).toBe(ids.airlineId);
    expect(again.hotelId).toBe(ids.hotelId);
    expect(await count(Airline.name, { code: 'DM' })).toBe(0);
    await airlines.updateOne(
      { _id: ids.airlineId },
      { $set: { name: 'Demo Air', code: 'DM' } },
    );
    await hotels.updateOne(
      { _id: ids.hotelId },
      { $set: { name: DEMO_HOTEL.name, address: DEMO_HOTEL.address } },
    );
  });

  it('refuses to adopt an airline or hotel that is not the demo one', async () => {
    // Without the demo moderator nothing marks the records as the seed's, so only an exact match is adopted.
    const users = app.get<Model<User>>(getModelToken(User.name));
    const airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    await users.deleteOne({ email: DEMO_ACCOUNTS.airlineModerator.email });
    await airlines.updateOne({ code: 'DM' }, { $set: { name: 'Other Air' } });
    await expect(seedDemo(app, PASSWORD)).rejects.toThrow(
      /airline with code DM is not the demo airline/,
    );
    await airlines.updateOne({ code: 'DM' }, { $set: { name: 'Demo Air' } });

    const hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    await users.deleteOne({ email: DEMO_ACCOUNTS.hotelModerator.email });
    await hotels.updateOne(
      { name: DEMO_HOTEL.name },
      { $set: { address: '9 Somewhere Else' } },
    );
    await expect(seedDemo(app, PASSWORD)).rejects.toThrow(
      /hotel named .* is not the demo hotel/,
    );
    await hotels.updateOne(
      { name: DEMO_HOTEL.name },
      { $set: { address: DEMO_HOTEL.address } },
    );
    // With the exact records back, the seed re-creates the moderators it finds missing (the airline one
    // was already restored by the run that refused the hotel).
    const repaired = await seedDemo(app, PASSWORD);
    expect(repaired.created).toContain('hotel moderator');
    expect(
      await count(User.name, { email: DEMO_ACCOUNTS.airlineModerator.email }),
    ).toBe(1);
  });
});
