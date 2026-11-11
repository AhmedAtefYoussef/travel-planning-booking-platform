import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Types, type Connection, type Model } from 'mongoose';
import { ProviderType, Role } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import type { PasswordService } from '../../common/security/password.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ModeratorsService } from './moderators.service';
import {
  PROVIDER_COLLECTIONS,
  ProviderDirectoryService,
} from './provider-directory.service';
import { AccountStatus, type User } from './schemas/user.schema';

const ADMIN = { id: new Types.ObjectId().toHexString(), role: Role.Admin };
const PROVIDER = new Types.ObjectId().toHexString();
const SESSION = { id: 'mongo-session' };
const dto = (
  overrides: Partial<CreateModeratorDto> = {},
): CreateModeratorDto => ({
  name: 'EgyptAir Ops',
  email: 'ops@egyptair.example',
  role: Role.AirlineModerator,
  providerId: PROVIDER,
  temporaryPassword: 'Temp2026x',
  ...overrides,
});

function setup(provider: { name: string } | null = { name: 'EgyptAir' }) {
  const newId = new Types.ObjectId();
  const users = {
    create: jest
      .fn()
      .mockImplementation(([doc]: [Partial<User>]) =>
        Promise.resolve([
          { ...doc, _id: newId, createdAt: new Date('2026-11-11T10:00:00Z') },
        ]),
      ),
  };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) => fn(SESSION)),
  };
  const providers = {
    find: jest
      .fn()
      .mockResolvedValue(
        provider && { id: PROVIDER, isActive: true, ...provider },
      ),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('temp-hash') };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ModeratorsService(
    users as unknown as Model<User>,
    connection as unknown as Connection,
    providers as unknown as ProviderDirectoryService,
    passwords as unknown as PasswordService,
    audit,
  );
  return { service, users, providers, audit, newId };
}

async function failure(promise: Promise<unknown>): Promise<AppException> {
  const e = await promise.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(AppException);
  return e as AppException;
}

describe('ModeratorsService.create (ACC-13)', () => {
  it('creates a moderator linked to the existing provider, forced to change the password, audited in the transaction', async () => {
    const { service, users, providers, audit, newId } = setup();
    const profile = await service.create(ADMIN, dto());

    expect(providers.find).toHaveBeenCalledWith(
      ProviderType.Airline,
      PROVIDER,
      SESSION,
    );
    expect(users.create).toHaveBeenCalledWith(
      [
        {
          name: 'EgyptAir Ops',
          email: 'ops@egyptair.example',
          passwordHash: 'temp-hash',
          role: Role.AirlineModerator,
          status: AccountStatus.Active,
          mustChangePassword: true,
          assignedProvider: {
            type: ProviderType.Airline,
            providerId: new Types.ObjectId(PROVIDER),
          },
        },
      ],
      { session: SESSION },
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        actor: ADMIN,
        action: 'CREATE_MODERATOR',
        targetType: 'USER',
        targetId: newId.toHexString(),
        metadata: {
          role: Role.AirlineModerator,
          providerType: ProviderType.Airline,
          providerId: PROVIDER,
          providerName: 'EgyptAir',
        },
      },
      SESSION,
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(
      /Temp2026x|temp-hash/,
    );
    expect(profile).toMatchObject({
      id: newId.toHexString(),
      role: Role.AirlineModerator,
      mustChangePassword: true,
      assignedProvider: { type: ProviderType.Airline, providerId: PROVIDER },
    });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('looks the provider up by the type the role implies', async () => {
    const { service, providers } = setup({ name: 'Nile Hotel' });
    await service.create(ADMIN, dto({ role: Role.HotelModerator }));
    expect(providers.find).toHaveBeenCalledWith(
      ProviderType.Hotel,
      PROVIDER,
      SESSION,
    );
  });

  it('is 404 with a providerId field error when the provider does not exist, and creates nothing', async () => {
    const { service, users, audit } = setup(null);
    const e = await failure(
      service.create(ADMIN, dto({ role: Role.HotelModerator })),
    );
    expect(e.getStatus()).toBe(404);
    expect(e.message).toBe('Hotel not found');
    expect(e.fieldErrors).toEqual([
      { field: 'providerId', message: 'no hotel has this id' },
    ]);
    expect(users.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('turns a duplicate email into 409 EMAIL_ALREADY_REGISTERED', async () => {
    const { service, users } = setup();
    users.create.mockRejectedValue(
      Object.assign(new Error('E11000'), { code: 11000 }),
    );
    const e = await failure(service.create(ADMIN, dto()));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rethrows other errors (e.g. the audit write failing aborts the creation)', async () => {
    const { service, audit } = setup();
    audit.record.mockRejectedValue(new Error('audit down'));
    await expect(service.create(ADMIN, dto())).rejects.toThrow('audit down');
  });
});

describe('ModeratorsService.create with a deactivated provider (ACC-13, ACC-15)', () => {
  it('refuses with 409 PROVIDER_INACTIVE and creates nothing', async () => {
    const { service, users, providers, audit } = setup();
    providers.find.mockResolvedValue({
      id: PROVIDER,
      name: 'Old Air',
      isActive: false,
    });
    const e = await failure(service.create(ADMIN, dto()));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('PROVIDER_INACTIVE');
    expect(e.message).toMatch(/airline is deactivated/);
    expect(e.fieldErrors).toEqual([
      { field: 'providerId', message: 'the airline is deactivated' },
    ]);
    expect(users.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ProviderDirectoryService (ACC-13)', () => {
  function directory(doc: unknown) {
    const findOne = jest.fn().mockResolvedValue(doc);
    const collection = jest.fn().mockReturnValue({ findOne });
    const service = new ProviderDirectoryService({
      collection,
    } as unknown as Connection);
    return { service, collection, findOne };
  }

  it('reads the ERD collection for the type, by id', async () => {
    const { service, collection, findOne } = directory({
      name: 'EgyptAir',
      isActive: false,
    });
    await expect(service.find(ProviderType.Airline, PROVIDER)).resolves.toEqual(
      {
        id: PROVIDER,
        name: 'EgyptAir',
        isActive: false,
      },
    );
    expect(collection).toHaveBeenCalledWith('airlines');
    expect(findOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(PROVIDER) },
      { projection: { name: 1, isActive: 1 }, session: undefined },
    );
    expect(PROVIDER_COLLECTIONS[ProviderType.Hotel]).toBe('hotels');
  });

  it('returns null for a missing provider or a malformed id', async () => {
    await expect(
      directory(null).service.find(ProviderType.Hotel, PROVIDER),
    ).resolves.toBeNull();
    const { service, collection } = directory({ name: 'x' });
    await expect(service.find(ProviderType.Hotel, 'bad')).resolves.toBeNull();
    expect(collection).not.toHaveBeenCalled();
  });
});

describe('CreateModeratorDto (ACC-13)', () => {
  const failing = (body: object) =>
    validateSync(plainToInstance(CreateModeratorDto, body)).map(
      (e) => e.property,
    );
  const valid = { ...dto() };

  it('accepts a valid body and normalises role and email', () => {
    const parsed = plainToInstance(CreateModeratorDto, {
      ...valid,
      role: 'hotel_moderator',
      email: ' Ops@EgyptAir.Example ',
    });
    expect(validateSync(parsed)).toEqual([]);
    expect(parsed.role).toBe(Role.HotelModerator);
    expect(parsed.email).toBe('ops@egyptair.example');
  });

  it.each([Role.User, Role.Admin, 'ROOT'])('rejects the role %p', (role) => {
    expect(failing({ ...valid, role })).toEqual(['role']);
  });

  it('rejects a malformed provider id, a weak password and a missing name', () => {
    expect(failing({ ...valid, providerId: 'x' })).toEqual(['providerId']);
    expect(failing({ ...valid, temporaryPassword: 'temp' })).toEqual([
      'temporaryPassword',
    ]);
    expect(failing({ ...valid, name: ' ' })).toEqual(['name']);
  });
});
