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
    expect(first.created).toEqual(
      expect.arrayContaining(['airline', 'hotel', 'flights', 'rooms']),
    );
    expect(await count(Airline.name, { code: DEMO_AIRLINE.code })).toBe(1);
    expect(await count(Hotel.name, { name: DEMO_HOTEL.name })).toBe(1);
    expect(await count(Flight.name)).toBe(2);
    expect(await count(Room.name)).toBe(2);
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
      .find()
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
      .find()
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
    expect(await count(Airline.name)).toBe(1);
    expect(await count(Hotel.name)).toBe(1);
    expect(await count(Flight.name)).toBe(2);
    expect(await count(Room.name)).toBe(2);
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
  });
});
