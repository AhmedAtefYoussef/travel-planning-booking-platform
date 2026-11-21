import type { Model } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import type { PasswordService } from '../../common/security/password.service';
import { AdminSeedService, SEEDED_ADMIN_NAME } from './admin-seed.service';
import { meetsPasswordRules } from './password-rules';
import { AccountStatus, type User } from './schemas/user.schema';

const duplicateKey = Object.assign(new Error('E11000 duplicate key'), {
  code: 11000,
});

function setup(existing?: Partial<User>) {
  const users = {
    create: jest
      .fn()
      .mockImplementation(() =>
        existing ? Promise.reject(duplicateKey) : Promise.resolve({}),
      ),
    findOne: jest.fn().mockReturnValue({
      lean: () => Promise.resolve(existing ?? null),
    }),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed') };
  const service = new AdminSeedService(
    users as unknown as Model<User>,
    passwords as unknown as PasswordService,
  );
  return { service, users, passwords };
}

describe('AdminSeedService (ACC-18)', () => {
  it('creates an active admin with a hashed password and a normalised email', async () => {
    const { service, users, passwords } = setup();

    await expect(
      service.seedAdmin({
        email: ' Admin@Example.COM ',
        password: 'Secret123',
      }),
    ).resolves.toEqual({ email: 'admin@example.com', created: true });

    expect(passwords.hash).toHaveBeenCalledWith('Secret123');
    expect(users.create).toHaveBeenCalledWith({
      name: SEEDED_ADMIN_NAME,
      email: 'admin@example.com',
      passwordHash: 'hashed',
      role: Role.Admin,
      status: AccountStatus.Active,
      mustChangePassword: false,
    });
  });

  it('leaves an existing admin unchanged when run again', async () => {
    const { service } = setup({ role: Role.Admin });
    await expect(
      service.seedAdmin({ email: 'admin@example.com', password: 'Secret123' }),
    ).resolves.toEqual({ email: 'admin@example.com', created: false });
  });

  it('never promotes an existing non-admin account', async () => {
    const { service } = setup({ role: Role.User });
    await expect(
      service.seedAdmin({ email: 'admin@example.com', password: 'Secret123' }),
    ).rejects.toThrow(/already belongs to a USER account/);
  });

  it('rejects a seed password that breaks the password rules before writing', async () => {
    const { service, users, passwords } = setup();
    for (const password of ['short1', 'lettersonly', '12345678']) {
      await expect(
        service.seedAdmin({ email: 'admin@example.com', password }),
      ).rejects.toThrow(/ADMIN_SEED_PASSWORD/);
    }
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });

  it('rethrows database errors other than a duplicate email', async () => {
    const { service, users } = setup();
    users.create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      service.seedAdmin({ email: 'admin@example.com', password: 'Secret123' }),
    ).rejects.toThrow('connection lost');
  });
});

describe('password rules (ACC-01)', () => {
  it.each([
    ['Secret12', true],
    ['abcdefg1', true],
    ['1234567a', true],
    ['Secret1', false], // 7 characters
    ['abcdefgh', false], // no digit
    ['12345678', false], // no letter
    ['', false],
  ])('%p -> %p', (password, expected) => {
    expect(meetsPasswordRules(password)).toBe(expected);
  });
});
