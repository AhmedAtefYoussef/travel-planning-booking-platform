import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Hotel } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** HTL-01: admins create hotel profiles; only the assigned hotel moderator edits one. */
describe('Hotels (e2e): HTL-01', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const admin = 'ADMIN';
  const moderatorOf = (hotelId: string) =>
    `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;

  let hotelId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/hotels', () => {
    it('an admin creates a hotel: text trimmed, country from the city, active', async () => {
      const res = await http()
        .post('/api/hotels')
        .set('x-dev-user', admin)
        .send({
          name: '  Nile View Hotel ',
          address: '12 Corniche El Nil',
          cityId: 'cairo',
          description: 'Riverside hotel with a rooftop pool.',
          photos: ['https://cdn.example.com/hotels/nile-view-1.jpg'],
          starClass: 4,
          amenities: [' WiFi ', 'wifi', 'Pool'],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Nile View Hotel',
        address: '12 Corniche El Nil',
        cityId: 'cairo',
        countryCode: 'EG',
        description: 'Riverside hotel with a rooftop pool.',
        photos: ['https://cdn.example.com/hotels/nile-view-1.jpg'],
        starClass: 4,
        amenities: ['WiFi', 'Pool'],
        isActive: true,
      });
      expect(res.body.id).toMatch(/^[a-f0-9]{24}$/);
      hotelId = res.body.id;
    });

    it('creates a hotel with only the required fields', async () => {
      const res = await http()
        .post('/api/hotels')
        .set('x-dev-user', admin)
        .send({ name: 'Desert Inn', address: 'Main road 5', cityId: 'dubai' })
        .expect(201);
      expect(res.body).toMatchObject({
        countryCode: 'AE',
        description: '',
        photos: [],
        starClass: null,
        amenities: [],
      });
    });

    it('rejects an unknown city with 400', async () => {
      await http()
        .post('/api/hotels')
        .set('x-dev-user', admin)
        .send({ name: 'Ghost Hotel', address: 'Nowhere 1', cityId: 'atlantis' })
        .expect(400);
    });

    it('rejects invalid input with one field error per problem', async () => {
      const res = await http()
        .post('/api/hotels')
        .set('x-dev-user', admin)
        .send({
          name: 'N',
          address: 'x',
          cityId: 'cairo',
          starClass: 9,
          photos: ['not-a-url'],
          countryCode: 'EG',
          isActive: false,
        })
        .expect(400);
      expect(
        res.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
      ).toEqual([
        'address',
        'countryCode',
        'isActive',
        'name',
        'photos',
        'starClass',
      ]);
    });

    it('rejects more than 5 photos', async () => {
      await http()
        .post('/api/hotels')
        .set('x-dev-user', admin)
        .send({
          name: 'Photo Hotel',
          address: 'Gallery road 1',
          cityId: 'cairo',
          photos: Array(6).fill('https://cdn.example.com/p.jpg'),
        })
        .expect(400);
    });

    it('is for admins only: 401 without sign-in, 403 for travellers and moderators', async () => {
      const body = {
        name: 'Sneaky Inn',
        address: 'Side street 2',
        cityId: 'cairo',
      };
      await http().post('/api/hotels').send(body).expect(401);
      await http()
        .post('/api/hotels')
        .set('x-dev-user', `USER:${new Types.ObjectId().toHexString()}`)
        .send(body)
        .expect(403);
      await http()
        .post('/api/hotels')
        .set('x-dev-user', moderatorOf(hotelId))
        .send(body)
        .expect(403);
    });
  });

  describe('PATCH /api/hotels/:id', () => {
    const patch = (id: string, as: string, body: object) =>
      http().patch(`/api/hotels/${id}`).set('x-dev-user', as).send(body);

    it('the assigned moderator edits the profile; other fields stay', async () => {
      const res = await patch(hotelId, moderatorOf(hotelId), {
        name: 'Nile View Grand',
        starClass: 5,
        amenities: ['Gym', 'Airport shuttle'],
        photos: [
          'https://cdn.example.com/a.jpg',
          'https://cdn.example.com/b.jpg',
        ],
      }).expect(200);
      expect(res.body).toMatchObject({
        id: hotelId,
        name: 'Nile View Grand',
        starClass: 5,
        amenities: ['Gym', 'Airport shuttle'],
        photos: [
          'https://cdn.example.com/a.jpg',
          'https://cdn.example.com/b.jpg',
        ],
        address: '12 Corniche El Nil',
        cityId: 'cairo',
        description: 'Riverside hotel with a rooftop pool.',
      });
    });

    it('moving to another city changes the country', async () => {
      const res = await patch(hotelId, moderatorOf(hotelId), {
        cityId: 'london',
      }).expect(200);
      expect(res.body).toMatchObject({ cityId: 'london', countryCode: 'GB' });
    });

    it('rejects an unknown city and leaves the hotel unchanged', async () => {
      await patch(hotelId, moderatorOf(hotelId), { cityId: 'atlantis' }).expect(
        400,
      );
      const res = await patch(hotelId, moderatorOf(hotelId), {
        description: 'Updated',
      }).expect(200);
      expect(res.body).toMatchObject({ cityId: 'london', countryCode: 'GB' });
    });

    it('rejects an empty edit and null fields with field errors', async () => {
      await patch(hotelId, moderatorOf(hotelId), {}).expect(400);
      const res = await patch(hotelId, moderatorOf(hotelId), {
        name: null,
        starClass: 0,
        photos: Array(6).fill('https://cdn.example.com/p.jpg'),
      }).expect(400);
      expect(
        [
          ...new Set(
            res.body.fieldErrors.map((f: { field: string }) => f.field),
          ),
        ].sort(),
      ).toEqual(['name', 'photos', 'starClass']);
    });

    it('a moderator of another hotel, an admin and a traveller get 403 and nothing changes', async () => {
      const otherHotel = new Types.ObjectId().toHexString();
      await patch(hotelId, moderatorOf(otherHotel), {
        name: 'Hijacked',
      }).expect(403);
      await patch(hotelId, admin, { name: 'Hijacked' }).expect(403);
      await patch(hotelId, `USER:${new Types.ObjectId().toHexString()}`, {
        name: 'Hijacked',
      }).expect(403);
      await http()
        .patch(`/api/hotels/${hotelId}`)
        .send({ name: 'Hijacked' })
        .expect(401);
      const model = app.get<Model<Hotel>>(getModelToken(Hotel.name));
      expect((await model.findById(hotelId))?.name).toBe('Nile View Grand');
    });

    it('returns 404 for an unknown hotel and 400 for a malformed id', async () => {
      const unknown = new Types.ObjectId().toHexString();
      await patch(unknown, moderatorOf(unknown), { name: 'Anything' }).expect(
        404,
      );
      await patch('not-an-id', moderatorOf(hotelId), {
        name: 'Anything',
      }).expect(400);
    });

    it('a deactivated hotel cannot be edited (ACC-15)', async () => {
      const model = app.get<Model<Hotel>>(getModelToken(Hotel.name));
      await model.updateOne({ _id: hotelId }, { isActive: false });
      await patch(hotelId, moderatorOf(hotelId), { name: 'Closed Inn' }).expect(
        403,
      );
      // Another hotel's moderator gets the scope error, so the deactivated state does not leak.
      const probe = await patch(
        hotelId,
        moderatorOf(new Types.ObjectId().toHexString()),
        { name: 'Probe' },
      ).expect(403);
      expect(probe.body.message).not.toMatch(/deactivated/i);
      expect((await model.findById(hotelId).lean())?.name).not.toBe(
        'Closed Inn',
      );
      await model.updateOne({ _id: hotelId }, { isActive: true });
      await patch(hotelId, moderatorOf(hotelId), { name: 'Open Again' }).expect(
        200,
      );
    });
  });
});
