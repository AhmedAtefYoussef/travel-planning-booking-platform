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

/** BLG-03: a user lists and opens their own posts, drafts included. */
describe('Blog my posts (e2e): BLG-03', () => {
  const { ctx, http, createPost, publish } = blogSuite();

  it('BLG-03 lists my drafts and published posts with counts, never someone else’s', async () => {
    const me = await loginAs(ctx.app, Role.User);
    await createPost(me, { title: 'Mine draft', body: 'b' });
    await publish(me, 'Mine live');
    await publish(ctx.reader, 'Not mine');
    const res = await http()
      .get('/api/posts/mine')
      .set('Cookie', me.cookie)
      .expect(200);
    expect(res.body.total).toBe(2);
    expect((res.body.items as PostBody[]).map((p) => p.title).sort()).toEqual([
      'Mine draft',
      'Mine live',
    ]);
    expect(res.body.items[0]).toMatchObject({ likeCount: 0, commentCount: 0 });
    expect(res.body.items[0]).toHaveProperty('status');
  });

  it('BLG-03 the author opens their own draft; another user gets 404; guests 401', async () => {
    const draft = await createPost(ctx.author, { title: 'Draft', body: 'b' });
    const res = await http()
      .get(`/api/posts/mine/${draft.id}`)
      .set('Cookie', ctx.author.cookie)
      .expect(200);
    expect(res.body).toMatchObject({ title: 'Draft', status: 'DRAFT' });
    await http()
      .get(`/api/posts/mine/${draft.id}`)
      .set('Cookie', ctx.reader.cookie)
      .expect(404);
    await http().get('/api/posts/mine').expect(401);
  });

  it('BLG-03 hidden posts stay visible to their author (GEN-10)', async () => {
    const post = await publish(ctx.author, 'Hidden');
    await ctx.connection
      .collection('posts')
      .updateOne(
        { _id: new Types.ObjectId(post.id) },
        { $set: { isHidden: true } },
      );
    const res = await http()
      .get(`/api/posts/mine/${post.id}`)
      .set('Cookie', ctx.author.cookie)
      .expect(200);
    expect(res.body.isHidden).toBe(true);
  });
});
