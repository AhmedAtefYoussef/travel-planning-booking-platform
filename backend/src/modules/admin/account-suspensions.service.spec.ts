import { Role, type AuthUser } from '../../common/auth/auth.types';
import type {
  AccountAdmin,
  AdministeredAccount,
  AuditService,
  NotificationsService,
} from '../../common/contracts';
import { AccountSuspensionsService } from './account-suspensions.service';

const ADMIN: AuthUser = { id: 'a'.repeat(24), role: Role.Admin };
const TARGET = 'b'.repeat(24);
const SESSION = { id: 'tx' };

function setup(
  account: AdministeredAccount | null,
  changed = true,
): {
  service: AccountSuspensionsService;
  accounts: jest.Mocked<AccountAdmin>;
  audit: jest.Mocked<AuditService>;
  notifications: jest.Mocked<NotificationsService>;
} {
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) => fn(SESSION)),
  };
  const accounts: jest.Mocked<AccountAdmin> = {
    find: jest.fn().mockResolvedValue(account),
    changeStatus: jest.fn().mockResolvedValue(changed),
    revokeAllSessions: jest.fn().mockResolvedValue(undefined),
    moderatorsOf: jest.fn(),
  };
  const audit: jest.Mocked<AuditService> = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const notifications: jest.Mocked<NotificationsService> = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn(),
  };
  const service = new AccountSuspensionsService(
    connection as never,
    accounts,
    audit,
    notifications,
  );
  return { service, accounts, audit, notifications };
}

const account = (over: Partial<AdministeredAccount> = {}) => ({
  id: TARGET,
  name: 'Mona Hassan',
  role: Role.User,
  status: 'ACTIVE' as const,
  ...over,
});

const failure = (p: Promise<unknown>) =>
  p.catch((e: unknown) => e) as Promise<{ status?: number; code?: string }>;

describe('AccountSuspensionsService: ACC-15, ACC-16, GEN-07', () => {
  it('suspends in one transaction: status, sessions, audit and notification all join it', async () => {
    const { service, accounts, audit, notifications } = setup(account());
    await expect(service.suspend(ADMIN, TARGET, 'spam')).resolves.toEqual({
      id: TARGET,
      name: 'Mona Hassan',
      role: Role.User,
      status: 'SUSPENDED',
    });
    expect(accounts.changeStatus).toHaveBeenCalledWith(
      TARGET,
      'ACTIVE',
      'SUSPENDED',
      SESSION,
    );
    expect(accounts.revokeAllSessions).toHaveBeenCalledWith(TARGET, SESSION);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actor: { id: ADMIN.id, role: Role.Admin },
        action: 'SUSPEND_ACCOUNT',
        targetType: 'USER',
        targetId: TARGET,
        reason: 'spam',
        metadata: { targetRole: Role.User, from: 'ACTIVE', to: 'SUSPENDED' },
      },
      SESSION,
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TARGET, type: 'ACCOUNT_SUSPENDED' }),
      SESSION,
    );
  });

  it('reactivates a suspended moderator without touching sessions', async () => {
    const { service, accounts, notifications } = setup(
      account({ role: Role.HotelModerator, status: 'SUSPENDED' }),
    );
    await expect(service.reactivate(ADMIN, TARGET)).resolves.toMatchObject({
      status: 'ACTIVE',
    });
    expect(accounts.revokeAllSessions).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ACCOUNT_REACTIVATED' }),
      SESSION,
    );
  });

  it('refuses your own account before opening a transaction', async () => {
    const { service, accounts } = setup(account());
    expect(await failure(service.suspend(ADMIN, ADMIN.id))).toMatchObject({
      status: 403,
    });
    expect(accounts.find).not.toHaveBeenCalled();
  });

  it('is 404 for an unknown account and 403 for an admin target', async () => {
    expect(
      await failure(setup(null).service.suspend(ADMIN, TARGET)),
    ).toMatchObject({ status: 404 });
    const admin = setup(account({ role: Role.Admin }));
    expect(await failure(admin.service.suspend(ADMIN, TARGET))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(admin.accounts.changeStatus).not.toHaveBeenCalled();
  });

  it('is 409 for a wrong state, a self-deactivated account, or a parallel change; nothing else runs', async () => {
    const cases = [
      setup(account({ status: 'SUSPENDED' })).service.suspend(ADMIN, TARGET),
      setup(account()).service.reactivate(ADMIN, TARGET),
      setup(account({ status: 'DEACTIVATED' })).service.suspend(ADMIN, TARGET),
    ];
    const messages = [];
    for (const p of cases) {
      const err = (await failure(p)) as { status: number; message: string };
      expect(err).toMatchObject({ status: 409, code: 'CONFLICT' });
      messages.push(err.message);
    }
    expect(messages).toEqual([
      'The account is already suspended',
      'The account is not suspended',
      expect.stringContaining('ACC-12') as string,
    ]);

    const raced = setup(account(), false);
    expect(await failure(raced.service.suspend(ADMIN, TARGET))).toMatchObject({
      status: 409,
    });
    expect(raced.audit.record).not.toHaveBeenCalled();
    expect(raced.notifications.notify).not.toHaveBeenCalled();
  });
});
