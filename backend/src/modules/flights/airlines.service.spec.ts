import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
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
    policy: {
      cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
      extraBaggage: undefined as
        | { pricePerBagMinor: number; maxExtraBagsPerPassenger: number }
        | undefined,
    },
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
    set(path: string, value: unknown) {
      if (path === 'policy.extraBaggage')
        this.policy.extraBaggage = value as {
          pricePerBagMinor: number;
          maxExtraBagsPerPassenger: number;
        };
      if (path === 'policy.cancellationTiers')
        this.policy.cancellationTiers = value as {
          daysBefore: number;
          refundPercent: number;
        }[];
    },
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

  it('rejects an empty edit with 400', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    await expect(
      service.update(moderatorOf(airline.id), airline.id, {}),
    ).rejects.toMatchObject({ status: 400 });
    expect(airline.save).not.toHaveBeenCalled();
  });
});

describe('AirlinesService.setBaggagePolicy (FLT-08)', () => {
  it("sets the moderator's own airline policy and returns it", async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    const dto = await service.setBaggagePolicy(
      moderatorOf(airline.id),
      airline.id,
      {
        pricePerBagMinor: 4000,
        maxExtraBagsPerPassenger: 2,
      },
    );
    expect(airline.save).toHaveBeenCalled();
    expect(dto.policy.extraBaggage).toEqual({
      pricePerBagMinor: 4000,
      maxExtraBagsPerPassenger: 2,
    });
    // The cancellation tiers are untouched.
    expect(dto.policy.cancellationTiers).toEqual([
      { daysBefore: 7, refundPercent: 50 },
    ]);
  });

  it('forbids a moderator of another airline and saves nothing', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    await expect(
      service.setBaggagePolicy(
        moderatorOf(new Types.ObjectId().toHexString()),
        airline.id,
        {
          pricePerBagMinor: 1,
          maxExtraBagsPerPassenger: 9,
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(airline.save).not.toHaveBeenCalled();
    expect(airline.policy.extraBaggage).toBeUndefined();
  });
});

describe('AirlinesService cancellation tiers (FLT-09)', () => {
  const tiers = [
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 1, refundPercent: 25 },
  ];

  it('replaces the tiers, sorted by threshold', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    const dto = await service.setCancellationPolicy(
      moderatorOf(airline.id),
      airline.id,
      { tiers },
    );
    expect(dto.policy.cancellationTiers).toEqual([
      { daysBefore: 1, refundPercent: 25 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 30, refundPercent: 100 },
    ]);
    expect(airline.save).toHaveBeenCalled();
  });

  it('accepts an empty list (no refunds)', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    const dto = await service.setCancellationPolicy(
      moderatorOf(airline.id),
      airline.id,
      { tiers: [] },
    );
    expect(dto.policy.cancellationTiers).toEqual([]);
  });

  it('rejects a repeated threshold with a field error on the repeat, saving nothing', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    const err = await service
      .setCancellationPolicy(moderatorOf(airline.id), airline.id, {
        tiers: [
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 3, refundPercent: 10 },
          { daysBefore: 7, refundPercent: 40 },
        ],
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationFailedException);
    expect((err as ValidationFailedException).fieldErrors).toEqual([
      {
        field: 'tiers[2].daysBefore',
        message:
          'daysBefore 7 is already used by tiers[0]; thresholds must be unique',
      },
    ]);
    expect(airline.save).not.toHaveBeenCalled();
  });

  it('forbids a moderator of another airline', async () => {
    const airline = fakeAirline();
    const { service } = setup(airline);
    await expect(
      service.setCancellationPolicy(
        moderatorOf(new Types.ObjectId().toHexString()),
        airline.id,
        { tiers },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(airline.save).not.toHaveBeenCalled();
  });

  it.each([
    [45, 30, 100],
    [30, 30, 100],
    [29, 7, 50],
    [7, 7, 50],
    [6, 1, 25],
    [1, 1, 25],
  ])(
    'with %i days left uses the %i-day tier (%i%%): highest threshold not exceeding the days',
    async (daysRemaining, daysBefore, refundPercent) => {
      const airline = fakeAirline();
      airline.policy.cancellationTiers = tiers;
      const { service } = setup(airline);
      expect(await service.previewRefund(airline.id, daysRemaining)).toEqual({
        daysRemaining,
        tierApplied: { daysBefore, refundPercent },
        refundPercent,
      });
    },
  );

  it('refunds 0% when no tier applies, or when there are no tiers', async () => {
    const airline = fakeAirline();
    airline.policy.cancellationTiers = tiers;
    const { service } = setup(airline);
    expect(await service.previewRefund(airline.id, 0)).toEqual({
      daysRemaining: 0,
      tierApplied: null,
      refundPercent: 0,
    });
    airline.policy.cancellationTiers = [];
    expect((await service.previewRefund(airline.id, 100)).refundPercent).toBe(
      0,
    );
  });

  it('returns 404 for an unknown airline', async () => {
    const { service } = setup(null);
    await expect(
      service.previewRefund(new Types.ObjectId().toHexString(), 3),
    ).rejects.toBeInstanceOf(AppException);
  });
});
