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

/** BLG-07: a user edits and deletes their own comments. */
describe('Blog comment edit and delete (e2e): BLG-07', () => {
  const { ctx, http, publish } = blogSuite();

  const comment = async (postId: string, who: LoggedIn, body: string) =>
    (
      await http()
        .post(`/api/posts/${postId}/comments`)
        .set('Cookie', who.cookie)
        .send({ body })
        .expect(201)
    ).body as { id: string };

  it('BLG-07 only the comment author edits it; the text is still 1-500 characters', async () => {
    const post = await publish(ctx.author, 'Edit comments');
    const c = await comment(post.id, ctx.reader, 'orig');
    await http()
      .patch(`/api/comments/${c.id}`)
      .set('Cookie', ctx.author.cookie)
      .send({ body: 'nope' })
      .expect(403);
    const edited = await http()
      .patch(`/api/comments/${c.id}`)
      .set('Cookie', ctx.reader.cookie)
      .send({ body: 'edited' })
      .expect(200);
    expect(edited.body.body).toBe('edited');
    await http()
      .patch(`/api/comments/${c.id}`)
      .set('Cookie', ctx.reader.cookie)
      .send({ body: 'x'.repeat(501) })
      .expect(400);
  });

  it('BLG-07 only the comment author deletes it; the post count goes down', async () => {
    const post = await publish(ctx.author, 'Delete comments');
    const c = await comment(post.id, ctx.reader, 'bye');
    await http()
      .delete(`/api/comments/${c.id}`)
      .set('Cookie', ctx.author.cookie)
      .expect(403);
    await http()
      .delete(`/api/comments/${c.id}`)
      .set('Cookie', ctx.reader.cookie)
      .expect(204);
    const stored = await ctx.connection
      .collection('posts')
      .findOne({ _id: new Types.ObjectId(post.id) });
    expect(stored).toMatchObject({ commentCount: 0, interactionScore: 0 });
    await http()
      .delete(`/api/comments/${c.id}`)
      .set('Cookie', ctx.reader.cookie)
      .expect(404);
  });
});
