import { Types, type Model } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import type { ReferenceService } from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ProfileService } from './profile.service';
import { AccountStatus, type User } from './schemas/user.schema';

const id = new Types.ObjectId();
const caller = { id: id.toHexString(), role: Role.User };
const doc = (overrides: Partial<User> = {}) => ({
  _id: id,
  name: 'Mona Hassan',
  email: 'mona@example.com',
  role: Role.User,
  status: AccountStatus.Active,
  mustChangePassword: false,
  createdAt: new Date('2026-11-11T10:00:00Z'),
  ...overrides,
});

function setup(found: unknown = doc()) {
  const users = {
    findById: jest.fn().mockResolvedValue(found),
    findByIdAndUpdate: jest
      .fn()
      .mockImplementation(
        (_id: unknown, update: { $set: Partial<User> }) =>
          found && Promise.resolve(doc(update.$set)),
      ),
  };
  const reference = {
    listCountries: jest.fn().mockResolvedValue([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'FR', name: 'France', currency: 'EUR' },
      { code: 'DE', name: 'Germany', currency: 'EUR' },
    ]),
  };
  const service = new ProfileService(
    users as unknown as Model<User>,
    reference as unknown as ReferenceService,
  );
  return { service, users, reference };
}

async function failure(promise: Promise<unknown>): Promise<AppException> {
  const e = await promise.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(AppException);
  return e as AppException;
}

describe('ProfileService (ACC-09)', () => {
  it('returns the caller own profile, or 401 when the account is gone', async () => {
    await expect(setup().service.get(caller)).resolves.toMatchObject({
      id: id.toHexString(),
      email: 'mona@example.com',
    });
    expect((await failure(setup(null).service.get(caller))).getStatus()).toBe(
      401,
    );
    expect(
      (
        await failure(setup().service.get({ id: 'x', role: Role.User }))
      ).getStatus(),
    ).toBe(401);
  });

  it('saves only the sent fields, in one validated update', async () => {
    const { service, users } = setup();
    const profile = await service.update(caller, {
      phone: '+201001234567',
      preferredCurrency: 'EUR',
    });
    expect(users.findByIdAndUpdate).toHaveBeenCalledWith(
      caller.id,
      { $set: { phone: '+201001234567', preferredCurrency: 'EUR' } },
      { new: true, runValidators: true },
    );
    expect(profile).toMatchObject({
      name: 'Mona Hassan',
      phone: '+201001234567',
      preferredCurrency: 'EUR',
    });
  });

  it('rejects an unsupported currency with a field error and saves nothing', async () => {
    const { service, users } = setup();
    const e = await failure(
      service.update(caller, { name: 'New Name', preferredCurrency: 'CHF' }),
    );
    expect(e.getStatus()).toBe(400);
    expect(e.fieldErrors).toEqual([
      {
        field: 'preferredCurrency',
        message: 'preferredCurrency must be one of EGP, EUR',
      },
    ]);
    expect(users.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('does not query the reference data when the currency is not being changed', async () => {
    const { service, reference } = setup();
    await service.update(caller, { name: 'New Name' });
    expect(reference.listCountries).not.toHaveBeenCalled();
  });

  it('rejects an empty update', async () => {
    const { service, users } = setup();
    const e = await failure(service.update(caller, {}));
    expect(e.getStatus()).toBe(400);
    expect(e.message).toMatch(/at least one/);
    expect(users.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('is 401 when the account disappeared before the update', async () => {
    expect(
      (
        await failure(setup(null).service.update(caller, { name: 'X' }))
      ).getStatus(),
    ).toBe(401);
  });
});
