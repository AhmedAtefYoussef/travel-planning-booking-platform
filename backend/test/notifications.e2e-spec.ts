import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  NOTIFICATIONS_SERVICE,
  NotificationType,
  type NotificationInput,
  type NotificationsService,
} from '../src/common/contracts';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

/**
 * GEN-01: in-app notifications. Producers write through NOTIFICATIONS_SERVICE inside their own
 * transaction; the owner lists them (10 per page, newest first), counts the unread ones and marks them
 * read. Another user's notification answers exactly like an unknown id (ACC-11).
 */
describe('Notifications (e2e): GEN-01', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let notifications: NotificationsService;
  const http = () => request(app.getHttpServer());

  const input = (
    userId: string,
    overrides: Partial<NotificationInput> = {},
  ): NotificationInput => ({
    userId,
    type: NotificationType.BookingConfirmed,
    title: 'Booking confirmed',
    body: 'Your flight CAI -> DXB is confirmed.',
    link: `/bookings/flights/${new Types.ObjectId().toHexString()}`,
    ...overrides,
  });

  /** Unread notifications of `who`, each its own id. */
  const seed = async (who: LoggedIn, count: number): Promise<string[]> => {
    await notifications.notifyMany(
      Array.from({ length: count }, (_, i) =>
        input(who.userId, { title: `Notice ${i}` }),
      ),
    );
    const docs = await connection
      .collection('notifications')
      .find({ userId: new Types.ObjectId(who.userId) })
      .sort({ _id: 1 })
      .toArray();
    return docs.map((d) => d._id.toHexString());
  };

  const unreadCount = async (who: LoggedIn): Promise<number> =>
    (
      await http()
        .get('/api/notifications/unread-count')
        .set('Cookie', who.cookie)
        .expect(200)
    ).body.count as number;

  beforeAll(async () => {
    app = await createTestApp();
    connection = app.get<Connection>(getConnectionToken());
    notifications = app.get<NotificationsService>(NOTIFICATIONS_SERVICE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GEN-01 lists only my notifications newest first, 10 per page', async () => {
    const a = await loginAs(app, Role.User);
    const b = await loginAs(app, Role.User);
    // Distinct, known creation times so "newest first" is checked exactly.
    const base = Date.UTC(2026, 10, 1, 8, 0, 0);
    await connection.collection('notifications').insertMany(
      Array.from({ length: 12 }, (_, i) => ({
        userId: new Types.ObjectId(a.userId),
        type: NotificationType.RefundIssued,
        title: `A ${i}`,
        body: 'Refund issued',
        readAt: null,
        createdAt: new Date(base + i * 60_000),
        updatedAt: new Date(base + i * 60_000),
      })),
    );
    await notifications.notify(input(b.userId, { title: 'B only' }));

    const page1 = await http()
      .get('/api/notifications')
      .set('Cookie', a.cookie)
      .expect(200);
    expect(page1.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    expect(page1.body.items).toHaveLength(10);
    expect(page1.body.items.map((n: { title: string }) => n.title)).toEqual(
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((i) => `A ${i}`),
    );
    const times = page1.body.items.map((n: { createdAt: string }) =>
      Date.parse(n.createdAt),
    );
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect(page1.body.items[0]).toEqual({
      id: expect.any(String),
      type: 'REFUND_ISSUED',
      title: 'A 11',
      body: 'Refund issued',
      readAt: null,
      createdAt: new Date(base + 11 * 60_000).toISOString(),
    });

    const page2 = await http()
      .get('/api/notifications?page=2')
      .set('Cookie', a.cookie)
      .expect(200);
    expect(page2.body.items.map((n: { title: string }) => n.title)).toEqual([
      'A 1',
      'A 0',
    ]);

    const mine = await http()
      .get('/api/notifications')
      .set('Cookie', b.cookie)
      .expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.items[0]).toMatchObject({
      title: 'B only',
      type: 'BOOKING_CONFIRMED',
      link: expect.stringMatching(/^\/bookings\/flights\//),
    });
  });

  it('GEN-01 filters by unread=true|false and refuses a page size', async () => {
    const a = await loginAs(app, Role.User);
    const [first] = await seed(a, 3);
    await http()
      .patch(`/api/notifications/${first}/read`)
      .set('Cookie', a.cookie)
      .expect(200);

    const unread = await http()
      .get('/api/notifications?unread=true')
      .set('Cookie', a.cookie)
      .expect(200);
    expect(unread.body.total).toBe(2);
    expect(
      unread.body.items.every((n: { readAt: unknown }) => n.readAt === null),
    ).toBe(true);

    const read = await http()
      .get('/api/notifications?unread=false')
      .set('Cookie', a.cookie)
      .expect(200);
    expect(read.body.total).toBe(1);
    expect(read.body.items[0].id).toBe(first);

    const bad = await http()
      .get('/api/notifications?unread=maybe')
      .set('Cookie', a.cookie)
      .expect(400);
    expect(bad.body.fieldErrors).toEqual([
      { field: 'unread', message: 'unread must be true or false' },
    ]);
    await http()
      .get('/api/notifications?limit=50')
      .set('Cookie', a.cookie)
      .expect(400);
  });

  it('GEN-01 unread count drops after mark-read and read-all', async () => {
    const a = await loginAs(app, Role.User);
    const ids = await seed(a, 3);
    expect(await unreadCount(a)).toBe(3);

    const marked = await http()
      .patch(`/api/notifications/${ids[0]}/read`)
      .set('Cookie', a.cookie)
      .expect(200);
    expect(marked.body).toMatchObject({
      id: ids[0],
      readAt: expect.any(String),
    });
    expect(await unreadCount(a)).toBe(2);

    // Idempotent: marking it again changes nothing, readAt included.
    const again = await http()
      .patch(`/api/notifications/${ids[0]}/read`)
      .set('Cookie', a.cookie)
      .expect(200);
    expect(again.body.readAt).toBe(marked.body.readAt);
    expect(await unreadCount(a)).toBe(2);

    const all = await http()
      .patch('/api/notifications/read-all')
      .set('Cookie', a.cookie)
      .expect(200);
    expect(all.body).toEqual({ updated: 2 });
    expect(await unreadCount(a)).toBe(0);

    const none = await http()
      .patch('/api/notifications/read-all')
      .set('Cookie', a.cookie)
      .expect(200);
    expect(none.body).toEqual({ updated: 0 });
  });

  it("GEN-01 another user's notification id answers like an unknown id", async () => {
    const owner = await loginAs(app, Role.User);
    const stranger = await loginAs(app, Role.User);
    const [theirs] = await seed(owner, 1);
    const unknown = new Types.ObjectId().toHexString();

    const a = await http()
      .patch(`/api/notifications/${theirs}/read`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    const b = await http()
      .patch(`/api/notifications/${unknown}/read`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    const strip = (body: Record<string, unknown>) => ({
      ...body,
      path: undefined,
      timestamp: undefined,
    });
    expect(a.body.code).toBe('NOT_FOUND');
    expect(strip(a.body)).toEqual(strip(b.body));

    // The stranger's read-all never touches the owner's notification.
    await http()
      .patch('/api/notifications/read-all')
      .set('Cookie', stranger.cookie)
      .expect(200);
    expect(await unreadCount(owner)).toBe(1);

    await http()
      .patch('/api/notifications/not-an-id/read')
      .set('Cookie', stranger.cookie)
      .expect(400);
  });

  it('GEN-01 guest gets 401 on all four routes', async () => {
    const id = new Types.ObjectId().toHexString();
    const calls = [
      http().get('/api/notifications'),
      http().get('/api/notifications/unread-count'),
      http().patch(`/api/notifications/${id}/read`),
      http().patch('/api/notifications/read-all'),
    ];
    for (const call of calls) {
      const res = await call;
      expect([res.status, res.body.code]).toEqual([401, 'UNAUTHENTICATED']);
    }
  });

  it('GEN-01 any signed-in role can read its own notifications', async () => {
    const admin = await loginAs(app, Role.Admin);
    await seed(admin, 1);
    expect(await unreadCount(admin)).toBe(1);
  });

  it('GEN-01 notify inside an aborted transaction leaves nothing', async () => {
    const a = await loginAs(app, Role.User);
    const session = await connection.startSession();
    try {
      session.startTransaction();
      await notifications.notify(input(a.userId), session);
      await notifications.notifyMany(
        [input(a.userId), input(a.userId)],
        session,
      );
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }
    expect(await unreadCount(a)).toBe(0);
    expect(
      await connection
        .collection('notifications')
        .countDocuments({ userId: new Types.ObjectId(a.userId) }),
    ).toBe(0);
  });
});
