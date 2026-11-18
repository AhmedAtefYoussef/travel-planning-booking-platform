import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  CONTENT_MODERATION,
  ModeratableContentType,
  type AuditEntry,
  type AuditService,
  type ContentModeration,
  type ModeratableContentAdapter,
} from '../src/common/contracts';
import { Report } from '../src/modules/moderation';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';
import {
  FakeContentStore,
  TestContentModule,
} from './support/test-content.module';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const TYPES = Object.values(ModeratableContentType);
type Action = 'DISMISS' | 'HIDE' | 'DELETE';

/**
 * GEN-10 (TRVL-105): admins resolve reports and hide or delete community content directly; GEN-07: every
 * moderation action is audited. Posts and itineraries go through their real adapters, comments and
 * reviews through the test adapters of the CONTENT_MODERATION port.
 */
describe('Admin moderation (e2e): GEN-10 resolve reports, hide and delete content', () => {
  let app: INestApplication<App>;
  let fakes: FakeContentStore;
  let registry: ContentModeration;
  let reports: Model<Report>;
  let connection: Connection;
  let admin: LoggedIn;
  let alice: LoggedIn;
  let bob: LoggedIn;
  const http = () => request(app.getHttpServer());
  const as = (req: request.Test, who: LoggedIn | null) =>
    who ? req.set('Cookie', who.cookie) : req;
  const adapterOf = (type: ModeratableContentType) =>
    registry.get(type) as ModeratableContentAdapter;
  const find = (type: ModeratableContentType, id: string) =>
    adapterOf(type).find(id);
  const auditOf = (filter: Record<string, unknown>) =>
    connection.collection('audit_logs').find(filter).toArray();

  /** An item of `type` by `author`: the real post / itinerary routes, or the fake store. */
  const content = async (
    type: ModeratableContentType,
    author: LoggedIn,
  ): Promise<string> => {
    if (type === ModeratableContentType.Post) {
      const res = await as(http().post('/api/posts'), author)
        .send({ title: 'Cairo', body: 'Markets', status: 'PUBLISHED' })
        .expect(201);
      return res.body.id as string;
    }
    if (type === ModeratableContentType.Itinerary) {
      const res = await as(http().post('/api/itineraries'), author)
        .send({
          title: 'Egypt',
          countries: ['EG'],
          startDate: '2027-03-01',
          visibility: 'PUBLIC',
        })
        .expect(201);
      return res.body.id as string;
    }
    return fakes.add(type, { authorId: author.userId });
  };

  const fileReport = async (
    who: LoggedIn,
    targetType: ModeratableContentType,
    targetId: string,
  ): Promise<string> => {
    const res = await as(http().post('/api/reports'), who)
      .send({ targetType, targetId, reason: 'Spam' })
      .expect(201);
    return res.body.id as string;
  };

  const resolve = (who: LoggedIn | null, id: string, body: object) =>
    as(http().patch(`/api/admin/reports/${id}`), who).send(body);
  const statusOf = async (id: string) =>
    (await reports.findById(id).lean().exec())?.status;

  beforeAll(async () => {
    app = await createTestApp([TestContentModule]);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    fakes = app.get(FakeContentStore);
    registry = app.get(CONTENT_MODERATION);
    reports = app.get<Model<Report>>(getModelToken(Report.name));
    connection = app.get<Connection>(getConnectionToken());
    await reports.syncIndexes();
    admin = await loginAs(app, Role.Admin);
    alice = await loginAs(app, Role.User);
    bob = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GEN-10 admins only', () => {
    const id = new Types.ObjectId().toHexString();
    const routes = (who: LoggedIn | null) => [
      as(http().get('/api/admin/reports'), who),
      as(http().patch(`/api/admin/reports/${id}`), who).send({
        action: 'DISMISS',
      }),
      as(http().patch(`/api/admin/content/post/${id}/hide`), who),
      as(http().delete(`/api/admin/content/post/${id}`), who),
    ];

    it('GEN-10 answers 401 without a session', async () => {
      for (const r of routes(null)) await r.expect(401);
    });

    it.each([Role.User, Role.AirlineModerator, Role.HotelModerator])(
      'GEN-10 answers 403 to %s',
      async (role) => {
        const who = await loginAs(app, role);
        for (const r of routes(who)) await r.expect(403);
      },
    );
  });

  describe('GEN-10 the report queue', () => {
    it('GEN-10 lists OPEN reports by default, newest first, 10 per page, with filters', async () => {
      await reports.deleteMany({});
      const ids: string[] = [];
      for (let i = 0; i < 11; i++) {
        const c = fakes.add(ModeratableContentType.Review);
        ids.push(await fileReport(alice, ModeratableContentType.Review, c));
      }
      const comment = fakes.add(ModeratableContentType.Comment);
      const commentReport = await fileReport(
        bob,
        ModeratableContentType.Comment,
        comment,
      );
      await resolve(admin, ids[0], { action: 'DISMISS' }).expect(200);

      const list = (q: string) =>
        as(http().get(`/api/admin/reports?${q}`), admin).expect(200);
      const first = await list('');
      expect(first.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 11,
        totalPages: 2,
      });
      expect(first.body.items).toHaveLength(10);
      expect(first.body.items[0]).toEqual({
        id: commentReport,
        targetType: 'COMMENT',
        targetId: comment,
        reason: 'Spam',
        status: 'OPEN',
        reporterId: bob.userId,
        createdAt: expect.any(String),
        resolvedBy: null,
        resolvedAt: null,
      });
      const second = await list('page=2');
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].id).toBe(ids[1]);

      const reviews = await list('targetType=REVIEW');
      expect(reviews.body.total).toBe(10);
      const dismissed = await list('status=DISMISSED');
      expect(dismissed.body.items).toEqual([
        expect.objectContaining({
          id: ids[0],
          status: 'DISMISSED',
          resolvedBy: admin.userId,
          resolvedAt: expect.any(String),
        }),
      ]);
    });

    it.each(['status=CLOSED', 'targetType=HOTEL', 'limit=50'])(
      'GEN-10 rejects %s with 400',
      async (q) => {
        await as(http().get(`/api/admin/reports?${q}`), admin).expect(400);
      },
    );
  });

  describe('GEN-10 resolving a report', () => {
    const cases = TYPES.flatMap((type) =>
      (['DISMISS', 'HIDE', 'DELETE'] as Action[]).map(
        (action) => [type, action] as const,
      ),
    );

    it.each(cases)(
      'GEN-10 resolves a report of a %s with %s',
      async (type, action) => {
        const id = await content(type, bob);
        const reportId = await fileReport(alice, type, id);
        const res = await resolve(admin, reportId, {
          action,
          note: 'Reviewed',
        }).expect(200);
        const status = {
          DISMISS: 'DISMISSED',
          HIDE: 'HIDDEN',
          DELETE: 'DELETED',
        }[action];
        expect(res.body).toMatchObject({
          id: reportId,
          status,
          resolvedBy: admin.userId,
          resolutionNote: 'Reviewed',
          otherReportsResolved: 0,
        });
        const after = await find(type, id);
        if (action === 'DELETE') expect(after).toBeNull();
        else expect(after?.isHidden).toBe(action === 'HIDE');
        // Reports of deleted content stay for the audit trail.
        expect(await statusOf(reportId)).toBe(status);
      },
    );

    it('GEN-10 a resolved report cannot be resolved again (409)', async () => {
      const id = fakes.add(ModeratableContentType.Comment);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Comment,
        id,
      );
      await resolve(admin, reportId, { action: 'DISMISS' }).expect(200);
      const again = await resolve(admin, reportId, { action: 'HIDE' }).expect(
        409,
      );
      expect(again.body.code).toBe('REPORT_ALREADY_RESOLVED');
      expect((await find(ModeratableContentType.Comment, id))?.isHidden).toBe(
        false,
      );
    });

    it('GEN-10 HIDE also closes every other OPEN report of the item as HIDDEN', async () => {
      const id = await content(ModeratableContentType.Itinerary, bob);
      const carol = await loginAs(app, Role.User);
      const r1 = await fileReport(alice, ModeratableContentType.Itinerary, id);
      const r2 = await fileReport(carol, ModeratableContentType.Itinerary, id);
      const r3 = await fileReport(bob, ModeratableContentType.Itinerary, id);
      const unrelated = await fileReport(
        alice,
        ModeratableContentType.Comment,
        fakes.add(ModeratableContentType.Comment),
      );
      const res = await resolve(admin, r1, { action: 'HIDE' }).expect(200);
      expect(res.body.otherReportsResolved).toBe(2);
      for (const r of [r2, r3]) {
        const doc = await reports.findById(r).lean().exec();
        expect(doc).toMatchObject({ status: 'HIDDEN' });
        expect(doc?.resolvedBy?.toHexString()).toBe(admin.userId);
      }
      expect(await statusOf(unrelated)).toBe('OPEN');
    });

    it('GEN-10 HIDE content that is already hidden still resolves the report', async () => {
      const id = fakes.add(ModeratableContentType.Review);
      const r1 = await fileReport(alice, ModeratableContentType.Review, id);
      const r2 = await fileReport(bob, ModeratableContentType.Review, id);
      await resolve(admin, r1, { action: 'HIDE' }).expect(200);
      // r2 was closed with r1; a fresh report from the author (who still sees it) is resolved again.
      expect(await statusOf(r2)).toBe('HIDDEN');
      const author = (await find(ModeratableContentType.Review, id))!.authorId;
      const r3 = (
        await reports.create({
          reporterId: new Types.ObjectId(author),
          targetType: ModeratableContentType.Review,
          targetId: new Types.ObjectId(id),
          reason: 'Again',
        })
      )._id.toHexString();
      await resolve(admin, r3, { action: 'HIDE' }).expect(200);
      expect(
        await auditOf({
          action: 'HIDE_CONTENT',
          targetId: new Types.ObjectId(id),
        }),
      ).toHaveLength(1);
    });

    it('GEN-10 HIDE or DELETE of vanished content is 404, DISMISS still works', async () => {
      const id = fakes.add(ModeratableContentType.Comment);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Comment,
        id,
      );
      await adapterOf(ModeratableContentType.Comment).remove(id, null as never);
      await resolve(admin, reportId, { action: 'HIDE' }).expect(404);
      await resolve(admin, reportId, { action: 'DELETE' }).expect(404);
      expect(await statusOf(reportId)).toBe('OPEN');
      await resolve(admin, reportId, { action: 'DISMISS' }).expect(200);
    });

    it('GEN-10 rejects an unknown report (404), a malformed id or a bad body (400)', async () => {
      await resolve(admin, new Types.ObjectId().toHexString(), {
        action: 'DISMISS',
      }).expect(404);
      await resolve(admin, 'nope', { action: 'DISMISS' }).expect(400);
      const id = new Types.ObjectId().toHexString();
      for (const body of [
        { action: 'BAN' },
        { action: 'HIDE', note: 'a'.repeat(501) },
        {},
      ]) {
        await resolve(admin, id, body).expect(400);
      }
    });

    it('GEN-10 four admins resolving one report at once: one 200, three 409, one audit entry', async () => {
      const id = fakes.add(ModeratableContentType.Comment);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Comment,
        id,
      );
      const admins = await Promise.all(
        [1, 2, 3, 4].map(() => loginAs(app, Role.Admin)),
      );
      const results = await Promise.all(
        admins.map((a) => resolve(a, reportId, { action: 'DISMISS' })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
      expect(
        await auditOf({
          action: 'RESOLVE_REPORT',
          targetId: new Types.ObjectId(reportId),
        }),
      ).toHaveLength(1);
    });
  });

  describe('GEN-10 one transaction: all or nothing', () => {
    it('GEN-10 rolls back when the adapter fails to delete: report OPEN, content kept, no audit', async () => {
      const id = await content(ModeratableContentType.Itinerary, bob);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Itinerary,
        id,
      );
      jest
        .spyOn(adapterOf(ModeratableContentType.Itinerary), 'remove')
        .mockRejectedValueOnce(new Error('boom'));
      await resolve(admin, reportId, { action: 'DELETE' }).expect(500);
      expect(await statusOf(reportId)).toBe('OPEN');
      expect(await find(ModeratableContentType.Itinerary, id)).not.toBeNull();
      expect(
        await auditOf({
          targetId: {
            $in: [new Types.ObjectId(id), new Types.ObjectId(reportId)],
          },
        }),
      ).toHaveLength(0);
    });

    it('GEN-10 rolls back when the audit write fails: report OPEN, content not hidden', async () => {
      const id = await content(ModeratableContentType.Itinerary, bob);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Itinerary,
        id,
      );
      const audit = app.get<AuditService>(AUDIT_SERVICE);
      const original = audit.record.bind(audit);
      jest
        .spyOn(audit, 'record')
        .mockImplementation((entry: AuditEntry, session) =>
          entry.action === AuditAction.ResolveReport
            ? Promise.reject(new Error('audit down'))
            : original(entry, session),
        );
      await resolve(admin, reportId, { action: 'HIDE' }).expect(500);
      expect(await statusOf(reportId)).toBe('OPEN');
      expect((await find(ModeratableContentType.Itinerary, id))?.isHidden).toBe(
        false,
      );
      expect(
        await auditOf({
          targetId: {
            $in: [new Types.ObjectId(id), new Types.ObjectId(reportId)],
          },
        }),
      ).toHaveLength(0);
    });

    it('GEN-10 cleanup runs after the commit and its failure does not fail the request', async () => {
      const id = await content(ModeratableContentType.Itinerary, bob);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Itinerary,
        id,
      );
      const adapter = adapterOf(ModeratableContentType.Itinerary);
      const realRemove = adapter.remove.bind(adapter);
      let seenStatus: string | undefined;
      jest.spyOn(adapter, 'remove').mockImplementation(async (rid, session) => {
        await realRemove(rid, session);
        return {
          afterCommit: async () => {
            seenStatus = await statusOf(reportId);
            throw new Error('file system unavailable');
          },
        };
      });
      await resolve(admin, reportId, { action: 'DELETE' }).expect(200);
      expect(seenStatus).toBe('DELETED');
      expect(await find(ModeratableContentType.Itinerary, id)).toBeNull();
    });
  });

  describe('GEN-10 direct hide and delete', () => {
    const hide = (type: string, id: string) =>
      as(http().patch(`/api/admin/content/${type}/${id}/hide`), admin);
    const del = (type: string, id: string) =>
      as(http().delete(`/api/admin/content/${type}/${id}`), admin);

    it.each(TYPES)('GEN-10 hides and then deletes a %s', async (type) => {
      const id = await content(type, bob);
      const reportId = await fileReport(alice, type, id);
      const seg = type.toLowerCase();
      const hidden = await hide(seg, id).expect(200);
      expect(hidden.body).toEqual({
        targetType: type,
        targetId: id,
        outcome: 'HIDDEN',
        reportsResolved: 1,
      });
      expect(await statusOf(reportId)).toBe('HIDDEN');
      expect((await find(type, id))?.isHidden).toBe(true);
      const again = await hide(seg, id).expect(409);
      expect(again.body.code).toBe('CONTENT_ALREADY_HIDDEN');
      const deleted = await del(seg, id).expect(200);
      expect(deleted.body).toMatchObject({
        outcome: 'DELETED',
        reportsResolved: 0,
      });
      expect(await find(type, id)).toBeNull();
      await del(seg, id).expect(404);
      await hide(seg, id).expect(404);
    });

    it('GEN-10 a direct delete closes open reports as DELETED', async () => {
      const id = fakes.add(ModeratableContentType.Review);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Review,
        id,
      );
      const res = await del('review', id).expect(200);
      expect(res.body.reportsResolved).toBe(1);
      expect(await statusOf(reportId)).toBe('DELETED');
    });

    it.each(['hotel', 'POST', 'posts'])(
      'GEN-10 rejects the content type %s with 400',
      async (seg) => {
        const id = new Types.ObjectId().toHexString();
        const res = await hide(seg, id).expect(400);
        expect(res.body.fieldErrors[0].field).toBe('type');
        await del(seg, id).expect(400);
      },
    );
  });

  describe('GEN-10 hidden content is visible only to its author and admins', () => {
    it('GEN-10 a hidden itinerary leaves the public author page but its owner still opens it', async () => {
      const owner = await loginAs(app, Role.User);
      const id = await content(ModeratableContentType.Itinerary, owner);
      const page = () => http().get(`/api/authors/${owner.userId}`).expect(200);
      expect((await page()).body.itineraries.total).toBe(1);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Itinerary,
        id,
      );
      await resolve(admin, reportId, { action: 'HIDE' }).expect(200);

      expect((await page()).body.itineraries.total).toBe(0);
      await as(http().get(`/api/itineraries/${id}`), owner).expect(200);
      await as(http().post('/api/reports'), bob)
        .send({ targetType: 'ITINERARY', targetId: id, reason: 'Spam' })
        .expect(404);
    });

    it('GEN-10 a hidden post cannot be reported by a stranger, its author still fetches it', async () => {
      const id = await content(ModeratableContentType.Post, bob);
      await as(
        http().patch(`/api/admin/content/post/${id}/hide`),
        admin,
      ).expect(200);
      await as(http().post('/api/reports'), alice)
        .send({ targetType: 'POST', targetId: id, reason: 'Spam' })
        .expect(404);
      const mine = await as(http().get(`/api/posts/mine/${id}`), bob).expect(
        200,
      );
      expect(mine.body.isHidden).toBe(true);
      await as(http().get(`/api/posts/mine/${id}`), alice).expect(404);
    });
  });

  describe('GEN-07 moderation actions in the audit log', () => {
    it('GEN-07 GEN-10 RESOLVE_REPORT, HIDE_CONTENT and DELETE_CONTENT are listed and filterable', async () => {
      const mod = await loginAs(app, Role.Admin);
      const hiddenItem = await content(ModeratableContentType.Itinerary, bob);
      const reportId = await fileReport(
        alice,
        ModeratableContentType.Itinerary,
        hiddenItem,
      );
      await resolve(mod, reportId, { action: 'HIDE', note: 'Advert' }).expect(
        200,
      );
      const deletedItem = await content(ModeratableContentType.Post, bob);
      await as(
        http().delete(`/api/admin/content/post/${deletedItem}`),
        mod,
      ).expect(200);

      const logs = (action: string) =>
        as(
          http().get(
            `/api/admin/audit-logs?actorId=${mod.userId}&action=${action}`,
          ),
          admin,
        ).expect(200);
      const actor = { id: mod.userId, role: 'ADMIN' };

      const resolved = await logs('RESOLVE_REPORT');
      expect(resolved.body.items).toEqual([
        expect.objectContaining({
          action: 'RESOLVE_REPORT',
          actor,
          targetType: 'REPORT',
          targetId: reportId,
          reason: 'Advert',
        }),
      ]);
      const hidden = await logs('HIDE_CONTENT');
      expect(hidden.body.items).toEqual([
        expect.objectContaining({
          actor,
          targetType: 'ITINERARY',
          targetId: hiddenItem,
        }),
      ]);
      const deleted = await logs('DELETE_CONTENT');
      expect(deleted.body.items).toEqual([
        expect.objectContaining({
          actor,
          targetType: 'POST',
          targetId: deletedItem,
        }),
      ]);
      const all = await as(
        http().get(`/api/admin/audit-logs?actorId=${mod.userId}`),
        admin,
      ).expect(200);
      expect(all.body.total).toBe(3);
    });
  });
});
