import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';
import { TestContent, TestContentModule } from './support/test-content.module';

/** The parts of a 404 body that must not reveal why (unknown item, unregistered type, hidden). */
const notFoundShape = (body: Record<string, unknown>) => ({
  statusCode: body.statusCode,
  error: body.error,
  code: body.code,
  message: body.message,
  fieldErrors: body.fieldErrors,
});

/**
 * GEN-09 (users report content) and GEN-10 (admins resolve reports, hide or delete content), with
 * GEN-07 audit entries. Posts and comments are stood in for by TestContentModule, which registers
 * adapters through the real content-moderation port; REVIEW and ITINERARY stay unregistered.
 */
describe('Content reports and moderation (e2e): GEN-09, GEN-10', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let items: Model<TestContent>;
  let admin: LoggedIn;

  const newContent = async (
    kind: 'POST' | 'COMMENT',
    authorId: string,
    hidden = false,
  ) => {
    const doc = await items.create({
      kind,
      authorId: new Types.ObjectId(authorId),
      hidden,
    });
    return doc._id.toHexString();
  };
  const report = (who: LoggedIn | null, body: Record<string, unknown>) => {
    const req = http().post('/api/reports');
    if (who) req.set('Cookie', who.cookie);
    return req.send(body);
  };

  beforeAll(async () => {
    app = await createTestApp([TestContentModule]);
    items = app.get(getModelToken(TestContent.name));
    admin = await loginAs(app, Role.Admin);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/reports (GEN-09)', () => {
    let author: LoggedIn;
    let reporter: LoggedIn;

    beforeAll(async () => {
      author = await loginAs(app, Role.User);
      reporter = await loginAs(app, Role.User);
    });

    it('is for registered users: 401 for a guest, 403 for an admin or moderator', async () => {
      const targetId = await newContent('POST', author.userId);
      const body = { targetType: 'POST', targetId, reason: 'Spam' };
      expect((await report(null, body).expect(401)).body.code).toBe(
        'UNAUTHENTICATED',
      );
      const moderator = await loginAs(app, Role.HotelModerator);
      for (const who of [admin, moderator]) {
        expect((await report(who, body).expect(403)).body.code).toBe(
          'FORBIDDEN',
        );
      }
    });

    it('reports a post with a trimmed reason: 201 with an OPEN report', async () => {
      const targetId = await newContent('POST', author.userId);
      const res = await report(reporter, {
        targetType: 'POST',
        targetId,
        reason: '  Offensive language  ',
      }).expect(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        reporterId: reporter.userId,
        targetType: 'POST',
        targetId,
        reason: 'Offensive language',
        status: 'OPEN',
        resolution: null,
        createdAt: expect.any(String),
      });
    });

    it('allows one report per user per item: a second is 409, others may still report it', async () => {
      const targetId = await newContent('COMMENT', author.userId);
      const body = { targetType: 'COMMENT', targetId, reason: 'Harassment' };
      await report(reporter, body).expect(201);
      const dup = await report(reporter, {
        ...body,
        reason: 'Another reason',
      }).expect(409);
      expect(dup.body).toMatchObject({
        code: 'DUPLICATE_KEY',
        message: 'You have already reported this item',
      });
      const other = await loginAs(app, Role.User);
      await report(other, body).expect(201);
    });

    it('answers 400 with field errors for a bad type, id or reason', async () => {
      const targetId = await newContent('POST', author.userId);
      const fields = async (body: Record<string, unknown>) =>
        (
          (await report(reporter, body).expect(400)).body.fieldErrors as {
            field: string;
          }[]
        ).map((f) => f.field);

      expect(
        await fields({ targetType: 'BLOG', targetId, reason: 'x' }),
      ).toEqual(['targetType']);
      expect(
        await fields({ targetType: 'POST', targetId: 'nope', reason: 'x' }),
      ).toEqual(['targetId']);
      expect(
        await fields({ targetType: 'POST', targetId, reason: '   ' }),
      ).toEqual(['reason']);
      expect(
        await fields({ targetType: 'POST', targetId, reason: 'a'.repeat(501) }),
      ).toEqual(['reason']);
      expect(await fields({})).toEqual(
        expect.arrayContaining(['targetType', 'targetId', 'reason']),
      );
      // 500 characters is the limit, inclusive.
      await report(reporter, {
        targetType: 'POST',
        targetId,
        reason: 'a'.repeat(500),
      }).expect(201);
    });

    it('answers one identical 404 for an unknown item, an unregistered type and another user’s hidden item', async () => {
      const hiddenId = await newContent('POST', author.userId, true);
      const bodies = await Promise.all(
        [
          { targetType: 'POST', targetId: new Types.ObjectId().toHexString() },
          // A comment id reported as a post does not exist as a post.
          {
            targetType: 'POST',
            targetId: await newContent('COMMENT', author.userId),
          },
          {
            targetType: 'REVIEW',
            targetId: new Types.ObjectId().toHexString(),
          },
          { targetType: 'ITINERARY', targetId: hiddenId },
          { targetType: 'POST', targetId: hiddenId },
        ].map(
          async (target) =>
            (await report(reporter, { ...target, reason: 'Spam' }).expect(404))
              .body as Record<string, unknown>,
        ),
      );
      expect(bodies[0].code).toBe('NOT_FOUND');
      for (const body of bodies) {
        expect(notFoundShape(body)).toEqual(notFoundShape(bodies[0]));
      }
    });

    it('lets authors report their own content, hidden or not', async () => {
      for (const hidden of [false, true]) {
        const targetId = await newContent('POST', author.userId, hidden);
        await report(author, {
          targetType: 'POST',
          targetId,
          reason: 'Posted by mistake',
        }).expect(201);
      }
    });
  });
});

describe('Content reports with no content module registered (e2e): GEN-09', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 404 for every content type until its module registers an adapter', async () => {
    const user = await loginAs(app, Role.User);
    for (const targetType of ['POST', 'COMMENT', 'REVIEW', 'ITINERARY']) {
      const res = await request(app.getHttpServer())
        .post('/api/reports')
        .set('Cookie', user.cookie)
        .send({
          targetType,
          targetId: new Types.ObjectId().toHexString(),
          reason: 'Spam',
        })
        .expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });
});
