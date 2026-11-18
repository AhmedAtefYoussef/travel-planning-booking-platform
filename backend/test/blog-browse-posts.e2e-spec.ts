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

/** BLG-02: guests and users browse published posts (10 per page, tag filter) and open a post page. */
describe('Blog browse and view (e2e): BLG-02', () => {
  const { ctx, http, createPost, publish } = blogSuite();

  it('BLG-02 guests see published posts only, newest first, 10 per page', async () => {
    await createPost(ctx.author, { title: 'Draft', body: 'b' });
    const older = await publish(ctx.author, 'Older');
    const newer = await publish(ctx.author, 'Newer');
    const res = await http().get('/api/posts').expect(200);
    expect(res.body.limit).toBe(10);
    const items = res.body.items as PostBody[];
    expect(new Set(items.map((p) => p.status))).toEqual(new Set(['PUBLISHED']));
    const ids = items.map((p) => p.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    expect(items[0]).toHaveProperty('excerpt');
    await http().get('/api/posts?limit=50').expect(400);
  });

  it('BLG-02 filters by one tag, ignoring case', async () => {
    const tag = `tag${new Types.ObjectId().toHexString().slice(-6)}`;
    await publish(ctx.author, 'Tagged', { tags: [tag] });
    await publish(ctx.author, 'Untagged');
    const res = await http()
      .get(`/api/posts?tag=${tag.toUpperCase()}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].title).toBe('Tagged');
  });

  it('BLG-02 the post page shows title, author, dates, body, tags, images and counts', async () => {
    const post = await publish(ctx.author, 'Page', { tags: ['egypt'] });
    const res = await http().get(`/api/posts/${post.id}`).expect(200);
    expect(res.body).toMatchObject({
      id: post.id,
      title: 'Page',
      body: 'Body of Page',
      tags: ['egypt'],
      images: [],
      likeCount: 0,
      commentCount: 0,
      author: { id: ctx.author.userId },
    });
  });

  it('BLG-02 a draft, a hidden post or an unknown id is 404 on the public page', async () => {
    const draft = await createPost(ctx.author, { title: 'Secret', body: 'b' });
    await http().get(`/api/posts/${draft.id}`).expect(404);
    const hidden = await publish(ctx.author, 'Hidden');
    await ctx.connection
      .collection('posts')
      .updateOne(
        { _id: new Types.ObjectId(hidden.id) },
        { $set: { isHidden: true } },
      );
    await http().get(`/api/posts/${hidden.id}`).expect(404);
    await http()
      .get(`/api/posts/${new Types.ObjectId().toHexString()}`)
      .expect(404);
    await http().get('/api/posts/not-an-id').expect(400);
  });

  it("ACC-12 a deactivated author's posts are hidden from browse, the post page and the tag page, and cannot be liked", async () => {
    const leaver = await loginAs(ctx.app, Role.User);
    const gone = await publish(leaver, 'Soon hidden', { tags: ['acc12'] });
    const kept = await publish(ctx.author, 'Still listed', {
      tags: ['acc12'],
    });
    await ctx.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(leaver.userId) },
        { $set: { status: 'DEACTIVATED' } },
      );
    const ids = (
      (await http().get('/api/posts').expect(200)).body.items as PostBody[]
    ).map((p) => p.id);
    expect(ids).not.toContain(gone.id);
    expect(ids).toContain(kept.id);
    await http().get(`/api/posts/${gone.id}`).expect(404);
    const tagged = (
      (await http().get('/api/tags/acc12/posts').expect(200)).body
        .items as PostBody[]
    ).map((p) => p.id);
    expect(tagged).toEqual([kept.id]);
    await http()
      .post(`/api/posts/${gone.id}/like`)
      .set('Cookie', ctx.reader.cookie)
      .expect(404);
    await http()
      .post(`/api/posts/${kept.id}/like`)
      .set('Cookie', ctx.reader.cookie)
      .expect(200);
  });
});
