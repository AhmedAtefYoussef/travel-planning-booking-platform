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

/** BLG-05: users comment on published posts (1-500 characters), shown oldest first. */
describe('Blog comments (e2e): BLG-05', () => {
  const { ctx, http, createPost, publish } = blogSuite();

  it('BLG-05 comments are 1-500 characters, chronological, and counted on the post', async () => {
    const post = await publish(ctx.author, 'Discuss');
    for (const body of ['first', 'second']) {
      await http()
        .post(`/api/posts/${post.id}/comments`)
        .set('Cookie', ctx.reader.cookie)
        .send({ body })
        .expect(201);
    }
    await http()
      .post(`/api/posts/${post.id}/comments`)
      .set('Cookie', ctx.reader.cookie)
      .send({ body: '   ' })
      .expect(400);
    await http()
      .post(`/api/posts/${post.id}/comments`)
      .set('Cookie', ctx.reader.cookie)
      .send({ body: 'x'.repeat(501) })
      .expect(400);
    const list = await http().get(`/api/posts/${post.id}/comments`).expect(200);
    expect((list.body.items as { body: string }[]).map((c) => c.body)).toEqual([
      'first',
      'second',
    ]);
    const stored = await ctx.connection
      .collection('posts')
      .findOne({ _id: new Types.ObjectId(post.id) });
    expect(stored).toMatchObject({ commentCount: 2, interactionScore: 2 });
  });

  it('BLG-05 drafts take no comments and their comments are not listed (404)', async () => {
    const draft = await createPost(ctx.author, { title: 'Quiet', body: 'b' });
    await http()
      .post(`/api/posts/${draft.id}/comments`)
      .set('Cookie', ctx.reader.cookie)
      .send({ body: 'hello' })
      .expect(404);
    await http().get(`/api/posts/${draft.id}/comments`).expect(404);
  });

  it('BLG-05 guests can read comments but not write them (401)', async () => {
    const post = await publish(ctx.author, 'Open');
    await http().get(`/api/posts/${post.id}/comments`).expect(200);
    await http()
      .post(`/api/posts/${post.id}/comments`)
      .send({ body: 'hi' })
      .expect(401);
  });
});
