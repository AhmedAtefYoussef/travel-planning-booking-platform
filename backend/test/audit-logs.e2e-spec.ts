import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Types } from 'mongoose';
import { Role } from '../src/common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  type AuditService,
} from '../src/common/contracts';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

/**
 * GEN-07 (TRVL-102): admins read the audit log of admin actions. Entries come from the real admin
 * routes (reset password, create moderator) or from AUDIT_SERVICE.record; each test scopes its
 * queries to its own admin (actorId) so other suites' entries cannot interfere.
 */
describe('Audit log read endpoint (e2e): GEN-07', () => {
  let app: INestApplication<App>;
  let audit: AuditService;
  const http = () => request(app.getHttpServer());
  const URL = '/api/admin/audit-logs';

  const list = (query: string, who: LoggedIn) =>
    http().get(`${URL}?${query}`).set('Cookie', who.cookie);
  const newAirline = async (admin: LoggedIn, code: string) =>
    (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin.cookie)
        .send({ name: `Air ${code}`, code })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    app = await createTestApp();
    audit = app.get(AUDIT_SERVICE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GEN-07 admin sees reset-password and create-moderator entries newest first', async () => {
    const admin = await loginAs(app, Role.Admin);
    const target = await loginAs(app, Role.User);
    await http()
      .post(`/api/admin/users/${target.userId}/reset-password`)
      .set('Cookie', admin.cookie)
      .send({ temporaryPassword: 'Temp2026x' })
      .expect(204);
    const airlineId = await newAirline(admin, 'AL1');
    const email = `mod.${new Types.ObjectId().toHexString()}@example.com`;
    const created = await http()
      .post('/api/admin/moderators')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Ops Lead',
        email,
        role: Role.AirlineModerator,
        providerId: airlineId,
        temporaryPassword: 'Temp2026x',
      })
      .expect(201);

    const res = await list(`actorId=${admin.userId}`, admin).expect(200);
    expect(res.body).toMatchObject({ page: 1, limit: 10, total: 2 });
    const [newest, older] = res.body.items;
    expect(newest).toMatchObject({
      action: 'CREATE_MODERATOR',
      actor: { id: admin.userId, role: 'ADMIN' },
      targetType: 'USER',
      targetId: created.body.id,
    });
    expect(older).toMatchObject({
      action: 'RESET_PASSWORD',
      actor: { id: admin.userId, role: 'ADMIN' },
      targetType: 'USER',
      targetId: target.userId,
    });
    expect(newest.id).toMatch(/^[a-f0-9]{24}$/);
    expect(new Date(newest.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(older.createdAt).getTime(),
    );
    // Never exposes secrets or the temporary password.
    expect(JSON.stringify(res.body)).not.toMatch(
      /Temp2026x|temporaryPassword/i,
    );
  });

  it('GEN-07 filter by action, targetType and actorId', async () => {
    const admin = await loginAs(app, Role.Admin);
    const other = await loginAs(app, Role.Admin);
    const actor = (a: LoggedIn) => ({ id: a.userId, role: Role.Admin });
    const id = () => new Types.ObjectId().toHexString();
    await audit.record({
      actor: actor(admin),
      action: AuditAction.SuspendAccount,
      targetType: AuditTargetType.User,
      targetId: id(),
      reason: 'spam',
    });
    await audit.record({
      actor: actor(admin),
      action: AuditAction.DeleteContent,
      targetType: AuditTargetType.Post,
      targetId: id(),
    });
    await audit.record({
      actor: actor(other),
      action: AuditAction.SuspendAccount,
      targetType: AuditTargetType.User,
      targetId: id(),
    });

    const byAction = await list(
      `actorId=${admin.userId}&action=SUSPEND_ACCOUNT`,
      admin,
    ).expect(200);
    expect(byAction.body.total).toBe(1);
    expect(byAction.body.items[0]).toMatchObject({
      action: 'SUSPEND_ACCOUNT',
      reason: 'spam',
    });

    const byType = await list(
      `actorId=${admin.userId}&targetType=POST`,
      admin,
    ).expect(200);
    expect(byType.body.items.map((e: { action: string }) => e.action)).toEqual([
      'DELETE_CONTENT',
    ]);

    const byActor = await list(`actorId=${other.userId}`, admin).expect(200);
    expect(byActor.body.total).toBe(1);

    const bad = await list('action=NOPE&targetType=NOPE', admin).expect(400);
    expect(bad.body.fieldErrors.map((f: { field: string }) => f.field)).toEqual(
      expect.arrayContaining(['action', 'targetType']),
    );
  });

  it('GEN-07 date range filters, and from after to is 400', async () => {
    const admin = await loginAs(app, Role.Admin);
    await audit.record({
      actor: { id: admin.userId, role: Role.Admin },
      action: AuditAction.HideContent,
      targetType: AuditTargetType.Post,
      targetId: new Types.ObjectId().toHexString(),
    });
    const past = await list(
      `actorId=${admin.userId}&to=2020-01-01T00:00:00Z`,
      admin,
    ).expect(200);
    expect(past.body.total).toBe(0);
    const future = await list(
      `actorId=${admin.userId}&from=2020-01-01&to=2999-01-01`,
      admin,
    ).expect(200);
    expect(future.body.total).toBe(1);

    const reversed = await list(
      'from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z',
      admin,
    ).expect(400);
    expect(reversed.body.fieldErrors).toEqual([
      expect.objectContaining({ field: 'from' }),
    ]);
    const notDate = await list('from=yesterday', admin).expect(400);
    expect(notDate.body.fieldErrors[0].field).toBe('from');
  });

  it('GEN-07 a malformed actorId is 400 and a page size parameter is rejected', async () => {
    const admin = await loginAs(app, Role.Admin);
    const res = await list('actorId=not-an-id', admin).expect(400);
    expect(res.body.fieldErrors[0].field).toBe('actorId');
    await list('limit=50', admin).expect(400);
    await list('page=0', admin).expect(400);
  });

  it('GEN-07 users and moderators get 403, guests 401', async () => {
    const user = await loginAs(app, Role.User);
    const mod = await loginAs(app, Role.HotelModerator, {
      providerId: new Types.ObjectId().toHexString(),
    });
    await list('', user).expect(403);
    await list('', mod).expect(403);
    await http().get(URL).expect(401);
  });

  it('GEN-07 11 entries paginate 10 + 1', async () => {
    const admin = await loginAs(app, Role.Admin);
    for (let i = 0; i < 11; i++) {
      await audit.record({
        actor: { id: admin.userId, role: Role.Admin },
        action: AuditAction.ResolveReport,
        targetType: AuditTargetType.Comment,
        targetId: new Types.ObjectId().toHexString(),
        metadata: { n: i },
      });
    }
    const p1 = await list(`actorId=${admin.userId}`, admin).expect(200);
    const p2 = await list(`actorId=${admin.userId}&page=2`, admin).expect(200);
    expect(p1.body).toMatchObject({ total: 11, totalPages: 2, limit: 10 });
    expect(p1.body.items).toHaveLength(10);
    expect(p2.body.items).toHaveLength(1);
    // Newest first across the page boundary; the oldest entry is alone on page 2.
    expect(p1.body.items[0].metadata).toEqual({ n: 10 });
    expect(p2.body.items[0].metadata).toEqual({ n: 0 });
  });
});
