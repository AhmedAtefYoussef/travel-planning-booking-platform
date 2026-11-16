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
import type {
  ProviderDirectoryService,
  ProviderSummary,
} from './provider-directory.service';
import { ProviderStatusService } from './provider-status.service';
import { AccountStatus, type User } from './schemas/user.schema';

const ADMIN: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.Admin,
};
const SESSION = { id: 'tx' };

function setup(
  provider: Omit<ProviderSummary, 'id'> | null,
  options: {
    raceLost?: boolean;
    notifyFails?: boolean;
    moderators?: number;
  } = {},
) {
  const id = new Types.ObjectId().toHexString();
  const moderatorIds = Array.from(
    { length: options.moderators ?? 2 },
    () => new Types.ObjectId(),
  );
  const directory = {
    find: jest.fn().mockResolvedValue(provider ? { id, ...provider } : null),
    setActive: jest.fn().mockResolvedValue(!options.raceLost),
  };
  const users = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: () => Promise.resolve(moderatorIds.map((_id) => ({ _id }))),
      }),
    }),
  };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) => fn(SESSION)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    notify: jest.fn(),
    notifyMany: options.notifyFails
      ? jest.fn().mockRejectedValue(new Error('inbox down'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const service = new ProviderStatusService(
    users as unknown as Model<User>,
    connection as unknown as Connection,
    directory as unknown as ProviderDirectoryService,
    audit,
    notifications,
  );
  return {
    id,
    moderatorIds: moderatorIds.map((m) => m.toHexString()),
    service,
    directory,
    users,
    audit,
    notifications,
  };
}

describe('ProviderStatusService (ACC-15)', () => {
  it('deactivates an active airline conditionally, audits in the transaction and notifies its moderators', async () => {
    const t = setup({ name: 'Nile Air', isActive: true });

    const result = await t.service.deactivate(
      ADMIN,
      ProviderType.Airline,
      t.id,
    );

    expect(result).toEqual({
      id: t.id,
      type: ProviderType.Airline,
      name: 'Nile Air',
      isActive: false,
    });
    expect(t.directory.find).toHaveBeenCalledWith(
      ProviderType.Airline,
      t.id,
      SESSION,
    );
    expect(t.directory.setActive).toHaveBeenCalledWith(
      ProviderType.Airline,
      t.id,
      false,
      SESSION,
    );
    expect(t.audit.record).toHaveBeenCalledWith(
      {
        actor: { id: ADMIN.id, role: Role.Admin },
        action: AuditAction.DeactivateProvider,
        targetType: AuditTargetType.Airline,
        targetId: t.id,
        metadata: { name: 'Nile Air', isActive: false },
      },
      SESSION,
    );
    // Only live moderator accounts of this provider (M-2): self-deactivated ones never read it.
    expect(t.users.find).toHaveBeenCalledWith({
      role: Role.AirlineModerator,
      status: { $ne: AccountStatus.Deactivated },
      'assignedProvider.type': ProviderType.Airline,
      'assignedProvider.providerId': new Types.ObjectId(t.id),
    });
    expect(t.notifications.notifyMany).toHaveBeenCalledWith(
      t.moderatorIds.map((userId): unknown =>
        expect.objectContaining({
          userId,
          type: NotificationType.ProviderDeactivated,
        }),
      ),
    );
  });

  it('reactivates an inactive hotel and notifies with ProviderReactivated', async () => {
    const t = setup({ name: 'Nile Hotel', isActive: false }, { moderators: 1 });

    const result = await t.service.reactivate(ADMIN, ProviderType.Hotel, t.id);

    expect(result).toEqual({
      id: t.id,
      type: ProviderType.Hotel,
      name: 'Nile Hotel',
      isActive: true,
    });
    expect(t.directory.setActive).toHaveBeenCalledWith(
      ProviderType.Hotel,
      t.id,
      true,
      SESSION,
    );
    expect(t.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ReactivateProvider,
        targetType: AuditTargetType.Hotel,
      }),
      SESSION,
    );
    expect(t.notifications.notifyMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: t.moderatorIds[0],
        type: NotificationType.ProviderReactivated,
      }),
    ]);
  });

  it('answers 404 for an unknown provider', async () => {
    const t = setup(null);
    await expect(
      t.service.deactivate(ADMIN, ProviderType.Hotel, t.id),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND', message: 'Hotel not found' },
    });
    expect(t.audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ['deactivate', false],
    ['reactivate', true],
  ] as const)(
    '%s when isActive is already %s is 409 INVALID_STATE_TRANSITION',
    async (action, isActive) => {
      const t = setup({ name: 'Nile Air', isActive });
      await expect(
        t.service[action](ADMIN, ProviderType.Airline, t.id),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'INVALID_STATE_TRANSITION' },
      });
      expect(t.directory.setActive).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.notifications.notifyMany).not.toHaveBeenCalled();
    },
  );

  it('is 409 when a concurrent call flipped the provider first', async () => {
    const t = setup({ name: 'Nile Air', isActive: true }, { raceLost: true });
    await expect(
      t.service.deactivate(ADMIN, ProviderType.Airline, t.id),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'INVALID_STATE_TRANSITION' },
    });
    expect(t.audit.record).not.toHaveBeenCalled();
  });

  it('skips notifying when the provider has no moderators', async () => {
    const t = setup({ name: 'Nile Air', isActive: true }, { moderators: 0 });
    await t.service.deactivate(ADMIN, ProviderType.Airline, t.id);
    expect(t.notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('still deactivates when the notifications cannot be written', async () => {
    const t = setup(
      { name: 'Nile Air', isActive: true },
      { notifyFails: true },
    );
    await expect(
      t.service.deactivate(ADMIN, ProviderType.Airline, t.id),
    ).resolves.toMatchObject({ isActive: false });
  });
});
