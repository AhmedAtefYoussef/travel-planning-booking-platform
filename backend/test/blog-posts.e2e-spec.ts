import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

/**
 * BLG-01 (and the TRVL-142 schemas): a registered user creates a post as a draft or published.
 * Tags are normalised on the way in (BLG-08 rule: at most 5, at most 30 characters, lowercased).
 */
describe('Blog posts (e2e): BLG-01', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let author: LoggedIn;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    connection = app.get<Connection>(getConnectionToken());
    author = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  it('BLG-01 saves a draft by default, with no publishedAt', async () => {
    const res = await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({ title: '  Draft  ', body: 'x' })
      .expect(201);
    expect(res.body).toMatchObject({
      title: 'Draft',
      status: 'DRAFT',
      publishedAt: null,
      likeCount: 0,
      commentCount: 0,
      author: { id: author.userId, name: 'E2E USER' },
    });
  });

  it('BLG-01 publishes on request and stamps publishedAt', async () => {
    const res = await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({ title: 'Live', body: 'Body', status: 'PUBLISHED' })
      .expect(201);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.publishedAt).not.toBeNull();
    const stored = await connection
      .collection('posts')
      .findOne({ _id: new Types.ObjectId(res.body.id as string) });
    expect(stored?.authorId.toHexString()).toBe(author.userId);
  });

  it('BLG-01 requires a title and body and rejects unknown fields (400 fieldErrors)', async () => {
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

  it('BLG-01 lowercases and de-duplicates tags; at most 5 of at most 30 characters', async () => {
    const ok = await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({ title: 't', body: 'b', tags: ['Egypt', ' egypt ', 'Nile'] })
      .expect(201);
    expect(ok.body.tags).toEqual(['egypt', 'nile']);
    await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({ title: 't', body: 'b', tags: ['a', 'b', 'c', 'd', 'e', 'f'] })
      .expect(400);
    await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({ title: 't', body: 'b', tags: ['x'.repeat(31)] })
      .expect(400);
  });

  it('BLG-01 accepts image URLs and rejects anything else', async () => {
    await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({
        title: 't',
        body: 'b',
        images: ['https://cdn.example.com/a.jpg'],
      })
      .expect(201);
    await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({ title: 't', body: 'b', images: ['not-a-url'] })
      .expect(400);
  });

  it('BLG-01 guests cannot create posts (401) and other roles get 403', async () => {
    await http().post('/api/posts').send({ title: 't', body: 'b' }).expect(401);
    const admin = await loginAs(app, Role.Admin);
    await http()
      .post('/api/posts')
      .set('Cookie', admin.cookie)
      .send({ title: 't', body: 'b' })
      .expect(403);
  });

  it('TRVL-142 a user can like a post only once (unique {postId, userId})', async () => {
    const likes = connection.collection('likes');
    const like = {
      postId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
    };
    await likes.insertOne({ ...like });
    await expect(likes.insertOne({ ...like })).rejects.toMatchObject({
      code: 11000,
    });
  });
});
