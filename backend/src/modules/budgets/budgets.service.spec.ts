import { HttpStatus } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import {
  CURRENCY_SERVICE,
  REFERENCE_SERVICE,
} from '../../common/contracts/tokens';
import { AppException } from '../../common/errors/app.exception';
import { Itinerary } from '../itineraries';
import { BudgetsService } from './budgets.service';
import { TransportCost, TransportMode } from './schemas/transport-cost.schema';

/** A Mongoose query stand-in: `.lean().exec()` and `.exec()` both resolve to `value`. */
const q = <T>(value: T) => ({
  lean: () => ({ exec: () => Promise.resolve(value) }),
  exec: () => Promise.resolve(value),
});

/** ITN-16 rules, without a database: ownership, the day, the cities, the currency and the update. */
describe('BudgetsService (ITN-16)', () => {
  const owner = { id: new Types.ObjectId().toHexString(), role: Role.User };
  const stranger = { id: new Types.ObjectId().toHexString(), role: Role.User };
  const day = new Types.ObjectId();
  const itinerary = {
    _id: new Types.ObjectId(),
    ownerId: new Types.ObjectId(owner.id),
    days: [{ _id: day, order: 1, cityId: 'cairo' }],
  };
  const cost = {
    _id: new Types.ObjectId(),
    itineraryId: itinerary._id,
    dayId: day,
    mode: TransportMode.Train,
    fromCityId: 'cairo',
    toCityId: 'paris',
    amountMinor: 100,
    currency: 'EGP',
  };
  const transports = {
    create: jest.fn((doc: object) =>
      Promise.resolve({ _id: cost._id, ...doc }),
    ),
    findById: jest.fn(() => q<typeof cost | null>(cost)),
    findOneAndUpdate: jest.fn((_f: object, update: { $set: object }) =>
      q({ ...cost, ...update.$set }),
    ),
    deleteOne: jest.fn(() => q({ deletedCount: 1 })),
  };
  const itineraries = {
    findById: jest.fn(() => q<typeof itinerary | null>(itinerary)),
  };
  const currency = {
    supportedCurrencies: jest.fn(() => Promise.resolve(['EGP', 'EUR', 'USD'])),
  };
  const reference = {
    getCity: jest.fn((id: string) =>
      Promise.resolve(['cairo', 'paris'].includes(id) ? { cityId: id } : null),
    ),
  };
  let service: BudgetsService;
  const body = {
    dayId: day.toHexString(),
    mode: TransportMode.Bus,
    fromCityId: 'cairo',
    toCityId: 'paris',
    amountMinor: 1500,
    currency: 'EGP',
  };
  const fieldsOf = async (p: Promise<unknown>) => {
    const err = (await p.catch((e: unknown) => e)) as AppException;
    expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    return (
      err.getResponse() as { fieldErrors: { field: string }[] }
    ).fieldErrors.map((f) => f.field);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BudgetsService,
        { provide: getModelToken(TransportCost.name), useValue: transports },
        { provide: getModelToken(Itinerary.name), useValue: itineraries },
        { provide: CURRENCY_SERVICE, useValue: currency },
        { provide: REFERENCE_SERVICE, useValue: reference },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    service = moduleRef.get(BudgetsService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('adds a cost for the owner on a day of the itinerary', async () => {
    const res = await service.addTransport(
      owner,
      itinerary._id.toHexString(),
      body,
    );
    expect(res).toMatchObject({
      mode: 'BUS',
      amountMinor: 1500,
      dayId: body.dayId,
    });
  });

  it('answers 404 to anyone but the owner, and for an unknown itinerary', async () => {
    await expect(
      service.addTransport(stranger, itinerary._id.toHexString(), body),
    ).rejects.toMatchObject({ status: 404 });
    itineraries.findById.mockReturnValueOnce(q(null));
    await expect(
      service.addTransport(owner, itinerary._id.toHexString(), body),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a day of another itinerary, unknown or equal cities and unsupported currencies', async () => {
    const id = itinerary._id.toHexString();
    expect(
      await fieldsOf(
        service.addTransport(owner, id, {
          ...body,
          dayId: new Types.ObjectId().toHexString(),
        }),
      ),
    ).toEqual(['dayId']);
    expect(
      await fieldsOf(
        service.addTransport(owner, id, {
          ...body,
          fromCityId: 'atlantis',
          toCityId: 'nowhere',
        }),
      ),
    ).toEqual(['fromCityId', 'toCityId']);
    expect(
      await fieldsOf(
        service.addTransport(owner, id, { ...body, toCityId: 'cairo' }),
      ),
    ).toEqual(['toCityId']);
    expect(
      await fieldsOf(
        service.addTransport(owner, id, { ...body, currency: 'XYZ' }),
      ),
    ).toEqual(['currency']);
  });

  it('updates only the fields sent, each copied on its own (no raw body in $set)', async () => {
    await service.updateTransport(owner, cost._id.toHexString(), {
      mode: TransportMode.Ferry,
      amountMinor: 900,
    });
    const set = transports.findOneAndUpdate.mock.calls[0][1].$set as Record<
      string,
      unknown
    >;
    expect(set).toEqual({ mode: 'FERRY', amountMinor: 900 });
  });

  it('checks the route against the stored city when only one city changes', async () => {
    expect(
      await fieldsOf(
        service.updateTransport(owner, cost._id.toHexString(), {
          toCityId: 'cairo',
        }),
      ),
    ).toEqual(['toCityId']);
    await service.updateTransport(owner, cost._id.toHexString(), {
      dayId: day.toHexString(),
      fromCityId: 'paris',
      toCityId: 'cairo',
      currency: 'EUR',
    });
    const set = transports.findOneAndUpdate.mock.calls[0][1].$set as Record<
      string,
      unknown
    >;
    expect(set).toMatchObject({
      fromCityId: 'paris',
      toCityId: 'cairo',
      currency: 'EUR',
    });
    expect(String(set.dayId)).toBe(day.toHexString());
  });

  it('answers 404 for an unknown cost, a stranger, or a cost deleted meanwhile', async () => {
    transports.findById.mockReturnValueOnce(q(null));
    await expect(
      service.updateTransport(owner, cost._id.toHexString(), {
        amountMinor: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.updateTransport(stranger, cost._id.toHexString(), {
        amountMinor: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    transports.findOneAndUpdate.mockReturnValueOnce(q(null) as never);
    await expect(
      service.updateTransport(owner, cost._id.toHexString(), {
        amountMinor: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deletes for the owner only', async () => {
    await service.removeTransport(owner, cost._id.toHexString());
    expect(transports.deleteOne).toHaveBeenCalledWith({ _id: cost._id });
    await expect(
      service.removeTransport(stranger, cost._id.toHexString()),
    ).rejects.toMatchObject({ status: 404 });
    transports.findById.mockReturnValueOnce(q(null));
    await expect(
      service.removeTransport(owner, cost._id.toHexString()),
    ).rejects.toMatchObject({ status: 404 });
  });
});
