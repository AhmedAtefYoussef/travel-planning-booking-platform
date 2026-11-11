import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { App } from 'supertest/types';
import {
  Hotel,
  Review,
  Room,
  RoomNight,
  RoomNightState,
} from '../src/modules/hotels';
import { createTestApp } from './support/create-test-app';

/** TRVL-140: the indexes that enforce the hotel rules exist in MongoDB, not just in the schema. */
describe('Hotel schemas (e2e): TRVL-140', () => {
  let app: INestApplication<App>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let nights: Model<RoomNight>;
  let reviews: Model<Review>;

  beforeAll(async () => {
    app = await createTestApp();
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    rooms = app.get<Model<Room>>(getModelToken(Room.name));
    nights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    reviews = app.get<Model<Review>>(getModelToken(Review.name));
    // Index builds run in the background at startup; wait so the unique rules are in force.
    await Promise.all(
      [hotels, rooms, nights, reviews].map((m) =>
        (m as Model<unknown>).syncIndexes(),
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const indexNames = async (model: Model<unknown>) =>
    (await model.collection.indexes()).map((i) => ({
      key: i.key,
      unique: i.unique ?? false,
    }));

  it('builds every hotel index at startup', async () => {
    expect(await indexNames(hotels as Model<unknown>)).toEqual(
      expect.arrayContaining([
        { key: { cityId: 1, isActive: 1 }, unique: false },
        { key: { countryCode: 1, isActive: 1 }, unique: false },
      ]),
    );
    expect(await indexNames(rooms as Model<unknown>)).toEqual(
      expect.arrayContaining([
        { key: { hotelId: 1, number: 1 }, unique: true },
      ]),
    );
    expect(await indexNames(nights as Model<unknown>)).toEqual(
      expect.arrayContaining([
        { key: { roomId: 1, date: 1 }, unique: true },
        { key: { reservationId: 1 }, unique: false },
        { key: { hotelId: 1, date: 1 }, unique: false },
      ]),
    );
    expect(await indexNames(reviews as Model<unknown>)).toEqual(
      expect.arrayContaining([{ key: { reservationId: 1 }, unique: true }]),
    );
  });

  it('a room number is unique within its hotel, not across hotels (HTL-03)', async () => {
    const [a, b] = await hotels.create([
      {
        name: 'Index Hotel A',
        address: '1 Test St',
        cityId: '1818',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        name: 'Index Hotel B',
        address: '2 Test St',
        cityId: '1818',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
    ]);
    const roomOf = (hotelId: Types.ObjectId) => ({
      hotelId,
      number: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 2,
      priceMinor: 10_000,
    });
    await rooms.create(roomOf(a._id));
    await rooms.create(roomOf(b._id));
    await expect(
      rooms.create({ ...roomOf(a._id), number: '101' }),
    ).rejects.toMatchObject({ code: 11000 });
    await rooms.create({ ...roomOf(a._id), number: 'a1' });
    // Case does not make a different room.
    await expect(
      rooms.create({ ...roomOf(a._id), number: 'A1' }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(rooms.create(roomOf(a._id))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('a room night can be taken once: a second hold, booking or block of it is refused (ADR-0002)', async () => {
    const roomId = new Types.ObjectId();
    const hotelId = new Types.ObjectId();
    await nights.create({
      roomId,
      hotelId,
      date: '2027-03-01',
      state: RoomNightState.Held,
      reservationId: new Types.ObjectId(),
    });
    await expect(
      nights.create({
        roomId,
        hotelId,
        date: '2027-03-01',
        state: RoomNightState.Blocked,
        reservationId: null,
      }),
    ).rejects.toMatchObject({ code: 11000 });
    // The next night and the same night of another room are free.
    await nights.create({
      roomId,
      hotelId,
      date: '2027-03-02',
      state: RoomNightState.Blocked,
      reservationId: null,
    });
    await nights.create({
      roomId: new Types.ObjectId(),
      hotelId,
      date: '2027-03-01',
      state: RoomNightState.Held,
      reservationId: new Types.ObjectId(),
    });
  });

  it('two parallel holds of the same night: exactly one wins', async () => {
    const roomId = new Types.ObjectId();
    const hotelId = new Types.ObjectId();
    const attempt = () =>
      nights.create({
        roomId,
        hotelId,
        date: '2027-04-10',
        state: RoomNightState.Held,
        reservationId: new Types.ObjectId(),
      });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, attempt),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await nights.countDocuments({ roomId })).toBe(1);
  });

  const heldNights = (
    roomIds: Types.ObjectId[],
    dates: string[],
    hotelId = new Types.ObjectId(),
  ) => {
    const reservationId = new Types.ObjectId();
    return roomIds.flatMap((roomId) =>
      dates.map((date) => ({
        roomId,
        hotelId,
        date,
        state: RoomNightState.Held,
        reservationId,
      })),
    );
  };

  it('a hold transaction with one taken night stores none of its nights (HTL-18: all or nothing)', async () => {
    const [r1, r2] = [new Types.ObjectId(), new Types.ObjectId()];
    await nights.create({
      roomId: r2,
      hotelId: new Types.ObjectId(),
      date: '2027-05-02',
      state: RoomNightState.Blocked,
      reservationId: null,
    });
    const hold = heldNights([r1, r2], ['2027-05-01', '2027-05-02']);
    await expect(
      nights.db.transaction((session) => nights.insertMany(hold, { session })),
    ).rejects.toMatchObject({ code: 11000 });
    expect(await nights.countDocuments({ roomId: r1 })).toBe(0);
    expect(await nights.countDocuments({ roomId: r2 })).toBe(1);
  });

  it('two concurrent hold transactions on overlapping nights: exactly one commits, the other leaves nothing', async () => {
    const room = new Types.ObjectId();
    const other = new Types.ObjectId();
    const a = heldNights([room, other], ['2027-06-01', '2027-06-02']);
    const b = heldNights([room], ['2027-06-02', '2027-06-03']);
    const results = await Promise.allSettled(
      [a, b].map((docs) =>
        nights.db.transaction((session) =>
          nights.insertMany(docs, { session }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const stored = await nights.find({ roomId: { $in: [room, other] } }).lean();
    const winner = results[0].status === 'fulfilled' ? a : b;
    expect(stored).toHaveLength(winner.length);
    expect(new Set(stored.map((n) => String(n.reservationId)))).toEqual(
      new Set([String(winner[0].reservationId)]),
    );
  });

  it('a reservation can be reviewed once (HTL-22)', async () => {
    const review = {
      hotelId: new Types.ObjectId(),
      reservationId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      rating: 4,
    };
    await reviews.create(review);
    await expect(
      reviews.create({ ...review, rating: 1 }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
