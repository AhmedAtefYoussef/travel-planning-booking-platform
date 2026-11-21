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
  title: string;
  status: string;
  tags: string[];
  images: string[];
  likeCount: number;
  commentCount: number;
  publishedAt: string | null;
}

/** Shared setup: an app, an author, a second user, and helpers to create posts through the API. */
function blogSuite() {
  const ctx = {} as {
    app: INestApplication<App>;
    connection: Connection;
    author: LoggedIn;
    reader: LoggedIn;
  };
  const http = () => request(ctx.app.getHttpServer());
  const createPost = async (
    who: LoggedIn,
    body: Record<string, unknown>,
  ): Promise<PostBody> =>
    (
      await http()
        .post('/api/posts')
        .set('Cookie', who.cookie)
        .send(body)
        .expect(201)
    ).body as PostBody;
  const publish = (who: LoggedIn, title: string, extra = {}) =>
    createPost(who, {
      title,
      body: `Body of ${title}`,
      status: 'PUBLISHED',
      ...extra,
    });
  beforeAll(async () => {
    ctx.app = await createTestApp();
    ctx.connection = ctx.app.get<Connection>(getConnectionToken());
    ctx.author = await loginAs(ctx.app, Role.User);
    ctx.reader = await loginAs(ctx.app, Role.User);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  return { ctx, http, createPost, publish };
}

/** BLG-12: the public author page shows name, join date and published posts. */
describe('Blog author page (e2e): BLG-12', () => {
  const { ctx, http, createPost, publish } = blogSuite();

  it('BLG-12 shows name, join date and only published posts', async () => {
    const writer = await loginAs(ctx.app, Role.User);
    await publish(writer, 'Public one');
    await createPost(writer, { title: 'Private draft', body: 'b' });
    const res = await http().get(`/api/authors/${writer.userId}`).expect(200);
    expect(res.body).toMatchObject({ id: writer.userId, name: 'E2E USER' });
    expect(res.body.joinedAt).toBeDefined();
    expect(res.body.posts.total).toBe(1);
    expect(res.body.posts.items[0].title).toBe('Public one');
  });

  it('BLG-12 an unknown author is 404 and a bad id 400', async () => {
    await http()
      .get(`/api/authors/${new Types.ObjectId().toHexString()}`)
      .expect(404);
    await http().get('/api/authors/not-an-id').expect(400);
  });

  it("BLG-12 lists the author's public itineraries only (ITN-20, GEN-10)", async () => {
    const writer = await loginAs(ctx.app, Role.User);
    const owner = new Types.ObjectId(writer.userId);
    const itinerary = (
      title: string,
      visibility: string,
      isHidden = false,
    ) => ({
      ownerId: owner,
      title,
      countries: ['EG'],
      startDate: '2027-03-01',
      visibility,
      isHidden,
      days: [
        { _id: new Types.ObjectId(), order: 1, cityId: 'cairo', notes: '' },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.connection
      .collection('itineraries')
      .insertMany([
        itinerary('Public trip', 'PUBLIC'),
        itinerary('Private trip', 'PRIVATE'),
        itinerary('Hidden trip', 'PUBLIC', true),
      ]);
    const res = await http().get(`/api/authors/${writer.userId}`).expect(200);
    expect(res.body.itineraries).toMatchObject({
      total: 1,
      page: 1,
      limit: 10,
    });
    expect(res.body.itineraries.items[0]).toMatchObject({
      title: 'Public trip',
      countries: ['EG'],
      startDate: '2027-03-01',
      days: 1,
    });
    await http()
      .get(`/api/authors/${writer.userId}?itinerariesPage=0`)
      .expect(400);
  });

  it("ACC-12 a deactivated author's page is 404", async () => {
    const leaver = await loginAs(ctx.app, Role.User);
    await publish(leaver, 'Gone soon');
    await ctx.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(leaver.userId) },
        { $set: { status: 'DEACTIVATED' } },
      );
    await http().get(`/api/authors/${leaver.userId}`).expect(404);
  });
});
