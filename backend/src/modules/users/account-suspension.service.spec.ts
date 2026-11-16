import { Types, type Connection, type Model } from 'mongoose';
import {
  ProviderType,
  Role,
  type AuthUser,
} from '../../common/auth/auth.types';
import {
  AuditAction,
  AuditTargetType,
  NotificationType,
} from '../../common/contracts';
import { AccountSuspensionService } from './account-suspension.service';
import { AccountStatus, type User } from './schemas/user.schema';
import type { SessionsService } from './sessions.service';

const ADMIN: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.Admin,
};
const SESSION = { id: 'tx' };

function setup(
  target: { role: Role; status: AccountStatus } | null,
  options: {
    raceLost?: boolean;
    notifyFails?: boolean;
    revokeFails?: boolean;
  } = {},
) {
  const id = new Types.ObjectId();
  const provider = new Types.ObjectId();
  const lean = (value: unknown) => ({ lean: () => Promise.resolve(value) });
  const findChain = {
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnValue(lean(target)),
  };
  const users = {
    findById: jest.fn().mockReturnValue(findChain),
    findOneAndUpdate: jest.fn((_filter: unknown, update: { $set: object }) =>
      lean(
        options.raceLost
          ? null
          : {
              _id: id,
              name: 'Mona',
              email: 'mona@example.com',
              role: target?.role,
              status: (update.$set as { status: AccountStatus }).status,
              createdAt: new Date('2026-11-01T10:00:00Z'),
              ...(target?.role === Role.HotelModerator
                ? {
                    assignedProvider: {
                      type: ProviderType.Hotel,
                      providerId: provider,
                    },
                  }
                : {}),
            },
      ),
    ),
  };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) => fn(SESSION)),
  };
  const sessions = {
    revokeAllForUser: options.revokeFails
      ? jest.fn().mockRejectedValue(new Error('sessions down'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    notify: options.notifyFails
      ? jest.fn().mockRejectedValue(new Error('inbox down'))
      : jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn(),
  };
  const service = new AccountSuspensionService(
    users as unknown as Model<User>,
    connection as unknown as Connection,
    sessions as unknown as SessionsService,
    audit,
    notifications,
  );
  return {
    id: id.toHexString(),
    provider: provider.toHexString(),
    service,
    users,
    sessions,
    audit,
    notifications,
  };
}

describe('AccountSuspensionService (ACC-15, ACC-16)', () => {
  it('suspends an active user conditionally, audits in the transaction, ends sessions and notifies', async () => {
    const t = setup({ role: Role.User, status: AccountStatus.Active });

    const summary = await t.service.suspend(ADMIN, t.id);

    expect(summary).toEqual({
      id: t.id,
      name: 'Mona',
      email: 'mona@example.com',
      role: Role.User,
      status: AccountStatus.Suspended,
      registeredAt: '2026-11-01T10:00:00.000Z',
    });
    expect(t.users.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(t.id), status: AccountStatus.Active },
      { $set: { status: AccountStatus.Suspended } },
      expect.objectContaining({ new: true, session: SESSION }),
    );
    expect(t.audit.record).toHaveBeenCalledWith(
      {
        actor: { id: ADMIN.id, role: Role.Admin },
        action: AuditAction.SuspendAccount,
        targetType: AuditTargetType.User,
        targetId: t.id,
        metadata: {
          targetRole: Role.User,
          from: AccountStatus.Active,
          to: AccountStatus.Suspended,
        },
      },
      SESSION,
    );
    expect(t.sessions.revokeAllForUser).toHaveBeenCalledWith(t.id);
    expect(t.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: t.id,
        type: NotificationType.AccountSuspended,
      }),
    );
  });

  it('suspends a moderator the same way and returns its provider', async () => {
    const t = setup({
      role: Role.HotelModerator,
      status: AccountStatus.Active,
    });
    const summary = await t.service.suspend(ADMIN, t.id);
    expect(summary.assignedProvider).toEqual({
      type: ProviderType.Hotel,
      providerId: t.provider,
    });
    expect(t.sessions.revokeAllForUser).toHaveBeenCalledWith(t.id);
  });

  it('reactivates a suspended account, audits it and notifies, without touching sessions', async () => {
    const t = setup({ role: Role.User, status: AccountStatus.Suspended });

    const summary = await t.service.reactivate(ADMIN, t.id);

    expect(summary.status).toBe(AccountStatus.Active);
    expect(t.users.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(t.id), status: AccountStatus.Suspended },
      { $set: { status: AccountStatus.Active } },
      expect.objectContaining({ session: SESSION }),
    );
    expect(t.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ReactivateAccount }),
      SESSION,
    );
    expect(t.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: t.id,
        type: NotificationType.AccountReactivated,
      }),
    );
    expect(t.sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown account', async () => {
    const t = setup(null);
    await expect(t.service.suspend(ADMIN, t.id)).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
    expect(t.audit.record).not.toHaveBeenCalled();
  });

  it('refuses admin targets with 403, the caller included', async () => {
    const t = setup({ role: Role.Admin, status: AccountStatus.Active });
    await expect(t.service.suspend(ADMIN, t.id)).rejects.toMatchObject({
      status: 403,
      response: { code: 'FORBIDDEN' },
    });
    await expect(t.service.reactivate(ADMIN, t.id)).rejects.toMatchObject({
      status: 403,
    });
    expect(t.users.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['suspend', AccountStatus.Suspended],
    ['suspend', AccountStatus.Deactivated],
    ['reactivate', AccountStatus.Active],
    ['reactivate', AccountStatus.Deactivated],
  ] as const)(
    '%s on a %s account is 409 INVALID_STATE_TRANSITION and changes nothing',
    async (action, status) => {
      const t = setup({ role: Role.User, status });
      await expect(t.service[action](ADMIN, t.id)).rejects.toMatchObject({
        status: 409,
        response: { code: 'INVALID_STATE_TRANSITION' },
      });
      expect(t.users.findOneAndUpdate).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.notifications.notify).not.toHaveBeenCalled();
    },
  );

  it('is 409 when a concurrent call changed the status first (conditional update lost)', async () => {
    const t = setup(
      { role: Role.User, status: AccountStatus.Active },
      { raceLost: true },
    );
    await expect(t.service.suspend(ADMIN, t.id)).rejects.toMatchObject({
      status: 409,
      response: { code: 'INVALID_STATE_TRANSITION' },
    });
    expect(t.audit.record).not.toHaveBeenCalled();
    expect(t.sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('still suspends when the notification cannot be written', async () => {
    const t = setup(
      { role: Role.User, status: AccountStatus.Active },
      { notifyFails: true },
    );
    await expect(t.service.suspend(ADMIN, t.id)).resolves.toMatchObject({
      status: AccountStatus.Suspended,
    });
    expect(t.sessions.revokeAllForUser).toHaveBeenCalled();
  });

  it('still answers with the committed suspension when ending the sessions fails, and still notifies', async () => {
    const t = setup(
      { role: Role.User, status: AccountStatus.Active },
      { revokeFails: true },
    );
    const error = jest
      .spyOn(t.service['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(t.service.suspend(ADMIN, t.id)).resolves.toMatchObject({
      status: AccountStatus.Suspended,
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(t.id),
      expect.any(String),
    );
    expect(t.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.AccountSuspended }),
    );
  });
});
