import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { App } from 'supertest/types';
import {
  Hotel,
  Review,
  Room,
  RoomNight,
  RoomNightKind,
} from '../src/modules/hotels';
import { createTestApp } from './support/create-test-app';

type IndexInfo = { key: Record<string, number>; unique?: boolean };

/** TRVL-140: the indexes that enforce the hotel rules exist in MongoDB, not just in the schemas. */
describe('Hotels schemas (e2e): TRVL-140', () => {
  let app: INestApplication<App>;
  const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
  const indexes = async (name: string) =>
    (await model(name).collection.indexes()) as IndexInfo[];
  const uniqueOn = (list: IndexInfo[], key: Record<string, number>) =>
    list.some(
      (i) => i.unique === true && JSON.stringify(i.key) === JSON.stringify(key),
    );

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('builds the unique {roomId, date} index on room_nights (ADR-0002)', async () => {
    expect(
      uniqueOn(await indexes(RoomNight.name), { roomId: 1, date: 1 }),
    ).toBe(true);
  });

  it('builds the unique reservationId index on reviews', async () => {
    expect(uniqueOn(await indexes(Review.name), { reservationId: 1 })).toBe(
      true,
    );
  });

  it('builds the unique room number per hotel and the hotel search indexes', async () => {
    expect(uniqueOn(await indexes(Room.name), { hotelId: 1, number: 1 })).toBe(
      true,
    );
    const hotelKeys = (await indexes(Hotel.name)).map((i) => i.key);
    expect(hotelKeys).toEqual(
      expect.arrayContaining([
        { cityId: 1, isActive: 1 },
        { countryCode: 1, isActive: 1 },
      ]),
    );
  });

  it('treats room numbers that differ only in case as the same room (HTL-03)', async () => {
    const rooms = model<Room>(Room.name);
    const room = {
      hotelId: new Types.ObjectId(),
      type: 'Double',
      beds: 2,
      maxOccupancy: 2,
      priceMinor: 10_000,
    };
    await rooms.create({ ...room, number: 'A101' });
    await expect(
      rooms.create({ ...room, number: 'a101' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects a second booking of the same room on the same night', async () => {
    const nights = model<RoomNight>(RoomNight.name);
    const night = {
      roomId: new Types.ObjectId(),
      hotelId: new Types.ObjectId(),
      date: '2027-01-10',
      kind: RoomNightKind.BOOKED,
    };
    await nights.create(night);
    await expect(
      nights.create({ ...night, kind: RoomNightKind.HELD }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
