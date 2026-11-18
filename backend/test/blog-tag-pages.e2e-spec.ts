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

/** BLG-08: a clickable tag lists the published posts carrying it. */
describe('Blog tag pages (e2e): BLG-08', () => {
  const { ctx, http, createPost, publish } = blogSuite();

  it('BLG-08 a tag link lists published posts with that tag, ignoring case, newest first', async () => {
    const tag = `tag${new Types.ObjectId().toHexString().slice(-6)}`;
    const first = await publish(ctx.author, 'First', { tags: [tag] });
    const second = await publish(ctx.author, 'Second', {
      tags: [tag.toUpperCase()],
    });
    await createPost(ctx.author, { title: 'Draft', body: 'b', tags: [tag] });
    await publish(ctx.author, 'Other', { tags: ['other'] });
    const res = await http()
      .get(`/api/tags/${tag.toUpperCase()}/posts`)
      .expect(200);
    expect(res.body.total).toBe(2);
    expect((res.body.items as PostBody[]).map((p) => p.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('BLG-08 a tag over 30 characters is 400', async () => {
    await http()
      .get(`/api/tags/${'x'.repeat(31)}/posts`)
      .expect(400);
  });
});
