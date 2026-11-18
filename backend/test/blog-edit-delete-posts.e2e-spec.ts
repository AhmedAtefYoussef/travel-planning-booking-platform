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

/** BLG-04: only the author edits and deletes a post. */
describe('Blog edit and delete (e2e): BLG-04', () => {
  const { ctx, http, createPost, publish } = blogSuite();

  it('BLG-04 the author edits; tags are replaced and normalised (BLG-08)', async () => {
    const post = await publish(ctx.author, 'Owned', { tags: ['old'] });
    const res = await http()
      .patch(`/api/posts/${post.id}`)
      .set('Cookie', ctx.author.cookie)
      .send({ title: 'Renamed', tags: ['New', 'other'] })
      .expect(200);
    expect(res.body).toMatchObject({
      title: 'Renamed',
      tags: ['new', 'other'],
    });
  });

  it('BLG-04 publishing a draft stamps publishedAt; null title is 400', async () => {
    const draft = await createPost(ctx.author, { title: 'Later', body: 'b' });
    const res = await http()
      .patch(`/api/posts/${draft.id}`)
      .set('Cookie', ctx.author.cookie)
      .send({ status: 'PUBLISHED' })
      .expect(200);
    expect(res.body.publishedAt).not.toBeNull();
    await http()
      .patch(`/api/posts/${draft.id}`)
      .set('Cookie', ctx.author.cookie)
      .send({ title: null })
      .expect(400);
  });

  it('BLG-04 another user: 403 on a published post, 404 on a draft', async () => {
    const live = await publish(ctx.author, 'Live');
    const draft = await createPost(ctx.author, { title: 'Draft', body: 'b' });
    await http()
      .patch(`/api/posts/${live.id}`)
      .set('Cookie', ctx.reader.cookie)
      .send({ title: 'Hijack' })
      .expect(403);
    await http()
      .patch(`/api/posts/${draft.id}`)
      .set('Cookie', ctx.reader.cookie)
      .send({ title: 'Hijack' })
      .expect(404);
    await http()
      .delete(`/api/posts/${live.id}`)
      .set('Cookie', ctx.reader.cookie)
      .expect(403);
  });

  it("BLG-04 an edit can reorder or remove the post's own images but never add one (GEN-08)", async () => {
    const post = await publish(ctx.author, 'Pictures');
    const own = [
      '/uploads/posts/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e.png',
      '/uploads/posts/4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jpg',
    ];
    await ctx.connection
      .collection('posts')
      .updateOne(
        { _id: new Types.ObjectId(post.id) },
        { $set: { images: own } },
      );
    const reordered = await http()
      .patch(`/api/posts/${post.id}`)
      .set('Cookie', ctx.author.cookie)
      .send({ images: [own[1], own[0]] })
      .expect(200);
    expect(reordered.body.images).toEqual([own[1], own[0]]);
    for (const images of [
      [own[0], '/uploads/posts/5b2c3d4e-6f7a-4b8c-9d0e-1f2a3b4c5d6e.png'],
      ['http://example.com/not-an-image.exe'],
      [own[0], own[0]],
    ]) {
      const res = await http()
        .patch(`/api/posts/${post.id}`)
        .set('Cookie', ctx.author.cookie)
        .send({ images })
        .expect(400);
      expect(res.body.fieldErrors[0].field).toBe('images');
    }
  });

  it('BLG-04 deleting a post also deletes its comments and likes', async () => {
    const post = await publish(ctx.author, 'To delete');
    const postId = new Types.ObjectId(post.id);
    await ctx.connection.collection('comments').insertOne({
      postId,
      authorId: new Types.ObjectId(ctx.reader.userId),
      body: 'bye',
      isHidden: false,
    });
    await ctx.connection
      .collection('likes')
      .insertOne({ postId, userId: new Types.ObjectId(ctx.reader.userId) });
    await http()
      .delete(`/api/posts/${post.id}`)
      .set('Cookie', ctx.author.cookie)
      .expect(204);
    expect(
      await ctx.connection.collection('posts').countDocuments({ _id: postId }),
    ).toBe(0);
    expect(
      await ctx.connection.collection('comments').countDocuments({ postId }),
    ).toBe(0);
    expect(
      await ctx.connection.collection('likes').countDocuments({ postId }),
    ).toBe(0);
    await http()
      .delete(`/api/posts/${post.id}`)
      .set('Cookie', ctx.author.cookie)
      .expect(404);
  });
});
