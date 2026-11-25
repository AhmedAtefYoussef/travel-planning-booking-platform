import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

interface PostBody {
  id: string;
  itineraryId?: string | null;
  itinerary?: {
    id: string;
    title: string;
    countries: string[];
    startDate: string;
    days: number;
  };
}

/** BLG-13: the author attaches an itinerary to a post. */
describe('Blog post itinerary (e2e): BLG-13', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let author: LoggedIn;
  let other: LoggedIn;
  const http = () => request(app.getHttpServer());

  const insertItinerary = async (
    owner: LoggedIn,
    title: string,
    visibility: 'PUBLIC' | 'PRIVATE',
    isHidden = false,
  ): Promise<string> => {
    const _id = new Types.ObjectId();
    await connection.collection('itineraries').insertOne({
      _id,
      ownerId: new Types.ObjectId(owner.userId),
      title,
      countries: ['EG'],
      startDate: '2027-03-01',
      visibility,
      isHidden,
      days: [
        { _id: new Types.ObjectId(), order: 1, cityId: 'cairo', notes: '' },
        { _id: new Types.ObjectId(), order: 2, cityId: 'giza', notes: '' },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return _id.toHexString();
  };
  const createPost = async (
    who: LoggedIn,
    status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED',
  ): Promise<string> =>
    (
      await http()
        .post('/api/posts')
        .set('Cookie', who.cookie)
        .send({ title: 'Cairo notes', body: 'Body', status })
        .expect(201)
    ).body.id as string;
  const attach = (who: LoggedIn, postId: string, itineraryId: unknown) =>
    http()
      .patch(`/api/posts/${postId}/itinerary`)
      .set('Cookie', who.cookie)
      .send({ itineraryId });
  const publicPost = async (postId: string) =>
    (await http().get(`/api/posts/${postId}`).expect(200)).body as PostBody;

  beforeAll(async () => {
    app = await createTestApp();
    connection = app.get<Connection>(getConnectionToken());
    author = await loginAs(app, Role.User);
    other = await loginAs(app, Role.User);
  });
  afterAll(async () => {
    await app.close();
  });

  it('BLG-13 attaches the author’s own public itinerary and the public post embeds it', async () => {
    const postId = await createPost(author);
    const itineraryId = await insertItinerary(author, 'Nile', 'PUBLIC');
    const res = await attach(author, postId, itineraryId).expect(200);
    expect(res.body).toMatchObject({
      id: postId,
      itineraryId,
      itinerary: {
        id: itineraryId,
        title: 'Nile',
        countries: ['EG'],
        startDate: '2027-03-01',
        days: 2,
      },
    });
    const seen = await publicPost(postId);
    expect(seen.itinerary).toMatchObject({ id: itineraryId, days: 2 });
    expect(seen).not.toHaveProperty('itineraryId');
  });

  it('BLG-13 lists, author page and tag page embed the itinerary in one batch', async () => {
    const writer = await loginAs(app, Role.User);
    const postId = await createPost(writer);
    await http()
      .patch(`/api/posts/${postId}`)
      .set('Cookie', writer.cookie)
      .send({ tags: ['blg13tag'] })
      .expect(200);
    const itineraryId = await insertItinerary(writer, 'Listed', 'PUBLIC');
    await attach(writer, postId, itineraryId).expect(200);
    const lists = [
      `/api/posts?tag=blg13tag`,
      `/api/authors/${writer.userId}`,
      `/api/tags/blg13tag/posts`,
    ];
    for (const url of lists) {
      const res = await http().get(url).expect(200);
      const items = (res.body.posts?.items ?? res.body.items) as PostBody[];
      expect(items[0].itinerary).toMatchObject({
        id: itineraryId,
        title: 'Listed',
      });
    }
    const mine = await http()
      .get('/api/posts/mine')
      .set('Cookie', writer.cookie)
      .expect(200);
    expect((mine.body.items as PostBody[])[0].itinerary?.id).toBe(itineraryId);
  });

  it('BLG-13 attaching the author’s own private itinerary is allowed but never embedded publicly', async () => {
    const postId = await createPost(author);
    const itineraryId = await insertItinerary(author, 'Secret', 'PRIVATE');
    const res = await attach(author, postId, itineraryId).expect(200);
    expect(res.body.itineraryId).toBe(itineraryId);
    expect(res.body.itinerary).toBeUndefined();
    const seen = await publicPost(postId);
    expect(seen.itinerary).toBeUndefined();
    expect(seen).not.toHaveProperty('itineraryId');
    const own = await http()
      .get(`/api/posts/mine/${postId}`)
      .set('Cookie', author.cookie)
      .expect(200);
    expect(own.body.itineraryId).toBe(itineraryId);
  });

  it('BLG-13 another user’s public itinerary may be attached', async () => {
    const postId = await createPost(author);
    const itineraryId = await insertItinerary(other, 'Theirs', 'PUBLIC');
    await attach(author, postId, itineraryId).expect(200);
    expect((await publicPost(postId)).itinerary?.title).toBe('Theirs');
  });

  it('BLG-13 another user’s private itinerary is 404 and nothing is stored', async () => {
    const postId = await createPost(author);
    const itineraryId = await insertItinerary(other, 'Hidden away', 'PRIVATE');
    const res = await attach(author, postId, itineraryId).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    const own = await http()
      .get(`/api/posts/mine/${postId}`)
      .set('Cookie', author.cookie)
      .expect(200);
    expect(own.body.itineraryId).toBeNull();
  });

  it('BLG-13 an itinerary hidden by an admin or an unknown one is 404', async () => {
    const postId = await createPost(author);
    const hidden = await insertItinerary(author, 'Hidden', 'PUBLIC', true);
    await attach(author, postId, hidden).expect(404);
    await attach(author, postId, new Types.ObjectId().toHexString()).expect(
      404,
    );
  });

  it('BLG-13 an itinerary that turns private or is deleted later shows no summary', async () => {
    const postId = await createPost(author);
    const itineraryId = await insertItinerary(author, 'Flip', 'PUBLIC');
    await attach(author, postId, itineraryId).expect(200);
    await connection
      .collection('itineraries')
      .updateOne(
        { _id: new Types.ObjectId(itineraryId) },
        { $set: { visibility: 'PRIVATE' } },
      );
    expect((await publicPost(postId)).itinerary).toBeUndefined();
    await connection
      .collection('itineraries')
      .deleteOne({ _id: new Types.ObjectId(itineraryId) });
    expect((await publicPost(postId)).itinerary).toBeUndefined();
  });

  it('BLG-13 null detaches the itinerary', async () => {
    const postId = await createPost(author);
    const itineraryId = await insertItinerary(author, 'Temp', 'PUBLIC');
    await attach(author, postId, itineraryId).expect(200);
    const res = await attach(author, postId, null).expect(200);
    expect(res.body.itineraryId).toBeNull();
    expect(res.body.itinerary).toBeUndefined();
    expect((await publicPost(postId)).itinerary).toBeUndefined();
  });

  it('BLG-13 only the author: 403 for a published post, 404 for a draft', async () => {
    const itineraryId = await insertItinerary(other, 'Mine', 'PUBLIC');
    const published = await createPost(author);
    const draft = await createPost(author, 'DRAFT');
    await attach(other, published, itineraryId).expect(403);
    await attach(other, draft, itineraryId).expect(404);
    await attach(other, new Types.ObjectId().toHexString(), itineraryId).expect(
      404,
    );
  });

  it('BLG-13 a guest is 401', async () => {
    const postId = await createPost(author);
    await http()
      .patch(`/api/posts/${postId}/itinerary`)
      .send({ itineraryId: null })
      .expect(401);
  });

  it('BLG-13 an invalid itineraryId or post id is 400', async () => {
    const postId = await createPost(author);
    const res = await attach(author, postId, 'not-an-id').expect(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'itineraryId' }),
      ]),
    );
    await attach(author, postId, 123).expect(400);
    await http()
      .patch(`/api/posts/${postId}/itinerary`)
      .set('Cookie', author.cookie)
      .send({})
      .expect(400);
    await attach(author, 'not-an-id', null).expect(400);
  });
});
