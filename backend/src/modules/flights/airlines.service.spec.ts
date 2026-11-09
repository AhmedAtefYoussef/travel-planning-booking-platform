import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { AirlinesService } from './airlines.service';
import type { Airline } from './schemas/airline.schema';

const airlineId = new Types.ObjectId();
const now = new Date('2026-11-08T10:00:00Z');

function fakeAirline() {
  return {
    _id: airlineId,
    id: airlineId.toHexString(),
    name: 'EgyptAir',
    code: 'MS',
    logoUrl: null as string | null,
    isActive: true,
    policy: { cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }] },
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function setup(found: ReturnType<typeof fakeAirline> | null) {
  const model = {
    findById: jest.fn(() => ({ exec: () => Promise.resolve(found) })),
    create: jest.fn((doc: object) =>
      Promise.resolve({ ...fakeAirline(), ...doc }),
    ),
  };
  return {
    model,
    service: new AirlinesService(model as unknown as Model<Airline>),
  };
}

const moderatorOf = (id: string): AuthUser => ({
  id: new Types.ObjectId().toHexString(),
  role: Role.AirlineModerator,
  assignedProvider: { type: ProviderType.Airline, providerId: id },
});

describe('AirlinesService (FLT-01)', () => {
  it('creates an airline with a null logo when none is given', async () => {
    const { service, model } = setup(null);
    const dto = await service.create({ name: 'EgyptAir', code: 'MS' });
    expect(model.create).toHaveBeenCalledWith({
      name: 'EgyptAir',
      code: 'MS',
      logoUrl: null,
    });
    expect(dto).toMatchObject({ name: 'EgyptAir', code: 'MS', logoUrl: null });
    expect(dto.policy).toEqual({
      cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
      extraBaggage: null,
    });
  });

  it('returns 404 for an unknown airline', async () => {
    const { service } = setup(null);
    await expect(
      service.findById(new Types.ObjectId().toHexString()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lets the assigned moderator change name, code and logo', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    const dto = await service.update(moderatorOf(airline.id), airline.id, {
      name: 'EgyptAir Express',
      code: 'MX',
      logoUrl: 'https://cdn.example.com/ms.png',
    });
    expect(airline.save).toHaveBeenCalled();
    expect(dto).toMatchObject({
      name: 'EgyptAir Express',
      code: 'MX',
      logoUrl: 'https://cdn.example.com/ms.png',
    });
  });

  it('forbids a moderator of another airline, and saves nothing (ACC-11)', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    const other = moderatorOf(new Types.ObjectId().toHexString());
    await expect(
      service.update(other, airline.id, { name: 'Hijacked' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(airline.save).not.toHaveBeenCalled();
    expect(airline.name).toBe('EgyptAir');
  });

  it('forbids an admin from editing: FLT-01 gives editing to the moderator', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    const admin: AuthUser = {
      id: new Types.ObjectId().toHexString(),
      role: Role.Admin,
    };
    await expect(
      service.update(admin, airline.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('removes the logo when logoUrl is null', async () => {
    const airline = fakeAirline();
    airline.logoUrl = 'https://cdn.example.com/a.png';
    const { service } = setup(airline);
    const dto = await service.update(moderatorOf(airline.id), airline.id, {
      logoUrl: null,
    });
    expect(dto.logoUrl).toBeNull();
    expect(airline.save).toHaveBeenCalled();
  });

  it('rejects an empty edit with 400', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    await expect(
      service.update(moderatorOf(airline.id), airline.id, {}),
    ).rejects.toMatchObject({ status: 400 });
    expect(airline.save).not.toHaveBeenCalled();
  });
});
