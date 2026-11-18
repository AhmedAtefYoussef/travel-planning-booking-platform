import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { ModeratableContentType } from '../src/common/contracts';
import { Itinerary } from '../src/modules/itineraries';
import { Report } from '../src/modules/moderation';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';
import {
  FAKE_CONTENT_TYPES,
  FakeContentStore,
  TestContentModule,
} from './support/test-content.module';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * GEN-09: a registered user reports a post, comment, review or itinerary with a reason, at most once per
 * item. Posts, comments and reviews go through test adapters of the CONTENT_MODERATION port; itineraries
 * through the real one.
 */
describe('Reports (e2e): GEN-09 report content once per item', () => {
  let app: INestApplication<App>;
  let content: FakeContentStore;
  let reports: Model<Report>;
  let itineraries: Model<Itinerary>;
  let alice: LoggedIn;
  let bob: LoggedIn;
  const http = () => request(app.getHttpServer());

  const report = (as: LoggedIn | null, body: object) => {
    const req = http().post('/api/reports');
    return (as ? req.set('Cookie', as.cookie) : req).send(body);
  };

  const body = (targetType: string, targetId: string, reason = 'Spam') => ({
    targetType,
    targetId,
    reason,
  });

  const itinerary = async (
    owner: LoggedIn,
    visibility: 'PUBLIC' | 'PRIVATE',
  ): Promise<string> => {
    const res = await http()
      .post('/api/itineraries')
      .set('Cookie', owner.cookie)
      .send({
        title: 'Ten days in Egypt',
        countries: ['EG'],
        startDate: '2027-03-01',
        visibility,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  };

  beforeAll(async () => {
    app = await createTestApp([TestContentModule]);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    content = app.get(FakeContentStore);
    reports = app.get<Model<Report>>(getModelToken(Report.name));
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    alice = await loginAs(app, Role.User);
    bob = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GEN-09 filing a report', () => {
    it.each(FAKE_CONTENT_TYPES)(
      'files an OPEN report of a %s with the trimmed reason',
      async (type) => {
        const id = content.add(type);
        const res = await report(
          alice,
          body(type, id, '  Offensive language  '),
        ).expect(201);
        expect(res.body).toEqual({
          id: expect.stringMatching(/^[a-f0-9]{24}$/),
          targetType: type,
          targetId: id,
          reason: 'Offensive language',
          status: 'OPEN',
          createdAt: expect.any(String),
        });
        const stored = await reports.findById(res.body.id).lean().exec();
        expect(stored?.reporterId.toHexString()).toBe(alice.userId);
      },
    );

    it('files a report of a public itinerary through the real adapter', async () => {
      const id = await itinerary(bob, 'PUBLIC');
      const res = await report(alice, body('ITINERARY', id)).expect(201);
      expect(res.body).toMatchObject({
        targetType: 'ITINERARY',
        targetId: id,
        status: 'OPEN',
      });
    });

    it('lets an author report their own content, even a private itinerary', async () => {
      const id = await itinerary(alice, 'PRIVATE');
      await report(alice, body('ITINERARY', id)).expect(201);
    });
  });

  describe('GEN-09 at most once per item', () => {
    it('refuses a second report of the same item by the same user (409), a different user may', async () => {
      const id = content.add(ModeratableContentType.Post);
      await report(alice, body('POST', id)).expect(201);
      const again = await report(alice, body('POST', id, 'Again')).expect(409);
      expect(again.body.code).toBe('REPORT_ALREADY_FILED');
      await report(bob, body('POST', id)).expect(201);
      expect(
        await reports.countDocuments({ targetId: new Types.ObjectId(id) }),
      ).toBe(2);
    });

    it('keeps exactly one report when five identical requests arrive at once', async () => {
      const id = content.add(ModeratableContentType.Review);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => report(bob, body('REVIEW', id))),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(
        await reports.countDocuments({ targetId: new Types.ObjectId(id) }),
      ).toBe(1);
    });
  });

  describe('GEN-09 validation (GEN-02 fieldErrors)', () => {
    const fieldsOf = (res: request.Response) =>
      (res.body.fieldErrors as { field: string }[]).map((f) => f.field);

    it.each([
      ['a blank reason', { reason: '   ' }, 'reason'],
      ['a missing reason', { reason: undefined }, 'reason'],
      ['a 501-character reason', { reason: 'a'.repeat(501) }, 'reason'],
      ['an unknown targetType', { targetType: 'HOTEL' }, 'targetType'],
      ['a malformed targetId', { targetId: '123' }, 'targetId'],
    ])('rejects %s with 400', async (_, over, field) => {
      const id = content.add(ModeratableContentType.Comment);
      const res = await report(alice, {
        ...body('COMMENT', id),
        ...over,
      }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res)).toContain(field);
    });

    it('accepts a 500-character reason', async () => {
      const id = content.add(ModeratableContentType.Comment);
      await report(alice, body('COMMENT', id, 'a'.repeat(500))).expect(201);
    });
  });

  describe('GEN-09 content the reporter cannot see is not found (404)', () => {
    it('answers 404 for an unknown id', async () => {
      const res = await report(
        alice,
        body('POST', new Types.ObjectId().toHexString()),
      ).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it("answers 404 for someone else's private itinerary, exactly as for an unknown one", async () => {
      const id = await itinerary(bob, 'PRIVATE');
      const priv = await report(alice, body('ITINERARY', id)).expect(404);
      const unknown = await report(
        alice,
        body('ITINERARY', new Types.ObjectId().toHexString()),
      ).expect(404);
      expect(priv.body.message).toBe(unknown.body.message);
    });

    it('answers 404 for hidden content of someone else', async () => {
      const id = await itinerary(bob, 'PUBLIC');
      await itineraries.updateOne({ _id: id }, { $set: { isHidden: true } });
      await report(alice, body('ITINERARY', id)).expect(404);
      const post = content.add(ModeratableContentType.Post, {
        isHidden: true,
      });
      await report(alice, body('POST', post)).expect(404);
    });
  });

  describe('GEN-09 only registered users may report', () => {
    it('answers 401 without a session', async () => {
      const id = content.add(ModeratableContentType.Post);
      await report(null, body('POST', id)).expect(401);
    });

    it.each([Role.Admin, Role.AirlineModerator, Role.HotelModerator])(
      'answers 403 to %s',
      async (role) => {
        const as = await loginAs(app, role);
        const id = content.add(ModeratableContentType.Post);
        await report(as, body('POST', id)).expect(403);
      },
    );
  });
});

describe('Reports (e2e): GEN-09 content type whose module has not registered', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 404 for a post while no posts adapter is registered', async () => {
    const user = await loginAs(app, Role.User);
    await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', user.cookie)
      .send({
        targetType: 'POST',
        targetId: new Types.ObjectId().toHexString(),
        reason: 'Spam',
      })
      .expect(404);
  });
});
