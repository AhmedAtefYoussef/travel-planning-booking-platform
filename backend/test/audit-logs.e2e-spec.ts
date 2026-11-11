import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditService,
  AuditTargetType,
} from '../src/common/contracts';
import { AuditLog } from '../src/modules/audit/schemas/audit-log.schema';
import { createTestApp } from './support/create-test-app';

/** GEN-07: admin actions are recorded append-only and only admins can read them. */
describe('Audit log (e2e): GEN-07', () => {
  let app: INestApplication<App>;
  let audit: AuditService;
  let logs: Model<AuditLog>;
  const http = () => request(app.getHttpServer());
  const list = (query: Record<string, unknown> = {}, as = 'ADMIN') =>
    http().get('/api/admin/audit-logs').set('x-dev-user', as).query(query);

  const adminA = new Types.ObjectId().toHexString();
  const adminB = new Types.ObjectId().toHexString();
  const user1 = new Types.ObjectId().toHexString();
  const user2 = new Types.ObjectId().toHexString();
  const post = new Types.ObjectId().toHexString();

  beforeAll(async () => {
    app = await createTestApp();
    audit = app.get<AuditService>(AUDIT_SERVICE);
    logs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
    await logs.collection.deleteMany({});

    const entries: [string, AuditAction, AuditTargetType, string, string][] = [
      [
        adminA,
        AuditAction.SuspendAccount,
        AuditTargetType.User,
        user1,
        '2026-11-01T10:00:00Z',
      ],
      [
        adminA,
        AuditAction.ReactivateAccount,
        AuditTargetType.User,
        user1,
        '2026-11-05T10:00:00Z',
      ],
      [
        adminB,
        AuditAction.SuspendAccount,
        AuditTargetType.User,
        user2,
        '2026-11-10T23:59:59Z',
      ],
      [
        adminB,
        AuditAction.DeleteContent,
        AuditTargetType.Post,
        post,
        '2026-11-11T00:00:00Z',
      ],
    ];
    for (const [actor, action, targetType, targetId] of entries) {
      await audit.record({
        actor: { id: actor, role: Role.Admin },
        action,
        targetType,
        targetId,
        reason: `${action} for the e2e test`,
        metadata: { before: { status: 'ACTIVE' }, password: 'never-stored' },
      });
    }
    // Pin createdAt so the date filters are deterministic. The model refuses updates (append-only),
    // so the test adjusts the raw collection directly.
    const stored = await logs.find().sort({ _id: 1 }).lean().exec();
    for (const [i, doc] of stored.entries()) {
      await logs.collection.updateOne(
        { _id: doc._id },
        { $set: { createdAt: new Date(entries[i][4]) } },
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('admins read the log newest first, with secrets already removed', async () => {
    const res = await list().expect(200);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 4,
      totalPages: 1,
    });
    expect(res.body.items.map((e: { action: string }) => e.action)).toEqual([
      'DELETE_CONTENT',
      'SUSPEND_ACCOUNT',
      'REACTIVATE_ACCOUNT',
      'SUSPEND_ACCOUNT',
    ]);
    expect(res.body.items[0]).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      actorId: adminB,
      actorRole: 'ADMIN',
      action: 'DELETE_CONTENT',
      targetType: 'POST',
      targetId: post,
      reason: 'DELETE_CONTENT for the e2e test',
      metadata: { before: { status: 'ACTIVE' } },
      createdAt: '2026-11-11T00:00:00.000Z',
    });
  });

  it.each([
    ['action', { action: 'suspend_account' }, 2],
    ['targetType', { targetType: 'POST' }, 1],
    ['targetId', { targetId: user1 }, 2],
    ['actorId', { actorId: adminA }, 2],
    [
      'action and actor together',
      { action: 'SUSPEND_ACCOUNT', actorId: adminB },
      1,
    ],
  ])('filters by %s', async (_name, query, total) => {
    const res = await list(query).expect(200);
    expect(res.body.total).toBe(total);
  });

  it('a date alone covers the whole UTC day on both ends', async () => {
    const tenth = await list({ from: '2026-11-10', to: '2026-11-10' }).expect(
      200,
    );
    expect(
      tenth.body.items.map((e: { targetId: string }) => e.targetId),
    ).toEqual([user2]);
    const range = await list({ from: '2026-11-05', to: '2026-11-10' }).expect(
      200,
    );
    expect(range.body.total).toBe(2);
    const exact = await list({
      from: '2026-11-10T23:59:59Z',
      to: '2026-11-11T00:00:00Z',
    }).expect(200);
    expect(exact.body.total).toBe(2);
  });

  it('an unknown target or a range with no entries is an empty page, not an error', async () => {
    const res = await list({
      targetId: new Types.ObjectId().toHexString(),
    }).expect(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
    await list({ from: '2027-01-01' }).expect(200);
  });

  it.each([
    ['an unknown action', { action: 'DROP_DATABASE' }, 'action'],
    ['an unknown target type', { targetType: 'PLANE' }, 'targetType'],
    ['a malformed target id', { targetId: 'abc' }, 'targetId'],
    [
      'a malformed actor id',
      { actorId: 'zzzzzzzzzzzzzzzzzzzzzzzz' },
      'actorId',
    ],
    ['an impossible date', { from: '2026-02-30' }, 'from'],
    ['a time without a zone', { to: '2026-11-10T08:00:00' }, 'to'],
    [
      'a range that ends before it starts',
      { from: '2026-11-11', to: '2026-11-10' },
      'to',
    ],
    ['a bad page', { page: 0 }, 'page'],
  ])('rejects %s with a field error', async (_name, query, field) => {
    const res = await list(query).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(
      res.body.fieldErrors.map((e: { field: string }) => e.field),
    ).toContain(field);
  });

  it('rejects a page-size parameter (GEN-05)', async () => {
    const res = await list({ limit: 50 }).expect(400);
    expect(
      res.body.fieldErrors.map((e: { field: string }) => e.field),
    ).toContain('limit');
  });

  it('never passes query operators or repeated parameters to the database', async () => {
    for (const query of [
      'targetId[$ne]=x',
      'action[$ne]=SUSPEND_ACCOUNT',
      'actorId[$gt]=',
      'from[$gt]=2020-01-01',
      'targetType=USER&targetType=POST',
    ]) {
      const res = await http()
        .get(`/api/admin/audit-logs?${query}`)
        .set('x-dev-user', 'ADMIN')
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('accepts one bound alone and a time with a non-UTC offset', async () => {
    expect((await list({ from: '2026-11-10' }).expect(200)).body.total).toBe(2);
    expect((await list({ to: '2026-11-05' }).expect(200)).body.total).toBe(2);
    // 2026-11-11T01:00+02:00 is 2026-11-10T23:00Z: only the 23:59:59Z entry of the 10th is after it.
    const offset = await list({
      from: '2026-11-11T01:00:00+02:00',
      to: '2026-11-10',
    }).expect(200);
    expect(offset.body.total).toBe(1);
  });

  it('only admins may read it', async () => {
    await http().get('/api/admin/audit-logs').expect(401);
    for (const role of [
      `USER:${user1}`,
      `AIRLINE_MODERATOR:${user1}:${post}`,
      `HOTEL_MODERATOR:${user1}:${post}`,
    ]) {
      await list({}, role).expect(403);
    }
  });

  it('exposes no write routes, and the model refuses updates (append-only)', async () => {
    const [entry] = (await list().expect(200)).body.items as { id: string }[];
    await http()
      .delete(`/api/admin/audit-logs/${entry.id}`)
      .set('x-dev-user', 'ADMIN')
      .expect(404);
    await http()
      .patch(`/api/admin/audit-logs/${entry.id}`)
      .set('x-dev-user', 'ADMIN')
      .send({ reason: 'edited' })
      .expect(404);
    await http()
      .post('/api/admin/audit-logs')
      .set('x-dev-user', 'ADMIN')
      .send({ action: 'SUSPEND_ACCOUNT' })
      .expect(404);
    await expect(
      logs.updateOne({ _id: entry.id }, { $set: { reason: 'edited' } }).exec(),
    ).rejects.toThrow('append-only');
    expect((await list().expect(200)).body.total).toBe(4);
  });
});

describe('Audit log pagination (e2e): GEN-05, GEN-07', () => {
  let app: INestApplication<App>;
  let logs: Model<AuditLog>;

  beforeAll(async () => {
    app = await createTestApp();
    logs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
    await logs.collection.deleteMany({});
    const sameInstant = new Date('2026-11-10T12:00:00Z');
    // 13 entries with the same createdAt: only the _id tie-break orders them.
    await logs.collection.insertMany(
      Array.from({ length: 13 }, () => ({
        actorId: new Types.ObjectId(),
        actorRole: 'ADMIN',
        action: 'SUSPEND_ACCOUNT',
        targetType: 'USER',
        targetId: new Types.ObjectId(),
        createdAt: sameInstant,
      })),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('pages of 10 never overlap or skip entries, even with identical timestamps', async () => {
    const get = (page: number) =>
      request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .set('x-dev-user', 'ADMIN')
        .query({ page })
        .expect(200);
    const first = await get(1);
    const second = await get(2);
    expect(first.body).toMatchObject({ total: 13, totalPages: 2, limit: 10 });
    expect(first.body.items).toHaveLength(10);
    expect(second.body.items).toHaveLength(3);
    const ids = [...first.body.items, ...second.body.items].map(
      (e: { id: string }) => e.id,
    );
    expect(new Set(ids).size).toBe(13);
    expect((await get(3)).body.items).toEqual([]);
  });
});
