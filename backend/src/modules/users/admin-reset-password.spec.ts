import { Types, type Connection, type Model } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import type { PasswordService } from '../../common/security/password.service';
import { AdminAccountsService } from './admin-accounts.service';
import type { User } from './schemas/user.schema';
import type { SessionsService } from './sessions.service';

const ADMIN = { id: new Types.ObjectId().toHexString(), role: Role.Admin };
const TARGET = new Types.ObjectId().toHexString();
const SESSION = { id: 'mongo-session' };

function setup(target: { role: Role } | null = { role: Role.User }) {
  const query = {
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(target),
  };
  const users = {
    findById: jest.fn().mockReturnValue(query),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) => fn(SESSION)),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('temp-hash') };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminAccountsService(
    users as unknown as Model<User>,
    connection as unknown as Connection,
    passwords as unknown as PasswordService,
    sessions as unknown as SessionsService,
    audit,
  );
  return { service, users, query, connection, passwords, sessions, audit };
}

async function failure(promise: Promise<unknown>): Promise<AppException> {
  const e = await promise.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(AppException);
  return e as AppException;
}

describe('AdminAccountsService.resetPassword (ACC-07a)', () => {
  it('sets the temporary password, forces a change, lifts the lockout, audits in the same transaction, then ends sessions', async () => {
    const { service, users, query, passwords, sessions, audit } = setup();
    await service.resetPassword(ADMIN, TARGET, 'Temp2026x');

    expect(passwords.hash).toHaveBeenCalledWith('Temp2026x');
    expect(query.session).toHaveBeenCalledWith(SESSION);
    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(TARGET) },
      {
        $set: {
          passwordHash: 'temp-hash',
          mustChangePassword: true,
          failedLoginCount: 0,
        },
        $unset: { lockedUntil: 1 },
      },
      { session: SESSION },
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        actor: ADMIN,
        action: 'RESET_PASSWORD',
        targetType: 'USER',
        targetId: TARGET,
        metadata: { targetRole: Role.User },
      },
      SESSION,
    );
    // Never the password, not even its hash, in the audit entry.
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(
      /Temp2026x|temp-hash/,
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(TARGET);
  });

  it('works for moderators too', async () => {
    const { service, users } = setup({ role: Role.HotelModerator });
    await service.resetPassword(ADMIN, TARGET, 'Temp2026x');
    expect(users.updateOne).toHaveBeenCalled();
  });

  it('refuses to reset an admin (403) and an unknown account (404), changing nothing', async () => {
    for (const [target, status] of [
      [{ role: Role.Admin }, 403],
      [null, 404],
    ] as const) {
      const { service, users, sessions, audit } = setup(target);
      expect(
        (
          await failure(service.resetPassword(ADMIN, TARGET, 'Temp2026x'))
        ).getStatus(),
      ).toBe(status);
      expect(users.updateOne).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    }
  });

  it('does not end sessions when the transaction fails (e.g. the audit write)', async () => {
    const { service, audit, sessions } = setup();
    audit.record.mockRejectedValue(new Error('audit down'));
    await expect(
      service.resetPassword(ADMIN, TARGET, 'Temp2026x'),
    ).rejects.toThrow('audit down');
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});
