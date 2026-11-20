import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Hotel, Review, RoomNight, RoomNightKind } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** HTL-02: the public hotel details page, with the rooms free for the requested dates. */
describe('Hotel details (e2e): HTL-02', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const r = (from: string, to: string) => ({ from, to });
  let hotelId: string;
  let mod: string;
  const roomIds: Record<string, string> = {};

  const get = (id: string, query: Record<string, string> = {}) =>
    http().get(`/api/hotels/${id}`).query(query);
  const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Details Hotel',
          address: '1 Nile street',
          cityId: 'cairo',
          amenities: ['WiFi', 'Pool'],
          starClass: 4,
        })
        .expect(201)
    ).body.id as string;
    mod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    await http()
      .put(`/api/hotels/${hotelId}/policies`)
      .set('x-dev-user', mod)
      .send({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
      })
      .expect(200);
    const room = async (number: string, priceMinor: number) => {
      const id = (
        await http()
          .post(`/api/hotels/${hotelId}/rooms`)
          .set('x-dev-user', mod)
          .send({
            number,
            type: 'Double',
            beds: 2,
            maxOccupancy: 2,
            priceMinor,
          })
          .expect(201)
      ).body.id as string;
      roomIds[number] = id;
      return id;
    };
    // A: Jan 1-20 and 20-31 touching; B: Jan 1-31 but night of the 11th booked; C: only until the 11th.
    for (const [number, price, ranges] of [
      [
        'A',
        12_000,
        [r('2027-01-01', '2027-01-20'), r('2027-01-20', '2027-02-01')],
      ],
      ['B', 10_000, [r('2027-01-01', '2027-02-01')]],
      ['C', 8_000, [r('2027-01-01', '2027-01-11')]],
    ] as const) {
      const id = await room(number, price);
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${id}/availability`)
        .set('x-dev-user', mod)
        .send({ ranges })
        .expect(201);
    }
    await room('D', 5_000); // no bookable dates at all
    await model<RoomNight>(RoomNight.name).create({
      roomId: new Types.ObjectId(roomIds.B),
      hotelId: new Types.ObjectId(hotelId),
      date: '2027-01-11',
      kind: RoomNightKind.BOOKED,
      reservationId: new Types.ObjectId(),
    });
    const reviews = model<Review>(Review.name);
    const review = (rating: number, text: string, isHidden = false) =>
      reviews.create({
        hotelId: new Types.ObjectId(hotelId),
        reservationId: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        rating,
        text,
        isHidden,
      });
    await review(5, 'Great view of the Nile');
    await review(4, 'Good breakfast');
    await review(1, 'Hidden by a moderator', true);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a guest sees the profile, policies, visible rating and reviews, and every active room', async () => {
    const res = await get(hotelId).expect(200);
    expect(res.body.hotel).toMatchObject({
      id: hotelId,
      name: 'Details Hotel',
      countryCode: 'EG',
      amenities: ['WiFi', 'Pool'],
      starClass: 4,
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
    });
    expect(res.body).toMatchObject({
      ratingAvg: 4.5,
      ratingCount: 2,
      stay: null,
    });
    expect(res.body.reviews.map((x: { text: string }) => x.text)).toEqual([
      'Good breakfast',
      'Great view of the Nile',
    ]);
    expect(res.body.rooms.map((x: { number: string }) => x.number)).toEqual([
      'D',
      'C',
      'B',
      'A',
    ]);
    expect(res.body.rooms[0]).toMatchObject({
      priceMinor: 5000,
      stayTotalMinor: null,
    });
  });

  it('with dates, lists only the rooms free every night, with the stay total', async () => {
    const res = await get(hotelId, {
      checkIn: '2027-01-09',
      checkOut: '2027-01-12',
    }).expect(200);
    expect(res.body.stay).toEqual({
      checkIn: '2027-01-09',
      checkOut: '2027-01-12',
      nights: 3,
    });
    // B has the 11th booked, C stops before the 11th, D has no dates: only A is free.
    expect(res.body.rooms).toEqual([
      expect.objectContaining({
        id: roomIds.A,
        number: 'A',
        priceMinor: 12000,
        stayTotalMinor: 36000,
      }),
    ]);
  });

  it('treats touching ranges as one span, and a stay ending on the edge as free', async () => {
    const across = await get(hotelId, {
      checkIn: '2027-01-18',
      checkOut: '2027-01-22',
    }).expect(200);
    expect(across.body.rooms.map((x: { number: string }) => x.number)).toEqual([
      'B',
      'A',
    ]);
    const edge = await get(hotelId, {
      checkIn: '2027-01-08',
      checkOut: '2027-01-11',
    }).expect(200);
    expect(edge.body.rooms.map((x: { number: string }) => x.number)).toEqual([
      'C',
      'B',
      'A',
    ]);
    expect(edge.body.rooms[0].stayTotalMinor).toBe(24000);
  });

  it('a deactivated room is never listed', async () => {
    const rooms = app.get<Model<{ isActive: boolean }>>(getModelToken('Room'));
    await rooms.updateOne({ _id: roomIds.A }, { isActive: false });
    const res = await get(hotelId).expect(200);
    expect(
      res.body.rooms.map((x: { number: string }) => x.number),
    ).not.toContain('A');
    await rooms.updateOne({ _id: roomIds.A }, { isActive: true });
  });

  it('rejects bad dates with field errors', async () => {
    const only = await get(hotelId, { checkIn: '2027-01-09' }).expect(400);
    expect(only.body.fieldErrors[0].field).toBe('checkOut');
    await get(hotelId, { checkOut: '2027-01-09' }).expect(400);
    await get(hotelId, {
      checkIn: '2027-02-30',
      checkOut: '2027-03-02',
    }).expect(400);
    await get(hotelId, {
      checkIn: '2027-01-09',
      checkOut: '2027-01-09',
    }).expect(400);
    await get(hotelId, {
      checkIn: '2027-01-01',
      checkOut: '2027-03-01',
    }).expect(400);
    const past = await get(hotelId, {
      checkIn: '2020-01-01',
      checkOut: '2020-01-03',
    }).expect(400);
    expect(past.body.fieldErrors[0].field).toBe('checkIn');
  });

  it('404 for an unknown or deactivated hotel, 400 for a malformed id', async () => {
    await get(new Types.ObjectId().toHexString()).expect(404);
    await get('not-an-id').expect(400);
    const hotels = model<Hotel>(Hotel.name);
    await hotels.updateOne({ _id: hotelId }, { isActive: false });
    await get(hotelId).expect(404);
    await hotels.updateOne({ _id: hotelId }, { isActive: true });
    await get(hotelId).expect(200);
  });

  /** HTL-15: the same hotel and rooms, through GET /api/hotels/:id/rooms/available. */
  describe('Available rooms (e2e): HTL-15', () => {
    const available = (id: string, query: Record<string, string | number>) =>
      http().get(`/api/hotels/${id}/rooms/available`).query(query);

    it('lists every room free for the stay, cheapest first, with type, beds, occupancy and totals', async () => {
      const res = await available(hotelId, {
        checkIn: '2027-01-08',
        checkOut: '2027-01-11',
      }).expect(200);
      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
      expect(res.body.items).toEqual([
        {
          id: roomIds.C,
          number: 'C',
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          priceMinor: 8000,
          stayTotalMinor: 24000,
        },
        expect.objectContaining({ id: roomIds.B, stayTotalMinor: 30000 }),
        expect.objectContaining({ id: roomIds.A, stayTotalMinor: 36000 }),
      ]);
    });

    it('leaves out booked nights, gaps in the bookable dates and rooms without dates', async () => {
      const res = await available(hotelId, {
        checkIn: '2027-01-09',
        checkOut: '2027-01-12',
      }).expect(200);
      expect(res.body.items.map((x: { number: string }) => x.number)).toEqual([
        'A',
      ]);
      const none = await available(hotelId, {
        checkIn: '2027-03-01',
        checkOut: '2027-03-02',
      }).expect(200);
      expect(none.body).toMatchObject({ items: [], total: 0 });
    });

    it('needs both dates and the HTL-02 date rules; 404 for an unknown hotel', async () => {
      const fields = async (query: Record<string, string | number>) => {
        const res = await available(hotelId, query).expect(400);
        return (res.body.fieldErrors as { field: string }[]).map(
          (f) => f.field,
        );
      };
      expect(await fields({ checkIn: '2027-01-08' })).toEqual(['checkOut']);
      expect(await fields({})).toEqual(
        expect.arrayContaining(['checkIn', 'checkOut']),
      );
      expect(
        await fields({ checkIn: '2020-01-01', checkOut: '2020-01-03' }),
      ).toEqual(['checkIn']);
      expect(
        await fields({ checkIn: '2027-01-08', checkOut: '2027-01-08' }),
      ).toEqual(['checkOut']);
      await available(new Types.ObjectId().toHexString(), {
        checkIn: '2027-01-08',
        checkOut: '2027-01-11',
      }).expect(404);
    });
  });
});
