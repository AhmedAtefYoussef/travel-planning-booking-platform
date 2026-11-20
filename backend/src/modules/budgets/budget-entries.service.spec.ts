import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import {
  CURRENCY_SERVICE,
  REFERENCE_SERVICE,
} from '../../common/contracts/tokens';
import { AppException } from '../../common/errors/app.exception';
import { Activity, Itinerary, ItineraryVisibility } from '../itineraries';
import { BudgetsService } from './budgets.service';
import { BudgetCategory, BudgetEntry } from './schemas/budget-entry.schema';
import { TransportCost, TransportMode } from './schemas/transport-cost.schema';

/** A Mongoose query stand-in: `.lean().exec()` and `.exec()` both resolve to `value`. */
const q = <T>(value: T) => ({
  lean: () => ({ exec: () => Promise.resolve(value) }),
  exec: () => Promise.resolve(value),
});

const statusOf = async (p: Promise<unknown>) =>
  ((await p.catch((e: unknown) => e)) as AppException).getStatus();

/** ITN-14 rules, without a database: budget entries, ownership and the totals by category and day. */
describe('BudgetsService budget entries (ITN-14)', () => {
  const owner = { id: new Types.ObjectId().toHexString(), role: Role.User };
  const stranger = { id: new Types.ObjectId().toHexString(), role: Role.User };
  const day1 = new Types.ObjectId();
  const day2 = new Types.ObjectId();
  const itinerary = {
    _id: new Types.ObjectId(),
    ownerId: new Types.ObjectId(owner.id),
    startDate: '2026-12-01',
    visibility: ItineraryVisibility.Private,
    isHidden: false,
    days: [
      { _id: day2, order: 2, cityId: 'paris' },
      { _id: day1, order: 1, cityId: 'cairo' },
    ],
  };
  const entry = {
    _id: new Types.ObjectId(),
    itineraryId: itinerary._id,
    dayId: day1,
    category: BudgetCategory.Food,
    amountMinor: 500,
    currency: 'EGP',
    note: '',
  };

  const entries = {
    create: jest.fn((doc: object) =>
      Promise.resolve({ _id: entry._id, ...doc }),
    ),
    findById: jest.fn(() => q<typeof entry | null>(entry)),
    findOneAndUpdate: jest.fn((_f: object, update: { $set: object }) =>
      q<typeof entry | null>({ ...entry, ...update.$set }),
    ),
    deleteOne: jest.fn(() => q({ deletedCount: 1 })),
    find: jest.fn(() => q<unknown[]>([])),
  };
  const transports = { find: jest.fn(() => q<unknown[]>([])) };
  const activities = { find: jest.fn(() => q<unknown[]>([])) };
  const itineraries = {
    findById: jest.fn(() => q<typeof itinerary | null>(itinerary)),
  };
  const currency = {
    supportedCurrencies: jest.fn(() => Promise.resolve(['EGP', 'EUR', 'USD'])),
    convert: jest.fn((amountMinor: number) =>
      Promise.resolve({ amountMinor: amountMinor * 50 }),
    ),
  };
  const config = { get: jest.fn(() => 'EGP') };
  let service: BudgetsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BudgetsService,
        { provide: getModelToken(BudgetEntry.name), useValue: entries },
        { provide: getModelToken(TransportCost.name), useValue: transports },
        { provide: getModelToken(Itinerary.name), useValue: itineraries },
        { provide: getModelToken(Activity.name), useValue: activities },
        { provide: CURRENCY_SERVICE, useValue: currency },
        { provide: REFERENCE_SERVICE, useValue: {} },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(BudgetsService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('adds an entry for the owner on a day of the itinerary', async () => {
    const res = await service.addEntry(
      owner,
      itinerary._id.toHexString(),
      day1.toHexString(),
      { category: BudgetCategory.Food, amountMinor: 500, currency: 'EGP' },
    );
    expect(res).toMatchObject({
      category: 'FOOD',
      amountMinor: 500,
      currency: 'EGP',
      note: '',
      dayId: day1.toHexString(),
    });
  });

  it('answers 404 for a stranger or a day of another itinerary, 400 for an unsupported currency', async () => {
    const add = (who = owner, dayId = day1.toHexString(), cur = 'EGP') =>
      service.addEntry(who, itinerary._id.toHexString(), dayId, {
        category: BudgetCategory.Food,
        amountMinor: 1,
        currency: cur,
      });
    expect(await statusOf(add(stranger))).toBe(HttpStatus.NOT_FOUND);
    expect(await statusOf(add(owner, new Types.ObjectId().toHexString()))).toBe(
      HttpStatus.NOT_FOUND,
    );
    expect(await statusOf(add(owner, day1.toHexString(), 'XXX'))).toBe(
      HttpStatus.BAD_REQUEST,
    );
    expect(entries.create).not.toHaveBeenCalled();
  });

  it('updates only the fields sent, each copied on its own (no raw body in $set)', async () => {
    await service.updateEntry(owner, entry._id.toHexString(), {
      amountMinor: 900,
      note: 'dinner',
      extra: { $where: '1' },
    } as never);
    const set = entries.findOneAndUpdate.mock.calls[0][1].$set as Record<
      string,
      unknown
    >;
    expect(set).toEqual({ amountMinor: 900, note: 'dinner' });

    entries.findOneAndUpdate.mockClear();
    await service.updateEntry(owner, entry._id.toHexString(), {
      category: BudgetCategory.Accommodation,
      currency: 'EUR',
    });
    expect(entries.findOneAndUpdate.mock.calls[0][1].$set).toEqual({
      category: 'ACCOMMODATION',
      currency: 'EUR',
    });
  });

  it("answers 404 for an unknown entry, a stranger's entry, and an entry deleted meanwhile", async () => {
    entries.findById.mockReturnValueOnce(q(null));
    expect(
      await statusOf(service.updateEntry(owner, entry._id.toHexString(), {})),
    ).toBe(HttpStatus.NOT_FOUND);
    expect(
      await statusOf(service.removeEntry(stranger, entry._id.toHexString())),
    ).toBe(HttpStatus.NOT_FOUND);
    entries.findOneAndUpdate.mockReturnValueOnce(q(null));
    expect(
      await statusOf(
        service.updateEntry(owner, entry._id.toHexString(), { note: 'x' }),
      ),
    ).toBe(HttpStatus.NOT_FOUND);
    expect(entries.deleteOne).not.toHaveBeenCalled();
  });

  it('deletes the owner’s entry', async () => {
    await service.removeEntry(owner, entry._id.toHexString());
    expect(entries.deleteOne).toHaveBeenCalledWith({ _id: entry._id });
  });

  it('totals by category and day in the platform currency, converting other currencies once per group', async () => {
    entries.find.mockReturnValueOnce(
      q([
        entry,
        { ...entry, _id: new Types.ObjectId(), amountMinor: 100 },
        {
          ...entry,
          _id: new Types.ObjectId(),
          dayId: day2,
          category: BudgetCategory.Accommodation,
          amountMinor: 10,
          currency: 'EUR',
        },
        // A day no longer in the itinerary is ignored.
        { ...entry, _id: new Types.ObjectId(), dayId: new Types.ObjectId() },
      ]),
    );
    activities.find.mockReturnValueOnce(
      q([{ dayId: day1, costMinor: 300, currency: undefined }]),
    );
    transports.find.mockReturnValueOnce(
      q([
        {
          dayId: day2,
          mode: TransportMode.Train,
          amountMinor: 200,
          currency: 'EGP',
        },
      ]),
    );
    const res = await service.summary(owner, itinerary._id.toHexString());
    expect(res.currency).toBe('EGP');
    expect(res.byDay.map((d) => d.order)).toEqual([1, 2]);
    expect(res.byDay[0]).toMatchObject({
      date: '2026-12-01',
      totalMinor: 900,
    });
    expect(res.byDay[0].byCategory).toMatchObject({
      FOOD: 600,
      ACTIVITIES: 300,
    });
    expect(res.byDay[1].byCategory).toMatchObject({
      ACCOMMODATION: 500,
      INTERCITY_TRANSPORT: 200,
    });
    expect(res.totalMinor).toBe(1600);
    expect(currency.convert).toHaveBeenCalledTimes(1);
    expect(currency.convert).toHaveBeenCalledWith(10, 'EUR', 'EGP');
  });

  it('shows a public itinerary’s summary to anyone, but a private or hidden one only to its owner', async () => {
    expect(
      await statusOf(service.summary(stranger, itinerary._id.toHexString())),
    ).toBe(HttpStatus.NOT_FOUND);
    itineraries.findById.mockReturnValueOnce(
      q({ ...itinerary, visibility: ItineraryVisibility.Public }),
    );
    await expect(
      service.summary(stranger, itinerary._id.toHexString()),
    ).resolves.toMatchObject({ totalMinor: 0 });
    itineraries.findById.mockReturnValueOnce(
      q({
        ...itinerary,
        visibility: ItineraryVisibility.Public,
        isHidden: true,
      }),
    );
    expect(
      await statusOf(service.summary(stranger, itinerary._id.toHexString())),
    ).toBe(HttpStatus.NOT_FOUND);
    itineraries.findById.mockReturnValueOnce(q(null));
    expect(
      await statusOf(service.summary(owner, itinerary._id.toHexString())),
    ).toBe(HttpStatus.NOT_FOUND);
  });
});
