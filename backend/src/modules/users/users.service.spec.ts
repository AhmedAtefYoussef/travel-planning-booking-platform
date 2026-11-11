import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { AccountStatus, type User } from './schemas/user.schema';
import { UsersService } from './users.service';

const input = {
  name: 'Mona Hassan',
  email: 'mona@example.com',
  passwordHash: 'hashed',
  termsAcceptedAt: new Date('2026-11-11T10:00:00Z'),
};

function setup(create: jest.Mock) {
  return new UsersService({ create } as unknown as Model<User>);
}

describe('UsersService.createTraveller (ACC-01)', () => {
  it('creates an active USER whatever the caller passes, and returns the profile without the hash', async () => {
    const id = new Types.ObjectId();
    const create = jest.fn().mockImplementation((doc: object) => ({
      ...doc,
      _id: id,
      createdAt: new Date('2026-11-11T10:00:00Z'),
    }));

    const profile = await setup(create).createTraveller({
      ...input,
      // A forged role must never survive: the service sets the role itself.
      ...({ role: Role.Admin } as object),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: Role.User,
        status: AccountStatus.Active,
        mustChangePassword: false,
        termsAcceptedAt: input.termsAcceptedAt,
      }),
    );
    expect(profile).toEqual({
      id: id.toHexString(),
      name: 'Mona Hassan',
      email: 'mona@example.com',
      role: Role.User,
      status: AccountStatus.Active,
      mustChangePassword: false,
      createdAt: '2026-11-11T10:00:00.000Z',
    });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('turns a duplicate email into 409 EMAIL_ALREADY_REGISTERED with a field error', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
    const error = await setup(create)
      .createTraveller(input)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(409);
    expect((error as AppException).code).toBe('EMAIL_ALREADY_REGISTERED');
    expect((error as AppException).fieldErrors).toEqual([
      { field: 'email', message: 'email is already registered' },
    ]);
  });

  it('rethrows other database errors unchanged (createTraveller)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('connection lost'));
    await expect(setup(create).createTraveller(input)).rejects.toThrow(
      'connection lost',
    );
  });
});

describe('UsersService lookups (ACC-04, ACC-19)', () => {
  const id = new Types.ObjectId();
  const doc = {
    _id: id,
    name: 'Mona Hassan',
    email: 'mona@example.com',
    passwordHash: 'stored-hash',
    role: Role.User,
    status: AccountStatus.Suspended,
    mustChangePassword: false,
    createdAt: new Date('2026-11-11T10:00:00Z'),
  };

  function withModel(found: unknown) {
    const select = jest.fn().mockResolvedValue(found);
    const model = {
      findOne: jest.fn().mockReturnValue({ select }),
      findById: jest.fn().mockResolvedValue(found),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    return {
      service: new UsersService(model as unknown as Model<User>),
      model,
      select,
    };
  }

  it('finds a login candidate by normalised email, with the hash and status', async () => {
    const { service, model, select } = withModel(doc);
    const found = await service.findForLogin('  Mona@Example.com ');

    expect(model.findOne).toHaveBeenCalledWith({ email: 'mona@example.com' });
    expect(select).toHaveBeenCalledWith('+passwordHash');
    expect(found).toMatchObject({
      id: id.toHexString(),
      status: AccountStatus.Suspended,
      passwordHash: 'stored-hash',
      user: { email: 'mona@example.com', role: Role.User },
    });
    expect(found?.user).not.toHaveProperty('passwordHash');
  });

  it('returns null for an unknown email', async () => {
    await expect(
      withModel(null).service.findForLogin('x@y.z'),
    ).resolves.toBeNull();
  });

  it('returns the profile for an id, null for a missing account or malformed id', async () => {
    await expect(
      withModel(doc).service.findProfile(id.toHexString()),
    ).resolves.toMatchObject({
      id: id.toHexString(),
    });
    await expect(
      withModel(null).service.findProfile(id.toHexString()),
    ).resolves.toBeNull();
    const { service, model } = withModel(doc);
    await expect(service.findProfile('not-an-id')).resolves.toBeNull();
    expect(model.findById).not.toHaveBeenCalled();
  });

  it('replaces a password hash', async () => {
    const { service, model } = withModel(doc);
    await service.replacePasswordHash(id.toHexString(), 'new-hash');
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: id.toHexString() },
      { $set: { passwordHash: 'new-hash' } },
    );
  });
});

describe('UsersService login failures (ACC-05)', () => {
  const id = new Types.ObjectId();
  const NOW = new Date('2026-11-11T10:00:00Z');
  const LOCK_END = new Date('2026-11-11T10:15:00Z');

  function withResult(after: unknown) {
    const lean = jest.fn().mockResolvedValue(after);
    const model = {
      findOneAndUpdate: jest.fn().mockReturnValue({ lean }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    return {
      service: new UsersService(model as unknown as Model<User>),
      model,
    };
  }

  it('counts and locks in one atomic pipeline update', async () => {
    const { service, model } = withResult({ lockedUntil: LOCK_END });
    await expect(
      service.recordFailedLogin(id.toHexString(), 5, 15 * 60_000, NOW),
    ).resolves.toEqual(LOCK_END);

    const [filter, pipeline, options] = model.findOneAndUpdate.mock
      .calls[0] as [unknown, unknown[], unknown];
    expect(filter).toEqual({ _id: id });
    expect(Array.isArray(pipeline)).toBe(true);
    expect(JSON.stringify(pipeline)).toContain(LOCK_END.toISOString());
    expect(options).toEqual({ new: true });
  });

  it('returns null when this failure did not lock the account', async () => {
    await expect(
      withResult({ failedLoginCount: 2 }).service.recordFailedLogin(
        id.toHexString(),
        5,
        15 * 60_000,
        NOW,
      ),
    ).resolves.toBeNull();
    // An older lock that this call did not set is not reported as a new one.
    await expect(
      withResult({
        lockedUntil: new Date('2026-11-11T09:00:00Z'),
      }).service.recordFailedLogin(id.toHexString(), 5, 15 * 60_000, NOW),
    ).resolves.toBeNull();
    await expect(
      withResult(null).service.recordFailedLogin(
        id.toHexString(),
        5,
        15 * 60_000,
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it('resets the counter and removes the lock', async () => {
    const { service, model } = withResult(null);
    await service.resetLoginFailures(id.toHexString());
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: id },
      { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: 1 } },
    );
  });
});
