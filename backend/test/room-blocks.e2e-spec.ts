import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { HOTEL_INVENTORY } from '../src/common/contracts';
import type { HotelInventory } from '../src/common/contracts/services.contract';
import { eachNight } from '../src/common/utils/dates';
import { Room, RoomNight, RoomNightKind } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** HTL-06: block dates, deactivate or delete a room, never over a Confirmed or Pending Payment stay. */
describe('Room blocks, deactivation and deletion (e2e): HTL-06', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const r = (from: string, to: string) => ({ from, to });
  let hotelId: string;
  let mod: string;
  let n = 0;
  const nights = () => app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
  const rooms = () => app.get<Model<Room>>(getModelToken(Room.name));

  const freshRoom = async () => {
    const id = (
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('x-dev-user', mod)
        .send({
          number: `K${++n}`,
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          priceMinor: 10_000,
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${id}/availability`)
      .set('x-dev-user', mod)
      .send({ ranges: [r('2027-01-01', '2027-02-01')] })
      .expect(201);
    return id;
  };
  const reserve = (
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
      reservationId: new Types.ObjectId(),
      expiresAt,
    });
  const block = (roomId: string, ranges: object[], as = mod) =>
    http()
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/blocks`)
      .set('x-dev-user', as)
      .send({ ranges });
  const unblock = (roomId: string, ranges: object[]) =>
    http()
      .delete(`/api/hotels/${hotelId}/rooms/${roomId}/blocks`)
      .set('x-dev-user', mod)
      .send({ ranges });
  const edit = (roomId: string, body: object) =>
    http()
      .patch(`/api/hotels/${hotelId}/rooms/${roomId}`)
      .set('x-dev-user', mod)
      .send(body);
  const remove = (roomId: string, as = mod) =>
    http()
      .delete(`/api/hotels/${hotelId}/rooms/${roomId}`)
      .set('x-dev-user', as);
  /**
   * Whether a booking (HTL-18) could hold the room for these nights: the inventory says the room is
   * active and bookable on every night, and no room_nights document (booked, held, blocked) takes one.
   */
  const free = async (roomId: string, checkIn: string, checkOut: string) => {
    const dates = eachNight(checkIn, checkOut);
    const stay = await app
      .get<HotelInventory>(HOTEL_INVENTORY)
      .getBookableStay(hotelId, [roomId], dates);
    const taken = await nights().exists({ roomId, date: { $in: dates } });
    return stay?.rooms[0]?.unavailableReason === null && !taken;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Blocks Hotel',
          address: '1 Block street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
    mod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('blocks', () => {
    it('blocks nights so the room is no longer offered, and unblocks them', async () => {
      const id = await freshRoom();
      const res = await block(id, [
        r('2027-01-10', '2027-01-12'),
        r('2027-01-12', '2027-01-13'),
      ]).expect(201);
      expect(res.body).toEqual({
        roomId: id,
        blocked: [r('2027-01-10', '2027-01-13')],
      });
      expect(await free(id, '2027-01-11', '2027-01-12')).toBe(false);
      expect(await free(id, '2027-01-13', '2027-01-15')).toBe(true);
      const left = await unblock(id, [r('2027-01-11', '2027-01-12')]).expect(
        200,
      );
      expect(left.body.blocked).toEqual([
        r('2027-01-10', '2027-01-11'),
        r('2027-01-12', '2027-01-13'),
      ]);
      expect(await free(id, '2027-01-11', '2027-01-12')).toBe(true);
    });

    it('refuses to block over a confirmed or pending-payment stay, blocking nothing', async () => {
      const id = await freshRoom();
      await reserve(id, '2027-01-15', RoomNightKind.BOOKED);
      await reserve(
        id,
        '2027-01-20',
        RoomNightKind.HELD,
        new Date(Date.now() + 10 * 60_000),
      );
      const booked = await block(id, [r('2027-01-14', '2027-01-17')]).expect(
        409,
      );
      expect(booked.body.message).toContain('2027-01-15');
      const held = await block(id, [r('2027-01-20', '2027-01-21')]).expect(409);
      expect(held.body.message).toContain('2027-01-20');
      expect(
        await nights().countDocuments({
          roomId: id,
          kind: RoomNightKind.BLOCKED,
        }),
      ).toBe(0);
    });

    it('an already blocked night, or an expired hold not yet released, is a clear 409', async () => {
      const id = await freshRoom();
      await block(id, [r('2027-01-05', '2027-01-06')]).expect(201);
      const again = await block(id, [r('2027-01-05', '2027-01-07')]).expect(
        409,
      );
      expect(again.body.message).toContain('Already blocked');
      await reserve(
        id,
        '2027-01-25',
        RoomNightKind.HELD,
        new Date(Date.now() - 60_000),
      );
      const releasing = await block(id, [r('2027-01-25', '2027-01-26')]).expect(
        409,
      );
      expect(releasing.body.message).toContain('being released');
    });

    it('unblocking never removes a booked night', async () => {
      const id = await freshRoom();
      await reserve(id, '2027-01-08', RoomNightKind.BOOKED);
      await unblock(id, [r('2027-01-08', '2027-01-09')]).expect(200);
      expect(
        await nights().countDocuments({
          roomId: id,
          kind: RoomNightKind.BOOKED,
        }),
      ).toBe(1);
    });

    it('applies the range rules and the moderator scope', async () => {
      const id = await freshRoom();
      const bad = await block(id, [r('2027-01-12', '2027-01-10')]).expect(400);
      expect(bad.body.fieldErrors[0].field).toBe('ranges[0].to');
      await block(id, [r('2000-01-01', '2000-01-03')]).expect(400);
      await block(id, []).expect(400);
      await block(id, [
        r('2027-01-01', '2027-12-31'),
        r('2028-01-01', '2028-01-05'),
      ]).expect(400);
      await block(
        id,
        [r('2027-01-10', '2027-01-11')],
        `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`,
      ).expect(403);
      await block(new Types.ObjectId().toHexString(), [
        r('2027-01-10', '2027-01-11'),
      ]).expect(404);
    });
  });

  describe('deactivation', () => {
    it('deactivates a room without reservations; it leaves search; reactivating brings it back', async () => {
      const id = await freshRoom();
      const off = await edit(id, { isActive: false }).expect(200);
      expect(off.body.isActive).toBe(false);
      expect(await free(id, '2027-01-10', '2027-01-11')).toBe(false);
      await edit(id, { isActive: true }).expect(200);
      expect(await free(id, '2027-01-10', '2027-01-11')).toBe(true);
    });

    it('refuses to deactivate over a confirmed or pending-payment stay from today on', async () => {
      const booked = await freshRoom();
      await reserve(booked, '2027-01-15', RoomNightKind.BOOKED);
      const res = await edit(booked, {
        isActive: false,
        priceMinor: 9000,
      }).expect(409);
      expect(res.body.message).toContain('2027-01-15');
      expect(await rooms().findById(booked).lean()).toMatchObject({
        isActive: true,
        priceMinor: 10000,
      });
      const held = await freshRoom();
      await reserve(
        held,
        '2027-01-16',
        RoomNightKind.HELD,
        new Date(Date.now() + 10 * 60_000),
      );
      await edit(held, { isActive: false }).expect(409);
    });

    it('past stays, expired holds and blocks do not stop deactivation', async () => {
      const id = await freshRoom();
      await reserve(id, '2020-06-01', RoomNightKind.BOOKED);
      await reserve(
        id,
        '2027-01-18',
        RoomNightKind.HELD,
        new Date(Date.now() - 60_000),
      );
      await block(id, [r('2027-01-05', '2027-01-06')]).expect(201);
      await edit(id, { isActive: false }).expect(200);
    });

    it('isActive must be a boolean', async () => {
      const id = await freshRoom();
      await edit(id, { isActive: 'no' }).expect(400);
      await edit(id, { isActive: null }).expect(400);
    });
  });

  describe('deletion', () => {
    it('deletes a room that was never reserved, with its blocks', async () => {
      const id = await freshRoom();
      await block(id, [r('2027-01-10', '2027-01-12')]).expect(201);
      await remove(id).expect(204);
      expect(await rooms().findById(id)).toBeNull();
      expect(await nights().countDocuments({ roomId: id })).toBe(0);
      await remove(id).expect(404);
    });

    it('refuses to delete a room that has ever been reserved, even after the stay', async () => {
      const id = await freshRoom();
      await rooms().updateOne({ _id: id }, { everReserved: true });
      const res = await remove(id).expect(409);
      expect(res.body.message).toContain('Deactivate it instead');
      const booked = await freshRoom();
      await reserve(booked, '2020-06-01', RoomNightKind.BOOKED);
      await remove(booked).expect(409);
      expect(await rooms().findById(booked)).not.toBeNull();
    });

    it("refuses another hotel's moderator with 403", async () => {
      const id = await freshRoom();
      await remove(
        id,
        `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`,
      ).expect(403);
      expect(await rooms().findById(id)).not.toBeNull();
    });
  });
});
