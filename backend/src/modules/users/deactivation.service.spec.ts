import { Types, type Model } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import type { PasswordService } from '../../common/security/password.service';
import { DeactivationService } from './deactivation.service';
import { AccountStatus, type User } from './schemas/user.schema';
import type { SessionsService } from './sessions.service';

const id = new Types.ObjectId();
const caller = { id: id.toHexString(), role: Role.User };
const NOW = new Date('2026-11-11T10:00:00Z');

function setup(
  options: {
    found?: unknown;
    passwordOk?: boolean;
    upcoming?: number | null;
    matched?: number;
  } = {},
) {
  const {
    found = { passwordHash: 'stored-hash', status: AccountStatus.Active },
    passwordOk = true,
    upcoming = 0,
    matched = 1,
  } = options;
  const users = {
    findById: jest.fn().mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(found) }),
    }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: matched }),
  };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const passwords = { verify: jest.fn().mockResolvedValue(passwordOk) };
  const bookings =
    upcoming === null
      ? undefined
      : { countUpcomingConfirmed: jest.fn().mockResolvedValue(upcoming) };
  const service = new DeactivationService(
    users as unknown as Model<User>,
    sessions as unknown as SessionsService,
    passwords as unknown as PasswordService,
    bookings,
  );
  return { service, users, sessions, passwords, bookings };
}

async function failure(promise: Promise<unknown>): Promise<AppException> {
  const e = await promise.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(AppException);
  return e as AppException;
}

describe('DeactivationService (ACC-12)', () => {
  it('confirms with the password, checks bookings, deactivates once and revokes every session', async () => {
    const { service, users, sessions, passwords, bookings } = setup();
    await service.deactivate(caller, 'Travel2026', NOW);

    expect(passwords.verify).toHaveBeenCalledWith('Travel2026', 'stored-hash');
    expect(bookings!.countUpcomingConfirmed).toHaveBeenCalledWith(
      caller.id,
      NOW,
    );
    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: id, status: AccountStatus.Active },
      { $set: { status: AccountStatus.Deactivated } },
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(caller.id, {}, NOW);
  });

  it('is blocked with 409 while there are upcoming Confirmed bookings', async () => {
    for (const [count, text] of [
      [1, '1 upcoming confirmed booking.'],
      [3, '3 upcoming confirmed bookings.'],
    ] as const) {
      const { service, users, sessions } = setup({ upcoming: count });
      const e = await failure(service.deactivate(caller, 'Travel2026', NOW));
      expect(e.getStatus()).toBe(409);
      expect(e.code).toBe('UPCOMING_BOOKINGS_EXIST');
      expect(e.message).toContain(text);
      expect(users.updateOne).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    }
  });

  it('rejects a wrong password with a field error, before looking at bookings', async () => {
    const { service, users, bookings } = setup({ passwordOk: false });
    const e = await failure(service.deactivate(caller, 'WrongPass1', NOW));
    expect(e.getStatus()).toBe(400);
    expect(e.fieldErrors).toEqual([
      { field: 'password', message: 'password is incorrect' },
    ]);
    expect(bookings!.countUpcomingConfirmed).not.toHaveBeenCalled();
    expect(users.updateOne).not.toHaveBeenCalled();
  });

  it('works without a bookings provider (no bookings can exist yet)', async () => {
    const { service, users } = setup({ upcoming: null });
    await service.deactivate(caller, 'Travel2026', NOW);
    expect(users.updateOne).toHaveBeenCalled();
  });

  it('is 401 for a missing account and 409 when the account is no longer active', async () => {
    expect(
      (
        await failure(setup({ found: null }).service.deactivate(caller, 'x'))
      ).getStatus(),
    ).toBe(401);
    expect(
      (
        await failure(
          setup().service.deactivate({ id: 'bad', role: Role.User }, 'x'),
        )
      ).getStatus(),
    ).toBe(401);
    const e = await failure(
      setup({ matched: 0 }).service.deactivate(caller, 'x'),
    );
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('INVALID_STATE_TRANSITION');
  });
});
