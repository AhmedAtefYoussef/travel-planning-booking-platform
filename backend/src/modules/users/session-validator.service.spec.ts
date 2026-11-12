import { Types, type Model } from 'mongoose';
import { ProviderType, Role } from '../../common/auth/auth.types';
import type { User } from './schemas/user.schema';
import { AccountStatus } from './schemas/user.schema';
import { SessionValidatorService } from './session-validator.service';
import type { SessionsService } from './sessions.service';

const USER = new Types.ObjectId().toHexString();
const SESSION = new Types.ObjectId().toHexString();
const HOTEL = new Types.ObjectId();

function setup(sessionOk: boolean, account: Partial<User> | null) {
  const sessions = { touch: jest.fn().mockResolvedValue(sessionOk) };
  const select = jest.fn().mockReturnValue({
    lean: () => Promise.resolve(account),
  });
  const users = { findById: jest.fn().mockReturnValue({ select }) };
  const service = new SessionValidatorService(
    sessions as unknown as SessionsService,
    users as unknown as Model<User>,
  );
  return { service, sessions, users, select };
}

describe('SessionValidatorService (ACC-06, ACC-11)', () => {
  it('returns the fresh account for a usable session', async () => {
    const { service, sessions, select } = setup(true, {
      role: Role.User,
      status: AccountStatus.Active,
    });
    await expect(service.touch(SESSION, USER)).resolves.toEqual({
      valid: true,
      status: 'ACTIVE',
      user: { id: USER, role: Role.User },
    });
    expect(sessions.touch).toHaveBeenCalledWith(SESSION, USER);
    expect(select).toHaveBeenCalledWith('role status assignedProvider');
  });

  it('includes a moderator provider as a string id, and reports the status as stored', async () => {
    const { service } = setup(true, {
      role: Role.HotelModerator,
      status: AccountStatus.Suspended,
      assignedProvider: { type: ProviderType.Hotel, providerId: HOTEL },
    });
    await expect(service.touch(SESSION, USER)).resolves.toEqual({
      valid: true,
      status: 'SUSPENDED',
      user: {
        id: USER,
        role: Role.HotelModerator,
        assignedProvider: {
          type: ProviderType.Hotel,
          providerId: HOTEL.toHexString(),
        },
      },
    });
  });

  it('is invalid when the session cannot be used, without reading the account', async () => {
    const { service, users } = setup(false, null);
    await expect(service.touch(SESSION, USER)).resolves.toEqual({
      valid: false,
    });
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('is invalid when the account no longer exists', async () => {
    const { service } = setup(true, null);
    await expect(service.touch(SESSION, USER)).resolves.toEqual({
      valid: false,
    });
  });
});
