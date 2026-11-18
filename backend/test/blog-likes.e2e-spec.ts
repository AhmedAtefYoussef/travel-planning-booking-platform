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

/** BLG-06: a user likes a post once and can remove the like. */
describe('Blog likes (e2e): BLG-06', () => {
  const { ctx, http, createPost, publish } = blogSuite();

  it('BLG-06 likes once (409 ALREADY_LIKED the second time) and removes the like', async () => {
    const post = await publish(ctx.author, 'Likeable');
    const liked = await http()
      .post(`/api/posts/${post.id}/like`)
      .set('Cookie', ctx.reader.cookie)
      .expect(200);
    expect(liked.body).toEqual({ postId: post.id, liked: true, likeCount: 1 });
    const again = await http()
      .post(`/api/posts/${post.id}/like`)
      .set('Cookie', ctx.reader.cookie)
      .expect(409);
    expect(again.body.code).toBe('ALREADY_LIKED');
    const unliked = await http()
      .delete(`/api/posts/${post.id}/like`)
      .set('Cookie', ctx.reader.cookie)
      .expect(200);
    expect(unliked.body).toEqual({
      postId: post.id,
      liked: false,
      likeCount: 0,
    });
    await http()
      .delete(`/api/posts/${post.id}/like`)
      .set('Cookie', ctx.reader.cookie)
      .expect(404);
  });

  it('BLG-06 concurrent likes by the same user count once', async () => {
    const post = await publish(ctx.author, 'Race');
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        http()
          .post(`/api/posts/${post.id}/like`)
          .set('Cookie', ctx.reader.cookie),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const stored = await ctx.connection
      .collection('posts')
      .findOne({ _id: new Types.ObjectId(post.id) });
    expect(stored).toMatchObject({ likeCount: 1, interactionScore: 1 });
  });

  it('BLG-06 drafts cannot be liked (404) and guests get 401', async () => {
    const draft = await createPost(ctx.author, { title: 'Draft', body: 'b' });
    await http()
      .post(`/api/posts/${draft.id}/like`)
      .set('Cookie', ctx.reader.cookie)
      .expect(404);
    await http().post(`/api/posts/${draft.id}/like`).expect(401);
  });
});
