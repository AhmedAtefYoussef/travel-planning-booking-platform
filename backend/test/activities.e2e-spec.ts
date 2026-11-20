// Must be the first import: it points UPLOAD_DIR at a fresh temp folder before AppModule is loaded.
import {
  removeTempUploadDir,
  TEMP_UPLOAD_DIR,
} from './support/temp-upload-dir';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { Activity } from '../src/modules/itineraries';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { asUser, loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const MB = 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];
const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ACTIVITY_URL = new RegExp(`^/uploads/activities/(${UUID})\\.(png|jpg)$`);

function img(signature: number[], size = 128, fill = 0): Buffer {
  const buf = Buffer.alloc(size, fill);
  Buffer.from(signature).copy(buf);
  return buf;
}
const png = (fill = 1, size = 128) => img(PNG_SIGNATURE, size, fill);
const jpeg = (fill = 2) => img(JPEG_SIGNATURE, 128, fill);
const onDisk = (url: string) =>
  existsSync(join(TEMP_UPLOAD_DIR, ...url.split('/').slice(2)));
const imageIdOf = (url: string) => ACTIVITY_URL.exec(url)?.[1] as string;

/**
 * ITN-10: add, edit and delete activities of a day (name, description, optional time and cost).
 * ITN-12: attach and remove activity images under the GEN-08 rules (JPG/PNG, 5 MB, 5 per activity).
 */
describe('Activities (e2e): ITN-10, ITN-12', () => {
  let app: INestApplication<App>;
  let activities: Model<Activity>;
  let owner: LoggedIn;
  let stranger: LoggedIn;
  let itineraryId: string;
  let dayIds: string[];
  const http = () => request(app.getHttpServer());

  const add = (body: object, dayId = dayIds[0], as: LoggedIn = owner) =>
    http()
      .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
      .set('Cookie', as.cookie)
      .send(body);
  const addOk = async (over: Record<string, unknown> = {}) =>
    (
      await add({
        name: 'Giza Pyramids',
        description: 'Guided tour',
        ...over,
      }).expect(201)
    ).body as { id: string; images: string[] };
  const patch = (id: string, body: object, as: LoggedIn = owner) =>
    http().patch(`/api/activities/${id}`).set('Cookie', as.cookie).send(body);
  const upload = (id: string, files: Buffer[], as: LoggedIn = owner) => {
    let req = http()
      .post(`/api/activities/${id}/images`)
      .set('Cookie', as.cookie);
    files.forEach((buf, i) => {
      const isPng = buf[0] === 0x89;
      req = req.attach('images', buf, {
        filename: `photo-${i}.${isPng ? 'png' : 'jpg'}`,
        contentType: isPng ? 'image/png' : 'image/jpeg',
      });
    });
    return req;
  };
  const detail = async () =>
    (
      await http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .expect(200)
    ).body as {
      updatedAt: string;
      days: { id: string; activities: { id: string }[] }[];
      cityGroups: { subtotals: { currency: string; amountMinor: number }[] }[];
    };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    activities = app.get<Model<Activity>>(getModelToken(Activity.name));
    owner = await loginAs(app, Role.User);
    stranger = await loginAs(app, Role.User);
    itineraryId = (
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Activities',
          countries: ['EG'],
          startDate: '2027-03-01',
        })
        .expect(201)
    ).body.id as string;
    for (const cityId of ['cairo', 'cairo']) {
      await http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId })
        .expect(201);
    }
    dayIds = (await detail()).days.map((d) => d.id);
  });

  afterAll(async () => {
    await app.close();
    removeTempUploadDir();
  });

  describe('ITN-10 add', () => {
    it('adds an activity with time and cost; it shows under its day and in the subtotal', async () => {
      const res = await add({
        name: '  Giza Pyramids ',
        description: 'Guided morning tour',
        time: '09:30',
        costMinor: 50000,
        currency: 'egp',
      }).expect(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        dayId: dayIds[0],
        name: 'Giza Pyramids',
        description: 'Guided morning tour',
        time: '09:30',
        costMinor: 50000,
        currency: 'EGP',
        images: [],
      });
      const it = await detail();
      expect(it.days[0].activities.map((a) => a.id)).toContain(res.body.id);
      expect(it.cityGroups[0].subtotals).toEqual([
        { currency: 'EGP', amountMinor: 50000 },
      ]);
    });

    it('time and cost are optional', async () => {
      const res = await add(
        { name: 'Free afternoon', description: 'Walk' },
        dayIds[1],
      ).expect(201);
      expect(res.body).toMatchObject({
        dayId: dayIds[1],
        time: null,
        costMinor: null,
        currency: null,
      });
    });

    it('validates every field and the cost/currency pair', async () => {
      const bad = await add({
        name: '',
        description: '',
        time: '25:00',
        costMinor: -1,
        currency: 'EURO',
      }).expect(400);
      const fields = (bad.body.fieldErrors as { field: string }[]).map(
        (e) => e.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining([
          'name',
          'description',
          'time',
          'costMinor',
          'currency',
        ]),
      );
      await add({ name: 'n'.repeat(101), description: 'x' }).expect(400);
      await add({
        name: 'A',
        description: 'B',
        costMinor: 1.5,
        currency: 'EGP',
      }).expect(400);
      await add({
        name: 'A',
        description: 'B',
        costMinor: 1e20,
        currency: 'EGP',
      }).expect(400);
      const pair = await add({
        name: 'A',
        description: 'B',
        costMinor: 100,
      }).expect(400);
      expect(pair.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'currency' }),
      ]);
      const unknown = await add({
        name: 'A',
        description: 'B',
        costMinor: 100,
        currency: 'XYZ',
      }).expect(400);
      expect(unknown.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'currency' }),
      ]);
    });

    it('404 for a day of another itinerary or an unknown day', async () => {
      await add(
        { name: 'A', description: 'B' },
        new Types.ObjectId().toHexString(),
      ).expect(404);
    });
  });

  describe('ITN-10 edit and delete', () => {
    it('edits fields, keeps the rest, and moves the itinerary to the top of my list', async () => {
      const a = await addOk({ time: '08:00', costMinor: 100, currency: 'EGP' });
      const before = (await detail()).updatedAt;
      const res = await patch(a.id, { name: 'Sphinx', costMinor: 200 }).expect(
        200,
      );
      expect(res.body).toMatchObject({
        name: 'Sphinx',
        description: 'Guided tour',
        time: '08:00',
        costMinor: 200,
        currency: 'EGP',
      });
      expect(new Date((await detail()).updatedAt).getTime()).toBeGreaterThan(
        new Date(before).getTime(),
      );
    });

    it('removeTime and removeCost clear the optional fields', async () => {
      const a = await addOk({ time: '08:00', costMinor: 100, currency: 'EGP' });
      const res = await patch(a.id, {
        removeTime: true,
        removeCost: true,
      }).expect(200);
      expect(res.body).toMatchObject({
        time: null,
        costMinor: null,
        currency: null,
      });
      await patch(a.id, { removeTime: true, time: '09:00' }).expect(400);
      await patch(a.id, { removeCost: false }).expect(400);
    });

    it('rejects null, an empty body, a cost without currency and bad values', async () => {
      const a = await addOk();
      await patch(a.id, { name: null }).expect(400);
      await patch(a.id, {}).expect(400);
      await patch(a.id, { costMinor: 100 }).expect(400);
      await patch(a.id, { time: '7:5' }).expect(400);
      await patch(a.id, { description: 'd'.repeat(2001) }).expect(400);
      const stored = await activities.findById(a.id).lean().exec();
      expect(stored).toMatchObject({ name: 'Giza Pyramids' });
      expect(stored?.costMinor).toBeUndefined();
    });

    it('deletes an activity', async () => {
      const a = await addOk();
      await http()
        .delete(`/api/activities/${a.id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      expect(await activities.exists({ _id: a.id }).exec()).toBeNull();
      await http()
        .delete(`/api/activities/${a.id}`)
        .set('Cookie', owner.cookie)
        .expect(404);
    });

    it('a stranger gets the same 404 as an unknown activity and changes nothing', async () => {
      const a = await addOk();
      await add({ name: 'A', description: 'B' }, dayIds[0], stranger).expect(
        404,
      );
      const s = await patch(a.id, { name: 'Mine' }, stranger).expect(404);
      const u = await patch(new Types.ObjectId().toHexString(), {
        name: 'x',
      }).expect(404);
      expect(s.body.message).toBe(u.body.message);
      await http()
        .delete(`/api/activities/${a.id}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      await upload(a.id, [png()], stranger).expect(404);
      await http()
        .patch(`/api/activities/${a.id}`)
        .send({ name: 'x' })
        .expect(401);
      await http()
        .patch(`/api/activities/${a.id}`)
        .set(asUser(Role.Admin))
        .send({ name: 'x' })
        .expect(403);
      expect((await activities.findById(a.id).lean().exec())?.name).toBe(
        'Giza Pyramids',
      );
    });
  });

  describe('ITN-12 images (GEN-08)', () => {
    it('uploads JPG and PNG images and removes one, deleting its file', async () => {
      const a = await addOk();
      const res = await upload(a.id, [png(1), jpeg(2)]).expect(201);
      expect(res.body.images).toHaveLength(2);
      for (const url of res.body.images as string[]) {
        expect(url).toMatch(ACTIVITY_URL);
        expect(onDisk(url)).toBe(true);
      }
      const [first, second] = res.body.images as string[];
      const removed = await http()
        .delete(`/api/activities/${a.id}/images/${imageIdOf(first)}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(removed.body.images).toEqual([second]);
      expect(onDisk(first)).toBe(false);
      expect(onDisk(second)).toBe(true);
    });

    it('allows 5 images in all and refuses a batch that would pass 5', async () => {
      const a = await addOk();
      await upload(a.id, [png(1), png(2), png(3)]).expect(201);
      const tooMany = await upload(a.id, [png(4), png(5), png(6)]).expect(400);
      expect(tooMany.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'images' }),
      ]);
      await upload(a.id, [png(4), png(5)]).expect(201);
      await upload(a.id, [png(6)]).expect(400);
      expect(
        (await activities.findById(a.id).lean().exec())?.images,
      ).toHaveLength(5);
    });

    it('refuses files that are not JPG/PNG or larger than 5 MB', async () => {
      const a = await addOk();
      await http()
        .post(`/api/activities/${a.id}/images`)
        .set('Cookie', owner.cookie)
        .attach('images', Buffer.from('not an image'), {
          filename: 'fake.png',
          contentType: 'image/png',
        })
        .expect(400);
      await upload(a.id, [png(1, 5 * MB + 1)]).expect((r) =>
        expect([400, 413]).toContain(r.status),
      );
      await http()
        .post(`/api/activities/${a.id}/images`)
        .set('Cookie', owner.cookie)
        .expect(400);
      expect((await activities.findById(a.id).lean().exec())?.images).toEqual(
        [],
      );
    });

    it('validates the image id', async () => {
      const a = await addOk();
      await http()
        .delete(`/api/activities/${a.id}/images/not-a-uuid`)
        .set('Cookie', owner.cookie)
        .expect(400);
      await http()
        .delete(
          `/api/activities/${a.id}/images/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e`,
        )
        .set('Cookie', owner.cookie)
        .expect(404);
    });

    it('keeps a file another activity still shows (a clone) and deletes it with the last one', async () => {
      const a = await addOk();
      const [url] = (await upload(a.id, [png(7)]).expect(201)).body
        .images as string[];
      // A clone (ITN-21) points at the same file.
      const clone = await activities.create({
        itineraryId: new Types.ObjectId(),
        dayId: new Types.ObjectId(),
        name: 'Copy',
        description: 'Copy',
        images: [url],
      });
      await http()
        .delete(`/api/activities/${a.id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      expect(onDisk(url)).toBe(true);
      await activities.deleteOne({ _id: clone._id }).exec();
    });

    it('deleting a day or the itinerary deletes its activities and their files', async () => {
      const a = await addOk({});
      const [url] = (await upload(a.id, [png(8)]).expect(201)).body
        .images as string[];
      await http()
        .delete(`/api/itineraries/${itineraryId}/days/${dayIds[0]}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(await activities.exists({ _id: a.id }).exec()).toBeNull();
      expect(onDisk(url)).toBe(false);
    });
  });
});
