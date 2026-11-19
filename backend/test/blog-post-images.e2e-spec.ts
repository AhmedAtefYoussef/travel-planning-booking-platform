import { removeTempUploadDir } from './support/temp-upload-dir';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (fill = 1): Buffer => {
  const buf = Buffer.alloc(128, fill);
  Buffer.from(PNG_SIGNATURE).copy(buf);
  return buf;
};
const POST_IMAGE_URL =
  /^\/uploads\/posts\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.png$/;

/** BLG-10: the author attaches and removes post images under the shared upload rule (GEN-08). */
describe('Blog images (e2e): BLG-10', () => {
  const { http, publish, ctx } = blogSuite();

  afterAll(() => removeTempUploadDir());

  it('BLG-10 the author uploads and removes images; others cannot', async () => {
    const post = await publish(ctx.author, 'Pictures');
    await http()
      .post(`/api/posts/${post.id}/images`)
      .set('Cookie', ctx.reader.cookie)
      .attach('images', png(2), { filename: 'a.png', contentType: 'image/png' })
      .expect(403);
    const up = await http()
      .post(`/api/posts/${post.id}/images`)
      .set('Cookie', ctx.author.cookie)
      .attach('images', png(3), { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(up.body.images).toHaveLength(1);
    const match = POST_IMAGE_URL.exec(up.body.images[0] as string);
    expect(match).not.toBeNull();
    const removed = await http()
      .delete(`/api/posts/${post.id}/images/${match![1]}`)
      .set('Cookie', ctx.author.cookie)
      .expect(200);
    expect(removed.body.images).toEqual([]);
    await http()
      .delete(`/api/posts/${post.id}/images/${match![1]}`)
      .set('Cookie', ctx.author.cookie)
      .expect(404);
    await http()
      .delete(`/api/posts/${post.id}/images/not-a-uuid`)
      .set('Cookie', ctx.author.cookie)
      .expect(400);
  });

  it('BLG-10 refuses non-images and a 6th image (GEN-08)', async () => {
    const post = await publish(ctx.author, 'Limits');
    await http()
      .post(`/api/posts/${post.id}/images`)
      .set('Cookie', ctx.author.cookie)
      .attach('images', Buffer.from('not an image'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(400);
    let req = http()
      .post(`/api/posts/${post.id}/images`)
      .set('Cookie', ctx.author.cookie);
    for (let i = 0; i < 5; i++) {
      req = req.attach('images', png(10 + i), {
        filename: `${i}.png`,
        contentType: 'image/png',
      });
    }
    await req.expect(201);
    await http()
      .post(`/api/posts/${post.id}/images`)
      .set('Cookie', ctx.author.cookie)
      .attach('images', png(20), {
        filename: 'six.png',
        contentType: 'image/png',
      })
      .expect(400);
  });
});
