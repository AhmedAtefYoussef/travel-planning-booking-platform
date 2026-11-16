import { removeTempUploadDir } from './support/temp-upload-dir';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (fill = 1): Buffer => {
  const buf = Buffer.alloc(128, fill);
  Buffer.from(PNG_SIGNATURE).copy(buf);
  return buf;
};
const POST_IMAGE_URL =
  /^\/uploads\/posts\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.png$/;

interface PostBody {
  id: string;
  title: string;
  status: string;
  tags: string[];
  images: string[];
  likeCount: number;
  commentCount: number;
  publishedAt: string | null;
  author: { id: string; name: string };
}

/**
 * Blog and community (brief section 6.6): BLG-01..BLG-10 and BLG-12. Guests read published posts;
 * registered users write posts, comments and likes; only the author changes a post or a comment.
 */
describe('Blog (e2e): BLG-01..BLG-10, BLG-12', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let author: LoggedIn;
  let reader: LoggedIn;
  const http = () => request(app.getHttpServer());

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
    app = await createTestApp();
    connection = app.get<Connection>(getConnectionToken());
    author = await loginAs(app, Role.User);
    reader = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
    removeTempUploadDir();
  });

  describe('BLG-01 create', () => {
    it('saves a draft by default and publishes on request', async () => {
      const draft = await createPost(author, { title: 'Draft', body: 'x' });
      expect(draft.status).toBe('DRAFT');
      expect(draft.publishedAt).toBeNull();
      expect(draft.author.id).toBe(author.userId);

      const live = await publish(author, 'Live post');
      expect(live.status).toBe('PUBLISHED');
      expect(live.publishedAt).not.toBeNull();
    });

    it('requires a title and body and rejects unknown fields (400 fieldErrors)', async () => {
      const res = await http()
        .post('/api/posts')
        .set('Cookie', author.cookie)
        .send({ title: '  ', likeCount: 99 })
        .expect(400);
      const fields = (res.body.fieldErrors as { field: string }[]).map(
        (f) => f.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining(['title', 'body', 'likeCount']),
      );
    });

    it('guests cannot create posts (401)', async () => {
      await http()
        .post('/api/posts')
        .send({ title: 't', body: 'b' })
        .expect(401);
    });
  });

  describe('BLG-08 tags', () => {
    it('lowercases and de-duplicates tags, at most 5 of at most 30 characters', async () => {
      const post = await publish(author, 'Tagged', {
        tags: ['Egypt', ' egypt ', 'Nile'],
      });
      expect(post.tags).toEqual(['egypt', 'nile']);

      const tooMany = await http()
        .post('/api/posts')
        .set('Cookie', author.cookie)
        .send({ title: 't', body: 'b', tags: ['a', 'b', 'c', 'd', 'e', 'f'] })
        .expect(400);
      expect(tooMany.body.fieldErrors[0].field).toBe('tags');
      await http()
        .post('/api/posts')
        .set('Cookie', author.cookie)
        .send({ title: 't', body: 'b', tags: ['x'.repeat(31)] })
        .expect(400);
    });

    it('a tag link lists published posts with that tag, ignoring case', async () => {
      const tag = `tag${new Types.ObjectId().toHexString().slice(-6)}`;
      await publish(author, 'With tag', { tags: [tag] });
      await createPost(author, {
        title: 'Draft with tag',
        body: 'b',
        tags: [tag],
      });
      const res = await http()
        .get(`/api/tags/${tag.toUpperCase()}/posts`)
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].title).toBe('With tag');

      const filtered = await http().get(`/api/posts?tag=${tag}`).expect(200);
      expect(filtered.body.total).toBe(1);
    });

    it('the author edits the tags later', async () => {
      const post = await publish(author, 'Retag', { tags: ['old'] });
      const res = await http()
        .patch(`/api/posts/${post.id}`)
        .set('Cookie', author.cookie)
        .send({ tags: ['New', 'other'] })
        .expect(200);
      expect(res.body.tags).toEqual(['new', 'other']);
    });
  });

  describe('BLG-02 browse and view', () => {
    it('guests see published posts only, 10 per page, newest first', async () => {
      const res = await http().get('/api/posts').expect(200);
      expect(res.body.limit).toBe(10);
      const statuses = new Set(
        (res.body.items as PostBody[]).map((p) => p.status),
      );
      expect([...statuses]).toEqual(['PUBLISHED']);
      await http().get('/api/posts?limit=50').expect(400);
    });

    it('a draft or hidden post is 404 on the public page', async () => {
      const draft = await createPost(author, { title: 'Secret', body: 'b' });
      await http().get(`/api/posts/${draft.id}`).expect(404);

      const hidden = await publish(author, 'Hidden one');
      await connection
        .collection('posts')
        .updateOne(
          { _id: new Types.ObjectId(hidden.id) },
          { $set: { isHidden: true } },
        );
      await http().get(`/api/posts/${hidden.id}`).expect(404);
      // GEN-10: the author still sees it.
      await http()
        .get(`/api/posts/mine/${hidden.id}`)
        .set('Cookie', author.cookie)
        .expect(200);
    });
  });

  describe('BLG-03 my posts', () => {
    it('lists my drafts and published posts, never someone else’s', async () => {
      const me = await loginAs(app, Role.User);
      await createPost(me, { title: 'Mine draft', body: 'b' });
      await publish(me, 'Mine live');
      await publish(reader, 'Not mine');
      const res = await http()
        .get('/api/posts/mine')
        .set('Cookie', me.cookie)
        .expect(200);
      expect(res.body.total).toBe(2);
      expect((res.body.items as PostBody[]).map((p) => p.title).sort()).toEqual(
        ['Mine draft', 'Mine live'],
      );
      expect(res.body.items[0]).toHaveProperty('likeCount');
      expect(res.body.items[0]).toHaveProperty('commentCount');
    });
  });

  describe('BLG-04 edit and delete', () => {
    it('only the author edits: 403 on another user’s published post, 404 on their draft', async () => {
      const live = await publish(author, 'Owned');
      const draft = await createPost(author, {
        title: 'Owned draft',
        body: 'b',
      });
      await http()
        .patch(`/api/posts/${live.id}`)
        .set('Cookie', reader.cookie)
        .send({ title: 'Hijack' })
        .expect(403);
      await http()
        .patch(`/api/posts/${draft.id}`)
        .set('Cookie', reader.cookie)
        .send({ title: 'Hijack' })
        .expect(404);
      await http()
        .delete(`/api/posts/${live.id}`)
        .set('Cookie', reader.cookie)
        .expect(403);
    });

    it('publishing a draft stamps publishedAt; null title is rejected', async () => {
      const draft = await createPost(author, { title: 'Later', body: 'b' });
      const res = await http()
        .patch(`/api/posts/${draft.id}`)
        .set('Cookie', author.cookie)
        .send({ status: 'PUBLISHED' })
        .expect(200);
      expect(res.body.publishedAt).not.toBeNull();
      await http()
        .patch(`/api/posts/${draft.id}`)
        .set('Cookie', author.cookie)
        .send({ title: null })
        .expect(400);
    });

    it('deleting a post removes its comments and likes', async () => {
      const post = await publish(author, 'To delete');
      await http()
        .post(`/api/posts/${post.id}/comments`)
        .set('Cookie', reader.cookie)
        .send({ body: 'bye' })
        .expect(201);
      await http()
        .post(`/api/posts/${post.id}/like`)
        .set('Cookie', reader.cookie)
        .expect(200);
      await http()
        .delete(`/api/posts/${post.id}`)
        .set('Cookie', author.cookie)
        .expect(204);
      await http().get(`/api/posts/${post.id}`).expect(404);
      const postId = new Types.ObjectId(post.id);
      expect(
        await connection.collection('comments').countDocuments({ postId }),
      ).toBe(0);
      expect(
        await connection.collection('likes').countDocuments({ postId }),
      ).toBe(0);
    });
  });

  describe('BLG-05 / BLG-07 comments', () => {
    it('comments are 1-500 characters, chronological, and counted on the post', async () => {
      const post = await publish(author, 'Discuss');
      for (const body of ['first', 'second']) {
        await http()
          .post(`/api/posts/${post.id}/comments`)
          .set('Cookie', reader.cookie)
          .send({ body })
          .expect(201);
      }
      await http()
        .post(`/api/posts/${post.id}/comments`)
        .set('Cookie', reader.cookie)
        .send({ body: '   ' })
        .expect(400);
      await http()
        .post(`/api/posts/${post.id}/comments`)
        .set('Cookie', reader.cookie)
        .send({ body: 'x'.repeat(501) })
        .expect(400);

      const list = await http()
        .get(`/api/posts/${post.id}/comments`)
        .expect(200);
      expect(
        (list.body.items as { body: string }[]).map((c) => c.body),
      ).toEqual(['first', 'second']);
      const view = await http().get(`/api/posts/${post.id}`).expect(200);
      expect(view.body.commentCount).toBe(2);
    });

    it('drafts take no comments (404)', async () => {
      const draft = await createPost(author, { title: 'Quiet', body: 'b' });
      await http()
        .post(`/api/posts/${draft.id}/comments`)
        .set('Cookie', reader.cookie)
        .send({ body: 'hello' })
        .expect(404);
    });

    it('only the comment author edits or deletes it; deleting lowers the count', async () => {
      const post = await publish(author, 'Edit comments');
      const comment = (
        await http()
          .post(`/api/posts/${post.id}/comments`)
          .set('Cookie', reader.cookie)
          .send({ body: 'orig' })
          .expect(201)
      ).body as { id: string };
      await http()
        .patch(`/api/comments/${comment.id}`)
        .set('Cookie', author.cookie)
        .send({ body: 'nope' })
        .expect(403);
      const edited = await http()
        .patch(`/api/comments/${comment.id}`)
        .set('Cookie', reader.cookie)
        .send({ body: 'edited' })
        .expect(200);
      expect(edited.body.body).toBe('edited');
      await http()
        .delete(`/api/comments/${comment.id}`)
        .set('Cookie', author.cookie)
        .expect(403);
      await http()
        .delete(`/api/comments/${comment.id}`)
        .set('Cookie', reader.cookie)
        .expect(204);
      const view = await http().get(`/api/posts/${post.id}`).expect(200);
      expect(view.body.commentCount).toBe(0);
    });
  });

  describe('BLG-06 likes', () => {
    it('a user likes a post once and can remove the like', async () => {
      const post = await publish(author, 'Likeable');
      const liked = await http()
        .post(`/api/posts/${post.id}/like`)
        .set('Cookie', reader.cookie)
        .expect(200);
      expect(liked.body).toEqual({
        postId: post.id,
        liked: true,
        likeCount: 1,
      });
      const again = await http()
        .post(`/api/posts/${post.id}/like`)
        .set('Cookie', reader.cookie)
        .expect(409);
      expect(again.body.code).toBe('ALREADY_LIKED');

      const unliked = await http()
        .delete(`/api/posts/${post.id}/like`)
        .set('Cookie', reader.cookie)
        .expect(200);
      expect(unliked.body.likeCount).toBe(0);
      await http()
        .delete(`/api/posts/${post.id}/like`)
        .set('Cookie', reader.cookie)
        .expect(404);
    });

    it('concurrent likes by the same user count once', async () => {
      const post = await publish(author, 'Race');
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          http()
            .post(`/api/posts/${post.id}/like`)
            .set('Cookie', reader.cookie),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const view = await http().get(`/api/posts/${post.id}`).expect(200);
      expect(view.body.likeCount).toBe(1);
    });
  });

  describe('BLG-09 search', () => {
    it('matches title, tag or author name and orders by likes + comments, newest first on a tie', async () => {
      const word = `kw${new Types.ObjectId().toHexString().slice(-8)}`;
      const quiet = await publish(author, `Quiet ${word}`);
      const popular = await publish(author, 'Popular', { tags: [word] });
      const newerTie = await publish(author, `Newer ${word}`);
      for (const who of [reader, author]) {
        await http()
          .post(`/api/posts/${popular.id}/like`)
          .set('Cookie', who.cookie)
          .expect(200);
      }
      await http()
        .post(`/api/posts/${quiet.id}/comments`)
        .set('Cookie', reader.cookie)
        .send({ body: 'nice' })
        .expect(201);
      await http()
        .post(`/api/posts/${newerTie.id}/like`)
        .set('Cookie', reader.cookie)
        .expect(200);

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

    it('finds posts by author name and returns an empty page when nothing matches', async () => {
      const named = await loginAs(app, Role.User);
      const unique = `Writer${new Types.ObjectId().toHexString().slice(-8)}`;
      await connection
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
  });

  describe('BLG-10 images', () => {
    it('the author uploads and removes images; others cannot', async () => {
      const post = await publish(author, 'Pictures');
      await http()
        .post(`/api/posts/${post.id}/images`)
        .set('Cookie', reader.cookie)
        .attach('images', png(2), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(403);
      const up = await http()
        .post(`/api/posts/${post.id}/images`)
        .set('Cookie', author.cookie)
        .attach('images', png(3), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(up.body.images).toHaveLength(1);
      const match = POST_IMAGE_URL.exec(up.body.images[0] as string);
      expect(match).not.toBeNull();

      await http()
        .post(`/api/posts/${post.id}/images`)
        .set('Cookie', author.cookie)
        .attach('images', Buffer.from('not an image'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(400);

      const removed = await http()
        .delete(`/api/posts/${post.id}/images/${match![1]}`)
        .set('Cookie', author.cookie)
        .expect(200);
      expect(removed.body.images).toEqual([]);
      await http()
        .delete(`/api/posts/${post.id}/images/${match![1]}`)
        .set('Cookie', author.cookie)
        .expect(404);
    });
  });

  describe('BLG-12 author page', () => {
    it('shows name, join date and only published posts', async () => {
      const writer = await loginAs(app, Role.User);
      await publish(writer, 'Public one');
      await createPost(writer, { title: 'Private draft', body: 'b' });
      const res = await http().get(`/api/authors/${writer.userId}`).expect(200);
      expect(res.body).toMatchObject({ id: writer.userId, name: 'E2E USER' });
      expect(res.body.joinedAt).toBeDefined();
      expect(res.body.posts.total).toBe(1);
      expect(res.body.posts.items[0].title).toBe('Public one');

      await http()
        .get(`/api/authors/${new Types.ObjectId().toHexString()}`)
        .expect(404);
    });
  });
});
