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

/** BLG-09: guests and users search published posts by keyword in the title, tags or author name. */
describe('Blog search (e2e): BLG-09', () => {
  const { ctx, http, createPost, publish } = blogSuite();

  /** Adds likes and comments straight to the counters, as BLG-05 and BLG-06 do in their transactions. */
  const interactions = (id: string, n: number) =>
    ctx.connection
      .collection('posts')
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { likeCount: n, interactionScore: n } },
      );

  it('BLG-09 matches title or tag and orders by likes + comments, newest first on a tie', async () => {
    const word = `kw${new Types.ObjectId().toHexString().slice(-8)}`;
    const quiet = await publish(ctx.author, `Quiet ${word}`);
    const popular = await publish(ctx.author, 'Popular', { tags: [word] });
    const newerTie = await publish(ctx.author, `Newer ${word}`);
    await createPost(ctx.author, { title: `Draft ${word}`, body: 'b' });
    await interactions(popular.id, 2);
    await interactions(quiet.id, 1);
    await interactions(newerTie.id, 1);
    const res = await http()
      .get(`/api/posts?q=${word.toUpperCase()}`)
      .expect(200);
    expect((res.body.items as PostBody[]).map((p) => p.id)).toEqual([
      popular.id,
      newerTie.id,
      quiet.id,
    ]);
    expect(res.body.items[0]).toHaveProperty('excerpt');
  });

  it('BLG-09 finds posts by author name and returns an empty page when nothing matches', async () => {
    const named = await loginAs(ctx.app, Role.User);
    const unique = `Writer${new Types.ObjectId().toHexString().slice(-8)}`;
    await ctx.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(named.userId) },
        { $set: { name: unique } },
      );
    await publish(named, 'By name');
    const res = await http().get(`/api/posts?q=${unique}`).expect(200);
    expect(res.body.total).toBe(1);
    const none = await http().get('/api/posts?q=(.*)zz-none').expect(200);
    expect(none.body).toMatchObject({ total: 0, items: [] });
  });

  it("ACC-12 a deactivated author's posts are never found, by title, tag or name", async () => {
    const leaver = await loginAs(ctx.app, Role.User);
    const unique = `Leaver${new Types.ObjectId().toHexString().slice(-8)}`;
    await ctx.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(leaver.userId) },
        { $set: { name: unique } },
      );
    const word = `acc${new Types.ObjectId().toHexString().slice(-8)}`;
    const gone = await publish(leaver, `Gone ${word}`, { tags: [word] });
    const kept = await publish(ctx.author, `Kept ${word}`);
    const found = async (q: string) =>
      (
        (await http().get(`/api/posts?q=${q}`).expect(200)).body
          .items as PostBody[]
      ).map((p) => p.id);
    expect(await found(word)).toEqual(expect.arrayContaining([gone.id]));
    await ctx.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(leaver.userId) },
        { $set: { status: 'DEACTIVATED' } },
      );
    expect(await found(word)).toEqual([kept.id]);
    expect(await found(unique)).toEqual([]);
  });
});
