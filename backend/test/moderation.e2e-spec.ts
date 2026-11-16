import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { Report } from '../src/modules/moderation';
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
  let reports: Model<Report>;
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
    reports = app.get(getModelToken(Report.name));
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
  describe('Admin moderation (GEN-10)', () => {
    let author: LoggedIn;
    const reporters: LoggedIn[] = [];

    const asAdmin = (req: request.Test, who: LoggedIn | null = admin) =>
      who ? req.set('Cookie', who.cookie) : req;
    const resolve = (
      id: string,
      action: unknown,
      who: LoggedIn | null = admin,
    ) =>
      asAdmin(http().patch(`/api/admin/reports/${id}`), who).send({ action });
    const hide = (type: string, id: string, who: LoggedIn | null = admin) =>
      asAdmin(http().patch(`/api/admin/content/${type}/${id}/hide`), who);
    const remove = (type: string, id: string, who: LoggedIn | null = admin) =>
      asAdmin(http().delete(`/api/admin/content/${type}/${id}`), who);
    const list = (query: Record<string, unknown> = {}) =>
      asAdmin(http().get('/api/admin/reports').query(query));
    /** Reports `targetId` once by each of the first `n` reporters; returns the report ids. */
    const reportedBy = async (
      n: number,
      targetType: 'POST' | 'COMMENT',
      targetId: string,
    ) => {
      const ids: string[] = [];
      for (const who of reporters.slice(0, n)) {
        const res = await report(who, {
          targetType,
          targetId,
          reason: 'Inappropriate',
        }).expect(201);
        ids.push(res.body.id as string);
      }
      return ids;
    };
    const statusOf = async (id: string) =>
      (await reports.findById(id).lean())!.status;
    const auditFor = async (action: string, targetId: string) => {
      const res = await http()
        .get('/api/admin/audit-logs')
        .query({ action })
        .set('Cookie', admin.cookie)
        .expect(200);
      return (
        res.body.items as {
          targetId: string;
          targetType: string;
          actor: { id: string };
          metadata?: Record<string, unknown>;
        }[]
      ).filter((e) => e.targetId === targetId);
    };

    beforeAll(async () => {
      author = await loginAs(app, Role.User);
      for (let i = 0; i < 3; i++) reporters.push(await loginAs(app, Role.User));
    });

    it('is admin-only: 401 for a guest, 403 for a user or moderator', async () => {
      const targetId = await newContent('POST', author.userId);
      const [reportId] = await reportedBy(1, 'POST', targetId);
      const moderator = await loginAs(app, Role.AirlineModerator);
      const calls = (who: LoggedIn | null) => [
        asAdmin(http().get('/api/admin/reports'), who),
        resolve(reportId, 'DISMISS', who),
        hide('post', targetId, who),
        remove('post', targetId, who),
      ];
      for (const call of calls(null)) {
        expect((await call.expect(401)).body.code).toBe('UNAUTHENTICATED');
      }
      for (const who of [author, moderator]) {
        for (const call of calls(who)) {
          expect((await call.expect(403)).body.code).toBe('FORBIDDEN');
        }
      }
      expect(await statusOf(reportId)).toBe('OPEN');
      expect((await items.findById(targetId).lean())!.hidden).toBe(false);
    });

    it('lists open reports newest first, 10 per page, filtered by type', async () => {
      await reports.deleteMany({});
      const posts: string[] = [];
      for (let i = 0; i < 11; i++) {
        const targetId = await newContent('POST', author.userId);
        posts.push((await reportedBy(1, 'POST', targetId))[0]);
      }
      const comment = (
        await reportedBy(
          1,
          'COMMENT',
          await newContent('COMMENT', author.userId),
        )
      )[0];
      const dismissed = (
        await reportedBy(1, 'POST', await newContent('POST', author.userId))
      )[0];
      await resolve(dismissed, 'DISMISS').expect(200);

      const first = await list().expect(200);
      expect(first.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      const ids = (first.body.items as { id: string }[]).map((r) => r.id);
      expect(ids).toEqual([comment, ...posts.slice(2).reverse()]);
      expect(first.body.items[0]).toMatchObject({
        targetType: 'COMMENT',
        status: 'OPEN',
        resolution: null,
      });
      const second = await list({ page: 2 }).expect(200);
      expect((second.body.items as { id: string }[]).map((r) => r.id)).toEqual([
        posts[1],
        posts[0],
      ]);

      const comments = await list({ targetType: 'comment' }).expect(200);
      expect(comments.body.total).toBe(1);
      expect(comments.body.items[0].id).toBe(comment);

      const bad = await list({ targetType: 'BLOG' }).expect(400);
      expect(bad.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'targetType' }),
      ]);
      await list({ limit: 50 }).expect(400);
    });

    it('validates the report id and action, and answers 404 for an unknown report', async () => {
      const targetId = await newContent('POST', author.userId);
      const [reportId] = await reportedBy(1, 'POST', targetId);
      expect(
        (await resolve('not-an-id', 'DISMISS').expect(400)).body.fieldErrors,
      ).toEqual([expect.objectContaining({ field: 'id' })]);
      expect(
        (await resolve(reportId, 'BAN').expect(400)).body.fieldErrors,
      ).toEqual([expect.objectContaining({ field: 'action' })]);
      await resolve(reportId, undefined).expect(400);
      const unknown = await resolve(
        new Types.ObjectId().toHexString(),
        'DISMISS',
      ).expect(404);
      expect(unknown.body).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Report not found',
      });
    });

    it('DISMISS closes only that report and leaves the content alone', async () => {
      const targetId = await newContent('POST', author.userId);
      const [first, second] = await reportedBy(2, 'POST', targetId);
      const res = await resolve(first, 'dismiss').expect(200);
      expect(res.body).toMatchObject({
        id: first,
        status: 'DISMISSED',
        resolution: {
          action: 'DISMISS',
          adminId: admin.userId,
          at: expect.any(String),
        },
      });
      expect(await statusOf(second)).toBe('OPEN');
      expect((await items.findById(targetId).lean())!.hidden).toBe(false);

      expect((await resolve(first, 'HIDE').expect(409)).body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        message: 'This report is already resolved',
      });
      expect(await auditFor('RESOLVE_REPORT', first)).toEqual([
        expect.objectContaining({
          targetType: 'REPORT',
          actor: expect.objectContaining({ id: admin.userId }),
          metadata: { action: 'DISMISS' },
        }),
      ]);
      expect(await auditFor('HIDE_CONTENT', targetId)).toHaveLength(0);
    });

    it('HIDE hides the content and closes every open report on it, audited', async () => {
      const targetId = await newContent('POST', author.userId);
      const [first, second, third] = await reportedBy(3, 'POST', targetId);
      await resolve(third, 'DISMISS').expect(200);

      const res = await resolve(first, 'HIDE').expect(200);
      expect(res.body).toMatchObject({
        id: first,
        status: 'ACTIONED',
        resolution: { action: 'HIDE', adminId: admin.userId },
      });
      expect((await items.findById(targetId).lean())!.hidden).toBe(true);
      expect(await statusOf(second)).toBe('ACTIONED');
      expect(await statusOf(third)).toBe('DISMISSED');
      expect((await resolve(second, 'DISMISS').expect(409)).body.code).toBe(
        'INVALID_STATE_TRANSITION',
      );

      expect(await auditFor('RESOLVE_REPORT', first)).toEqual([
        expect.objectContaining({ metadata: { action: 'HIDE' } }),
      ]);
      expect(await auditFor('HIDE_CONTENT', targetId)).toEqual([
        expect.objectContaining({
          targetType: 'POST',
          actor: expect.objectContaining({ id: admin.userId }),
          metadata: {
            contentType: 'POST',
            ownerId: author.userId,
            reportId: first,
          },
        }),
      ]);
      // Hidden from everyone but its author and admins: another user can no longer report it.
      const late = await loginAs(app, Role.User);
      await report(late, {
        targetType: 'POST',
        targetId,
        reason: 'Spam',
      }).expect(404);
    });

    it('DELETE deletes the content and closes every open report on it, audited', async () => {
      const targetId = await newContent('COMMENT', author.userId);
      const [first, second] = await reportedBy(2, 'COMMENT', targetId);
      const res = await resolve(first, 'DELETE').expect(200);
      expect(res.body).toMatchObject({
        status: 'ACTIONED',
        resolution: { action: 'DELETE' },
      });
      expect(await items.findById(targetId).lean()).toBeNull();
      expect(await statusOf(second)).toBe('ACTIONED');
      expect(await auditFor('DELETE_CONTENT', targetId)).toEqual([
        expect.objectContaining({
          targetType: 'COMMENT',
          metadata: {
            contentType: 'COMMENT',
            ownerId: author.userId,
            reportId: first,
          },
        }),
      ]);
      expect(await auditFor('RESOLVE_REPORT', first)).toEqual([
        expect.objectContaining({ metadata: { action: 'DELETE' } }),
      ]);
    });

    it('HIDE and DELETE are 409 when the content is gone; DISMISS still works', async () => {
      const targetId = await newContent('POST', author.userId);
      const [reportId] = await reportedBy(1, 'POST', targetId);
      await items.deleteOne({ _id: targetId });
      for (const action of ['HIDE', 'DELETE']) {
        expect(
          (await resolve(reportId, action).expect(409)).body,
        ).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          message:
            'The reported content no longer exists; dismiss the report instead',
        });
      }
      // The failed attempts rolled back: the report is still OPEN and nothing was audited.
      expect(await statusOf(reportId)).toBe('OPEN');
      expect(await auditFor('RESOLVE_REPORT', reportId)).toHaveLength(0);
      await resolve(reportId, 'DISMISS').expect(200);
    });

    it('lets only one of two simultaneous resolutions win', async () => {
      const targetId = await newContent('POST', author.userId);
      const [reportId] = await reportedBy(1, 'POST', targetId);
      const other = await loginAs(app, Role.Admin);
      const results = await Promise.all([
        resolve(reportId, 'HIDE'),
        resolve(reportId, 'DISMISS', other),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await auditFor('RESOLVE_REPORT', reportId)).toHaveLength(1);
    });

    it('hides content directly: closes its open reports, 409 when already hidden', async () => {
      const targetId = await newContent('POST', author.userId);
      const reportIds = await reportedBy(2, 'POST', targetId);

      const res = await hide('Post', targetId).expect(200);
      expect(res.body).toEqual({
        contentType: 'POST',
        contentId: targetId,
        action: 'HIDE',
        resolvedReports: 2,
      });
      expect((await items.findById(targetId).lean())!.hidden).toBe(true);
      for (const id of reportIds) expect(await statusOf(id)).toBe('ACTIONED');
      expect(
        (await reports.findById(reportIds[0]).lean())!.resolution,
      ).toMatchObject({ action: 'HIDE' });

      expect((await hide('post', targetId).expect(409)).body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        message: 'This content is already hidden',
      });
      expect(await auditFor('HIDE_CONTENT', targetId)).toEqual([
        expect.objectContaining({
          targetType: 'POST',
          metadata: { contentType: 'POST', ownerId: author.userId },
        }),
      ]);
    });

    it('deletes content directly and closes its open reports', async () => {
      const targetId = await newContent('COMMENT', author.userId);
      const [reportId] = await reportedBy(1, 'COMMENT', targetId);
      const res = await remove('comment', targetId).expect(200);
      expect(res.body).toEqual({
        contentType: 'COMMENT',
        contentId: targetId,
        action: 'DELETE',
        resolvedReports: 1,
      });
      expect(await items.findById(targetId).lean()).toBeNull();
      expect(await statusOf(reportId)).toBe('ACTIONED');
      expect((await remove('comment', targetId).expect(404)).body.code).toBe(
        'NOT_FOUND',
      );
      expect(await auditFor('DELETE_CONTENT', targetId)).toEqual([
        expect.objectContaining({
          targetType: 'COMMENT',
          metadata: { contentType: 'COMMENT', ownerId: author.userId },
        }),
      ]);
    });

    it('validates :type and :id, and answers 404 for an unregistered type or unknown item', async () => {
      const postId = await newContent('POST', author.userId);
      for (const call of [hide, remove]) {
        expect(
          (await call('blog', postId).expect(400)).body.fieldErrors,
        ).toEqual([expect.objectContaining({ field: 'type' })]);
        expect(
          (await call('post', 'not-an-id').expect(400)).body.fieldErrors,
        ).toEqual([expect.objectContaining({ field: 'id' })]);
        for (const [type, id] of [
          ['review', postId],
          ['itinerary', postId],
          ['post', new Types.ObjectId().toHexString()],
          ['comment', postId],
        ]) {
          expect((await call(type, id).expect(404)).body).toMatchObject({
            code: 'NOT_FOUND',
            message: 'Content not found',
          });
        }
      }
      expect((await items.findById(postId).lean())!.hidden).toBe(false);
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
