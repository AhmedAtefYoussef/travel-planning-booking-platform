import { HttpStatus } from '@nestjs/common';
import { Types, type ClientSession, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  NotificationType,
  type NotificationInput,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { runInTransaction } from '../../common/utils/transaction';
import { InAppNotificationsService } from './notifications.service';
import {
  NotificationSchema,
  type Notification,
} from './schemas/notification.schema';

const oid = () => new Types.ObjectId();

const exec = <T>(value: T) => ({
  exec: jest.fn().mockResolvedValue(value),
  lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
});

function chain<T>(value: T) {
  const q = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  q.sort.mockReturnValue(q);
  q.skip.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  return q;
}

function setup() {
  const model = {
    insertMany: jest.fn().mockResolvedValue([]),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
  };
  const email = {
    notificationsCreated: jest.fn().mockResolvedValue(undefined),
    moderatorInvited: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InAppNotificationsService(
    model as unknown as Model<Notification>,
    email,
  );
  return { model, email, service };
}

const user = (id = oid().toHexString()): AuthUser => ({ id, role: Role.User });

const input = (
  overrides: Partial<NotificationInput> = {},
): NotificationInput => ({
  userId: oid().toHexString(),
  type: NotificationType.RefundIssued,
  title: 'Refund issued',
  body: 'Your refund of 120.00 USD is on its way.',
  link: '/bookings/flights/6af0eaaec77901aa9f228660',
  ...overrides,
});

const doc = (overrides: Partial<Record<string, unknown>> = {}) => ({
  _id: oid(),
  userId: oid(),
  type: NotificationType.BookingConfirmed,
  title: 'Booking confirmed',
  body: 'Confirmed.',
  readAt: null,
  createdAt: new Date('2026-11-15T10:00:00Z'),
  ...overrides,
});

describe('notifications schema indexes (GEN-01)', () => {
  it('indexes the unread queries and the newest-first list sort', () => {
    expect(NotificationSchema.indexes().map(([keys]) => keys)).toEqual([
      { userId: 1, readAt: 1, createdAt: -1 },
      { userId: 1, createdAt: -1, _id: -1 },
    ]);
  });
});

describe('InAppNotificationsService (GEN-01)', () => {
  describe('notify / notifyMany (the NOTIFICATIONS_SERVICE contract)', () => {
    it("writes in the caller's session with readAt null", async () => {
      const { model, service } = setup();
      const session = {} as ClientSession;
      const i = input();
      await service.notify(i, session);
      expect(model.insertMany).toHaveBeenCalledWith(
        [
          {
            userId: new Types.ObjectId(i.userId),
            type: i.type,
            title: i.title,
            body: i.body,
            link: i.link,
            readAt: null,
          },
        ],
        { session },
      );
    });

    it('trims text and leaves link out when none is given', async () => {
      const { model, service } = setup();
      await service.notify(
        input({ title: '  Hi  ', body: ' There ', link: undefined }),
      );
      const [[docs, options]] = model.insertMany.mock.calls as [
        [Record<string, unknown>[], { session?: ClientSession }],
      ];
      expect(docs[0]).toMatchObject({ title: 'Hi', body: 'There' });
      expect(docs[0]).not.toHaveProperty('link');
      expect(options.session).toBeUndefined();
    });

    it('notifyMany writes every notification in one insert and skips an empty list', async () => {
      const { model, service } = setup();
      await service.notifyMany([]);
      expect(model.insertMany).not.toHaveBeenCalled();
      await service.notifyMany([input(), input()]);
      expect(model.insertMany).toHaveBeenCalledTimes(1);
      expect((model.insertMany.mock.calls[0] as [unknown[]])[0]).toHaveLength(
        2,
      );
    });

    it.each([
      ['an empty title', { title: '   ' }, /title/],
      ['a title over 120 characters', { title: 'x'.repeat(121) }, /title/],
      ['an empty body', { body: '' }, /body/],
      ['a body over 1000 characters', { body: 'x'.repeat(1001) }, /body/],
      ['a link not starting with /', { link: 'https://evil.example' }, /link/],
      ['a protocol-relative link', { link: '//evil.example/x' }, /link/],
      ['an unknown type', { type: 'NOPE' as NotificationType }, /type/],
      ['a malformed userId', { userId: 'abc' }, /userId/],
    ])(
      'rejects %s with a plain Error (a programming defect, not a 4xx)',
      async (_label, overrides, message) => {
        const { model, service } = setup();
        const failure = service.notify(input(overrides));
        await expect(failure).rejects.toThrow(message);
        await expect(failure).rejects.not.toBeInstanceOf(AppException);
        expect(model.insertMany).not.toHaveBeenCalled();
      },
    );

    describe('email (GEN-01-B)', () => {
      const settle = async () => {
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      };
      const fakeConnection = () => {
        const session = {
          withTransaction: jest.fn((fn: () => Promise<void>) => fn()),
          endSession: jest.fn(() => Promise.resolve()),
        };
        return {
          startSession: jest.fn(() =>
            Promise.resolve(session as unknown as ClientSession),
          ),
        };
      };

      it('without a session, emails on the next tick with the stored (trimmed) text', async () => {
        const { email, service } = setup();
        const i = input({ title: '  Hi  ' });
        await service.notify(i);
        expect(email.notificationsCreated).not.toHaveBeenCalled();
        await settle();
        expect(email.notificationsCreated).toHaveBeenCalledWith([
          { ...i, title: 'Hi' },
        ]);
      });

      it('inside a transaction, emails only after it commits', async () => {
        const { email, service } = setup();
        await runInTransaction(fakeConnection(), async (session) => {
          await service.notifyMany([input(), input()], session);
          await settle();
          expect(email.notificationsCreated).not.toHaveBeenCalled();
        });
        await settle();
        expect(email.notificationsCreated).toHaveBeenCalledTimes(1);
        expect(
          (email.notificationsCreated.mock.calls[0] as [unknown[]])[0],
        ).toHaveLength(2);
      });

      it('never emails when the transaction aborts', async () => {
        const { email, service } = setup();
        await expect(
          runInTransaction(fakeConnection(), async (session) => {
            await service.notify(input(), session);
            throw new Error('abort');
          }),
        ).rejects.toThrow('abort');
        await settle();
        expect(email.notificationsCreated).not.toHaveBeenCalled();
      });

      it('never emails an invalid notification', async () => {
        const { email, service } = setup();
        await expect(service.notify(input({ title: '' }))).rejects.toThrow();
        await settle();
        expect(email.notificationsCreated).not.toHaveBeenCalled();
      });
    });

    it('notifyMany writes nothing when any one input is invalid', async () => {
      const { model, service } = setup();
      await expect(
        service.notifyMany([input(), input({ title: '' })]),
      ).rejects.toThrow(/title/);
      expect(model.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('owner reads', () => {
    it('lists the caller’s notifications newest first, filtered by unread', async () => {
      const { model, service } = setup();
      const me = user();
      const d = doc({ link: '/x' });
      const q = chain([d]);
      model.find.mockReturnValue(q);
      model.countDocuments.mockReturnValue(exec(1));

      const page = await service.list(me, { page: 2, unread: true });

      const filter = {
        userId: new Types.ObjectId(me.id),
        readAt: null,
      };
      expect(model.find).toHaveBeenCalledWith(filter, undefined);
      expect(model.countDocuments).toHaveBeenCalledWith(filter);
      expect(q.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(q.skip).toHaveBeenCalledWith(10);
      expect(q.limit).toHaveBeenCalledWith(10);
      expect(page).toEqual({
        items: [
          {
            id: d._id.toHexString(),
            type: d.type,
            title: d.title,
            body: d.body,
            link: '/x',
            readAt: null,
            createdAt: d.createdAt,
          },
        ],
        page: 2,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it('unread=false lists read ones; no filter lists all', async () => {
      const { model, service } = setup();
      const me = user();
      model.find.mockImplementation(() => chain([]));
      model.countDocuments.mockReturnValue(exec(0));
      await service.list(me, { page: 1, unread: false });
      await service.list(me, { page: 1 });
      expect(model.find.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        { userId: new Types.ObjectId(me.id), readAt: { $ne: null } },
        { userId: new Types.ObjectId(me.id) },
      ]);
    });

    it('counts only unread notifications of the caller', async () => {
      const { model, service } = setup();
      const me = user();
      model.countDocuments.mockReturnValue(exec(3));
      await expect(service.unreadCount(me)).resolves.toEqual({ count: 3 });
      expect(model.countDocuments).toHaveBeenCalledWith({
        userId: new Types.ObjectId(me.id),
        readAt: null,
      });
    });
  });

  describe('mark as read', () => {
    const notFound = {
      status: HttpStatus.NOT_FOUND,
      code: ErrorCode.NOT_FOUND,
      message: 'Notification not found',
    };
    const asPlain = (e: unknown) => {
      const ex = e as AppException;
      const body = ex.getResponse() as { code: string; message: string };
      return { status: ex.getStatus(), code: body.code, message: body.message };
    };

    it('answers an unknown id and another user’s id with the same 404', async () => {
      const { model, service } = setup();
      const me = user();
      model.findById.mockReturnValueOnce(exec(null));
      const unknown = await service
        .markRead(me, oid().toHexString())
        .catch((e: unknown) => e);
      model.findById.mockReturnValueOnce(exec(doc()));
      const theirs = await service
        .markRead(me, oid().toHexString())
        .catch((e: unknown) => e);
      expect(asPlain(unknown)).toEqual(notFound);
      expect(asPlain(theirs)).toEqual(notFound);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('sets readAt once and returns the stored notification', async () => {
      const { model, service } = setup();
      const me = user();
      const d = doc({ userId: new Types.ObjectId(me.id) });
      const now = new Date('2026-11-15T12:00:00Z');
      model.findById.mockReturnValue(exec(d));
      model.findOneAndUpdate.mockReturnValue(exec({ ...d, readAt: now }));
      const dto = await service.markRead(me, d._id.toHexString(), now);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: d._id, readAt: null },
        { $set: { readAt: now } },
        { new: true },
      );
      expect(dto.readAt).toBe(now);
    });

    it('is idempotent: an already read notification keeps its readAt', async () => {
      const { model, service } = setup();
      const me = user();
      const readAt = new Date('2026-11-14T09:00:00Z');
      const d = doc({ userId: new Types.ObjectId(me.id), readAt });
      model.findById.mockReturnValue(exec(d));
      const dto = await service.markRead(me, d._id.toHexString());
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
      expect(dto.readAt).toBe(readAt);
    });

    it('a concurrent mark-read that won the race returns its readAt', async () => {
      const { model, service } = setup();
      const me = user();
      const d = doc({ userId: new Types.ObjectId(me.id) });
      const theirs = new Date('2026-11-15T11:59:59Z');
      model.findById
        .mockReturnValueOnce(exec(d))
        .mockReturnValueOnce(exec({ ...d, readAt: theirs }));
      model.findOneAndUpdate.mockReturnValue(exec(null));
      const dto = await service.markRead(me, d._id.toHexString());
      expect(dto.readAt).toBe(theirs);
    });

    it('read-all marks every unread notification of the caller only', async () => {
      const { model, service } = setup();
      const me = user();
      const now = new Date('2026-11-15T12:00:00Z');
      model.updateMany.mockReturnValue(exec({ modifiedCount: 4 }));
      await expect(service.markAllRead(me, now)).resolves.toEqual({
        updated: 4,
      });
      expect(model.updateMany).toHaveBeenCalledWith(
        { userId: new Types.ObjectId(me.id), readAt: null },
        { $set: { readAt: now } },
      );
    });
  });
});
