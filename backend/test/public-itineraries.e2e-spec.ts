import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { Activity, Itinerary } from '../src/modules/itineraries';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { asUser, loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

interface Detail {
  id: string;
  ownerId: string;
  title: string;
  visibility: string;
  days: {
    id: string;
    cityId: string;
    activities: { id: string; name: string; images: string[] }[];
  }[];
  cityGroups: { cityId: string; startDate: string; endDate: string }[];
  clonedFrom: {
    itineraryId: string;
    authorId: string;
    authorName: string;
  } | null;
}

/**
 * ITN-21: guests and users search public itineraries (keyword on title, country or city; country, city
 * and duration filters) and view one read-only with author, days, activities and budget; a registered
 * user clones one into an independent private copy crediting the author. ITN-20: only PUBLIC ones are
 * found, and making one private removes it at once.
 */
describe('Public itineraries (e2e): ITN-21, ITN-20', () => {
  let app: INestApplication<App>;
  let itineraries: Model<Itinerary>;
  let activities: Model<Activity>;
  let author: LoggedIn;
  let reader: LoggedIn;
  const http = () => request(app.getHttpServer());

  /** Creates an itinerary of `as` with days in `cities`, an activity on day 1, and the visibility. */
  async function make(
    as: LoggedIn,
    title: string,
    cities: string[],
    over: Record<string, unknown> = {},
  ): Promise<Detail> {
    const id = (
      await http()
        .post('/api/itineraries')
        .set('Cookie', as.cookie)
        .send({
          title,
          countries: ['EG'],
          startDate: '2027-06-01',
          visibility: 'PUBLIC',
          ...over,
        })
        .expect(201)
    ).body.id as string;
    let detail: Detail | undefined;
    for (const cityId of cities) {
      detail = (
        await http()
          .post(`/api/itineraries/${id}/days`)
          .set('Cookie', as.cookie)
          .send({ cityId, notes: `Day in ${cityId}` })
          .expect(201)
      ).body as Detail;
    }
    if (detail?.days.length) {
      await http()
        .post(`/api/itineraries/${id}/days/${detail.days[0].id}/activities`)
        .set('Cookie', as.cookie)
        .send({
          name: 'Tour',
          description: 'Guided',
          costMinor: 1000,
          currency: 'EGP',
        })
        .expect(201);
    }
    return (
      await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', as.cookie)
        .expect(200)
    ).body as Detail;
  }

  const search = (qs = '') =>
    http().get(`/api/itineraries/public/search${qs ? `?${qs}` : ''}`);
  const idsOf = (res: request.Response) =>
    (res.body.items as { id: string }[]).map((i) => i.id);

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    activities = app.get<Model<Activity>>(getModelToken(Activity.name));
    author = await loginAs(app, Role.User);
    reader = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-21 / ITN-20 search', () => {
    let nile: Detail;
    let gulf: Detail;
    let secret: Detail;

    beforeAll(async () => {
      nile = await make(author, 'Nile Adventure', ['cairo', 'cairo', 'cairo']);
      gulf = await make(author, 'Gulf getaway', ['dubai'], {
        countries: ['AE'],
      });
      secret = await make(author, 'Secret Nile plan', ['cairo'], {
        visibility: 'PRIVATE',
      });
    });

    it('guests find public itineraries only, with author and cities', async () => {
      const res = await search().expect(200);
      expect(idsOf(res)).toEqual(expect.arrayContaining([nile.id, gulf.id]));
      expect(idsOf(res)).not.toContain(secret.id);
      const row = (res.body.items as Record<string, unknown>[]).find(
        (i) => i.id === nile.id,
      );
      expect(row).toMatchObject({
        title: 'Nile Adventure',
        dayCount: 3,
        visibility: 'PUBLIC',
        author: { id: author.userId, name: 'E2E USER' },
        cityIds: ['cairo'],
      });
    });

    it('matches the keyword on title, country name or code, and city name or id (ignoring case)', async () => {
      expect(idsOf(await search('q=nile').expect(200))).toEqual([nile.id]);
      expect(idsOf(await search('q=EMIRATES').expect(200))).toEqual([gulf.id]);
      expect(idsOf(await search('q=ae').expect(200))).toContain(gulf.id);
      expect(idsOf(await search('q=Dubai').expect(200))).toEqual([gulf.id]);
      expect(idsOf(await search('q=cairo').expect(200))).toEqual([nile.id]);
      const none = await search('q=atlantis').expect(200);
      expect(none.body).toMatchObject({ items: [], total: 0 });
      // Regex characters are matched literally.
      expect((await search('q=.*').expect(200)).body.total).toBe(0);
    });

    it('filters by country, city and duration', async () => {
      expect(idsOf(await search('country=ae').expect(200))).toEqual([gulf.id]);
      expect(idsOf(await search('city=cairo').expect(200))).toEqual([nile.id]);
      expect(idsOf(await search('minDays=2').expect(200))).toEqual([nile.id]);
      expect(idsOf(await search('maxDays=1').expect(200))).toEqual([gulf.id]);
      expect(
        idsOf(await search('minDays=1&maxDays=3&country=EG').expect(200)),
      ).toEqual([nile.id]);
      expect(idsOf(await search('minDays=4').expect(200))).toEqual([]);
    });

    it('rejects bad filters with field errors', async () => {
      const res = await search('minDays=5&maxDays=2').expect(400);
      expect(res.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'maxDays' }),
      ]);
      await search('minDays=0').expect(400);
      await search('maxDays=61').expect(400);
      await search('minDays=abc').expect(400);
      await search('country=EGY').expect(400);
      await search('page=0').expect(400);
      await search('limit=50').expect(400);
    });

    it('ITN-20: making an itinerary private removes it from the search immediately, public brings it back', async () => {
      const temp = await make(author, 'Toggle trip', ['dubai'], {
        countries: ['AE'],
      });
      expect(idsOf(await search('q=toggle').expect(200))).toEqual([temp.id]);
      await http()
        .patch(`/api/itineraries/${temp.id}`)
        .set('Cookie', author.cookie)
        .send({ visibility: 'PRIVATE' })
        .expect(200);
      expect(idsOf(await search('q=toggle').expect(200))).toEqual([]);
      await http().get(`/api/itineraries/public/${temp.id}`).expect(404);
      await http()
        .patch(`/api/itineraries/${temp.id}`)
        .set('Cookie', author.cookie)
        .send({ visibility: 'PUBLIC' })
        .expect(200);
      expect(idsOf(await search('q=toggle').expect(200))).toEqual([temp.id]);
    });

    it('ITN-01: a deleted itinerary leaves the search; hidden itineraries (GEN-10) are never shown', async () => {
      const temp = await make(author, 'Doomed trip', ['cairo']);
      const hidden = await make(author, 'Hidden trip', ['cairo']);
      await itineraries
        .updateOne({ _id: hidden.id }, { $set: { isHidden: true } })
        .exec();
      await http()
        .delete(`/api/itineraries/${temp.id}`)
        .set('Cookie', author.cookie)
        .expect(204);
      expect(idsOf(await search('q=doomed').expect(200))).toEqual([]);
      expect(idsOf(await search('q=hidden').expect(200))).toEqual([]);
      await http().get(`/api/itineraries/public/${hidden.id}`).expect(404);
      // The owner still sees a hidden itinerary.
      await http()
        .get(`/api/itineraries/${hidden.id}`)
        .set('Cookie', author.cookie)
        .expect(200);
    });
  });

  describe('ITN-21 view', () => {
    it('anyone views a public itinerary read-only with author, days, activities and budget', async () => {
      const src = await make(author, 'View me', ['cairo', 'dubai']);
      const res = await http()
        .get(`/api/itineraries/public/${src.id}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: src.id,
        title: 'View me',
        author: { id: author.userId, name: 'E2E USER' },
        dayCount: 2,
        budgetTotal: [{ currency: 'EGP', amountMinor: 1000 }],
      });
      expect(res.body.days[0].activities[0]).toMatchObject({ name: 'Tour' });
      expect(res.body.cityGroups).toHaveLength(2);
    });

    it('a private or unknown itinerary is the same 404; a malformed id is 400', async () => {
      const priv = await make(author, 'Private', ['cairo'], {
        visibility: 'PRIVATE',
      });
      const a = await http()
        .get(`/api/itineraries/public/${priv.id}`)
        .expect(404);
      const b = await http()
        .get(`/api/itineraries/public/${new Types.ObjectId().toHexString()}`)
        .expect(404);
      expect(a.body.message).toBe(b.body.message);
      await http().get('/api/itineraries/public/nope').expect(400);
    });

    it('public itineraries stay read-only to other users', async () => {
      const src = await make(author, 'Read only', ['cairo']);
      await http()
        .patch(`/api/itineraries/${src.id}`)
        .set('Cookie', reader.cookie)
        .send({ title: 'Mine' })
        .expect(404);
      await http()
        .post(`/api/itineraries/${src.id}/days`)
        .set('Cookie', reader.cookie)
        .send({ cityId: 'cairo' })
        .expect(404);
      await http()
        .get(`/api/itineraries/${src.id}`)
        .set('Cookie', reader.cookie)
        .expect(404);
    });
  });

  describe('ITN-21 clone', () => {
    it('clones a public itinerary into an independent private copy that credits the author', async () => {
      const src = await make(author, 'Clone me', ['cairo', 'dubai', 'cairo']);
      await activities
        .updateOne(
          { itineraryId: new Types.ObjectId(src.id) },
          {
            $set: {
              images: [
                '/uploads/activities/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e.png',
              ],
            },
          },
        )
        .exec();
      const res = await http()
        .post(`/api/itineraries/${src.id}/clone`)
        .set('Cookie', reader.cookie)
        .expect(201);
      const copy = res.body as Detail;
      expect(copy).toMatchObject({
        ownerId: reader.userId,
        title: 'Clone me',
        visibility: 'PRIVATE',
        clonedFrom: {
          itineraryId: src.id,
          authorId: author.userId,
          authorName: 'E2E USER',
        },
      });
      expect(copy.id).not.toBe(src.id);
      expect(copy.days.map((d) => d.cityId)).toEqual([
        'cairo',
        'dubai',
        'cairo',
      ]);
      expect(copy.days.map((d) => d.id)).not.toEqual(src.days.map((d) => d.id));
      expect(copy.days[0].activities).toEqual([
        expect.objectContaining({
          name: 'Tour',
          costMinor: 1000,
          images: [
            '/uploads/activities/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e.png',
          ],
        }),
      ]);
      expect(copy.days[0].activities[0].id).not.toBe(
        src.days[0].activities[0].id,
      );
      expect(copy.cityGroups).toEqual(src.cityGroups);

      // It is the reader's own private itinerary now.
      const mine = await http()
        .get('/api/itineraries')
        .set('Cookie', reader.cookie)
        .expect(200);
      expect(idsOf(mine)).toContain(copy.id);
      expect(idsOf(await search('q=clone me').expect(200))).toEqual([src.id]);

      // Independent: editing or deleting the original leaves the copy as it was.
      await http()
        .patch(`/api/itineraries/${src.id}`)
        .set('Cookie', author.cookie)
        .send({ title: 'Changed original' })
        .expect(200);
      await http()
        .delete(`/api/itineraries/${src.id}/days/${src.days[0].id}`)
        .set('Cookie', author.cookie)
        .expect(200);
      await http()
        .delete(`/api/itineraries/${src.id}`)
        .set('Cookie', author.cookie)
        .expect(204);
      const after = (
        await http()
          .get(`/api/itineraries/${copy.id}`)
          .set('Cookie', reader.cookie)
          .expect(200)
      ).body as Detail;
      expect(after).toMatchObject({
        title: 'Clone me',
        clonedFrom: { itineraryId: src.id },
      });
      expect(after.days).toHaveLength(3);
      expect(after.days[0].activities).toHaveLength(1);
    });

    it('a private or hidden itinerary cannot be cloned (404); guests and admins cannot clone', async () => {
      const priv = await make(author, 'No clone', ['cairo'], {
        visibility: 'PRIVATE',
      });
      await http()
        .post(`/api/itineraries/${priv.id}/clone`)
        .set('Cookie', reader.cookie)
        .expect(404);
      const pub = await make(author, 'Guest clone', ['cairo']);
      await http().post(`/api/itineraries/${pub.id}/clone`).expect(401);
      await http()
        .post(`/api/itineraries/${pub.id}/clone`)
        .set(asUser(Role.Admin))
        .expect(403);
      await itineraries
        .updateOne({ _id: pub.id }, { $set: { isHidden: true } })
        .exec();
      await http()
        .post(`/api/itineraries/${pub.id}/clone`)
        .set('Cookie', reader.cookie)
        .expect(404);
    });
  });
});

/** ITN-25: hotels for a city group, reusing hotel search (HTL-11) through HOTELS_SEARCH. */
