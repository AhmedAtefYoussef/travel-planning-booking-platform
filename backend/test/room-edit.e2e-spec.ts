import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Hotel, Room, RoomNight, RoomNightKind } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** HTL-05: the hotel moderator edits a room and its availability; reserved dates stay bookable. */
describe('Room edit (e2e): HTL-05', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const moderatorOf = (hotelId: string) =>
    `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
  const r = (from: string, to: string) => ({ from, to });

  let hotelId: string;
  let freshRoom: () => Promise<string>;
  const mod = () => moderatorOf(hotelId);
  const nights = () => app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
  const rooms = () => app.get<Model<Room>>(getModelToken(Room.name));

  const edit = (rId: string, as: string | null, body: object) => {
    const req = http().patch(`/api/hotels/${hotelId}/rooms/${rId}`);
    if (as) req.set('x-dev-user', as);
    return req.send(body);
  };
  const replace = (rId: string, as: string | null, body: object) => {
    const req = http().patch(
      `/api/hotels/${hotelId}/rooms/${rId}/availability`,
    );
    if (as) req.set('x-dev-user', as);
    return req.send(body);
  };
  const night = (
    roomId: string,
    date: string,
    kind: RoomNightKind,
    expiresAt: Date | null = null,
  ) =>
    nights().create({
      roomId: new Types.ObjectId(roomId),
      hotelId: new Types.ObjectId(hotelId),
      date,
      kind,
      reservationId:
        kind === RoomNightKind.BLOCKED ? null : new Types.ObjectId(),
      expiresAt,
    });

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({ name: 'Edit Hotel', address: '1 Test street', cityId: 'cairo' })
        .expect(201)
    ).body.id as string;
    let n = 0;
    freshRoom = async () => {
      const id = (
        await http()
          .post(`/api/hotels/${hotelId}/rooms`)
          .set('x-dev-user', mod())
          .send({
            number: `E${++n}`,
            type: 'Double',
            beds: 2,
            maxOccupancy: 2,
            priceMinor: 10_000,
          })
          .expect(201)
      ).body.id as string;
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${id}/availability`)
        .set('x-dev-user', mod())
        .send({ ranges: [r('2027-01-01', '2027-02-01')] })
        .expect(201);
      return id;
    };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PATCH /api/hotels/:id/rooms/:roomId', () => {
    it('edits beds, occupancy and price, keeping everything else', async () => {
      const id = await freshRoom();
      const res = await edit(id, mod(), {
        beds: 3,
        maxOccupancy: 4,
        priceMinor: 12_500,
      }).expect(200);
      expect(res.body).toMatchObject({
        id,
        number: 'E1',
        type: 'Double',
        beds: 3,
        maxOccupancy: 4,
        priceMinor: 12_500,
        availability: [r('2027-01-01', '2027-02-01')],
      });
      const one = await edit(id, mod(), { priceMinor: 9_000 }).expect(200);
      expect(one.body).toMatchObject({ beds: 3, priceMinor: 9_000 });
    });

    it('a new price leaves booked nights untouched (reservations keep their price)', async () => {
      const id = await freshRoom();
      await night(id, '2027-01-10', RoomNightKind.BOOKED);
      await edit(id, mod(), { priceMinor: 20_000 }).expect(200);
      const stored = await nights().find({ roomId: id }).lean();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        date: '2027-01-10',
        kind: RoomNightKind.BOOKED,
      });
    });

    it('rejects an empty body, null, invalid values and other fields with 400', async () => {
      const id = await freshRoom();
      await edit(id, mod(), {}).expect(400);
      await edit(id, mod(), { beds: null }).expect(400);
      await edit(id, mod(), { priceMinor: 0 }).expect(400);
      await edit(id, mod(), { maxOccupancy: 1e20 }).expect(400);
      await edit(id, mod(), { number: 'X9' }).expect(400);
      await edit(id, mod(), { isActive: false }).expect(400);
      expect(await rooms().findById(id).lean()).toMatchObject({
        beds: 2,
        priceMinor: 10_000,
        isActive: true,
      });
    });

    it('is for the hotel moderator only, and 404 for an unknown room', async () => {
      const id = await freshRoom();
      await edit(id, null, { beds: 3 }).expect(401);
      await edit(id, 'ADMIN', { beds: 3 }).expect(403);
      await edit(id, moderatorOf(new Types.ObjectId().toHexString()), {
        beds: 3,
      }).expect(403);
      await edit(new Types.ObjectId().toHexString(), mod(), { beds: 3 }).expect(
        404,
      );
    });
  });

  describe('PATCH /api/hotels/:id/rooms/:roomId/availability', () => {
    it('replaces all ranges, sorted; an empty list removes every range', async () => {
      const id = await freshRoom();
      const res = await replace(id, mod(), {
        ranges: [r('2027-03-01', '2027-03-10'), r('2027-01-05', '2027-01-15')],
      }).expect(200);
      expect(res.body.availability).toEqual([
        r('2027-01-05', '2027-01-15'),
        r('2027-03-01', '2027-03-10'),
      ]);
      const cleared = await replace(id, mod(), { ranges: [] }).expect(200);
      expect(cleared.body.availability).toEqual([]);
    });

    it('may shrink ranges around booked nights as long as they stay bookable', async () => {
      const id = await freshRoom();
      await night(id, '2027-01-10', RoomNightKind.BOOKED);
      await night(id, '2027-01-11', RoomNightKind.BOOKED);
      const res = await replace(id, mod(), {
        ranges: [r('2027-01-10', '2027-01-12')],
      }).expect(200);
      expect(res.body.availability).toEqual([r('2027-01-10', '2027-01-12')]);
    });

    it('refuses to remove a booked night or an unexpired hold (409) and changes nothing', async () => {
      const id = await freshRoom();
      await night(id, '2027-01-10', RoomNightKind.BOOKED);
      await night(
        id,
        '2027-01-20',
        RoomNightKind.HELD,
        new Date(Date.now() + 10 * 60_000),
      );
      const res = await replace(id, mod(), {
        ranges: [r('2027-01-15', '2027-01-18')],
      }).expect(409);
      expect(res.body.message).toContain('2027-01-10');
      expect(res.body.message).toContain('2027-01-20');
      const cleared = await replace(id, mod(), { ranges: [] }).expect(409);
      expect(cleared.body.code).toBe('CONFLICT');
      expect((await rooms().findById(id).lean())?.availability).toEqual([
        r('2027-01-01', '2027-02-01'),
      ]);
    });

    it('does not protect expired holds, owner blocks or nights in the past', async () => {
      const id = await freshRoom();
      await night(
        id,
        '2027-01-10',
        RoomNightKind.HELD,
        new Date(Date.now() - 60_000),
      );
      await night(id, '2027-01-12', RoomNightKind.BLOCKED);
      await night(id, '2020-06-01', RoomNightKind.BOOKED);
      await replace(id, mod(), { ranges: [] }).expect(200);
    });

    it('applies the HTL-04 range rules with 400', async () => {
      const id = await freshRoom();
      await replace(id, mod(), {
        ranges: [r('2027-01-01', '2027-01-10'), r('2027-01-05', '2027-01-15')],
      }).expect(400);
      const res = await replace(id, mod(), {
        ranges: [r('2000-01-01', '2000-01-05'), r('2027-02-30', '2027-03-05')],
      }).expect(400);
      expect(
        res.body.fieldErrors.map((f: { field: string }) => f.field),
      ).toEqual(expect.arrayContaining(['ranges[0].to', 'ranges[1].from']));
      await replace(id, mod(), {}).expect(400);
    });

    it('names an overlapping range in fieldErrors, like HTL-04 (GEN-02)', async () => {
      const id = await freshRoom();
      const res = await replace(id, mod(), {
        ranges: [r('2027-01-01', '2027-01-10'), r('2027-01-05', '2027-01-15')],
      }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(
        res.body.fieldErrors.map((f: { field: string }) => f.field),
      ).toEqual(['ranges[1].from']);
    });

    it('is for the hotel moderator only; 404 for an unknown room; deactivated hotel is 403', async () => {
      const id = await freshRoom();
      await replace(id, null, { ranges: [] }).expect(401);
      await replace(id, moderatorOf(new Types.ObjectId().toHexString()), {
        ranges: [],
      }).expect(403);
      await replace(new Types.ObjectId().toHexString(), mod(), {
        ranges: [],
      }).expect(404);
      const hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
      await hotels.updateOne({ _id: hotelId }, { isActive: false });
      await replace(id, mod(), { ranges: [] }).expect(403);
      await edit(id, mod(), { beds: 3 }).expect(403);
      await hotels.updateOne({ _id: hotelId }, { isActive: true });
    });
  });
});
