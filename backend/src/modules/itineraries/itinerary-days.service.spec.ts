import { Types, type Connection, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type {
  ItineraryBudgets,
  ReferenceService,
} from '../../common/contracts/services.contract';
import type { ItinerariesService } from './itineraries.service';
import { ItineraryDaysService } from './itinerary-days.service';
import type { Activity } from './schemas/activity.schema';
import type { Itinerary } from './schemas/itinerary.schema';

const query = <T>(value: T) => {
  const q = { lean: () => q, exec: () => Promise.resolve(value) };
  return q;
};

const user: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.User,
};

function storedWithDays(cities: string[]) {
  const _id = new Types.ObjectId();
  return {
    _id,
    id: _id.toHexString(),
    ownerId: new Types.ObjectId(user.id),
    __v: 4,
    days: cities.map((cityId, i) => ({
      _id: new Types.ObjectId(),
      order: i + 1,
      cityId,
      notes: '',
    })),
  };
}

type Stored = ReturnType<typeof storedWithDays>;

function setup(
  stored: Stored,
  opts: { conflicts?: number; budgets?: boolean; images?: string[] } = {},
) {
  let conflicts = opts.conflicts ?? 0;
  const itineraries = {
    findOneAndUpdate: jest.fn(
      (_filter: unknown, update: { $set: { days: unknown[] } }) => {
        if (conflicts > 0) {
          conflicts -= 1;
          return query(null);
        }
        return query({ ...stored, days: update.$set.days });
      },
    ),
  };
  const activities = {
    find: jest.fn(() => query([{ images: opts.images ?? [] }])),
    deleteMany: jest.fn(() => query({ deletedCount: 1 })),
  };
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    endSession: jest.fn(() => Promise.resolve()),
  };
  const connection = { startSession: jest.fn(() => Promise.resolve(session)) };
  const itineraryService = {
    loadOwned: jest.fn(() => Promise.resolve(stored)),
    toDetail: jest.fn((doc: unknown) => Promise.resolve(doc)),
    deleteUnusedImages: jest.fn(() => Promise.resolve()),
  };
  const reference = {
    getCity: jest.fn((cityId: string) =>
      Promise.resolve(
        ['cairo', 'dubai'].includes(cityId)
          ? { cityId, name: cityId, countryCode: 'EG' }
          : null,
      ),
    ),
  } as unknown as ReferenceService;
  const budgets = {
    deleteForDays: jest.fn(() => Promise.resolve()),
  } as unknown as ItineraryBudgets;
  const service = new ItineraryDaysService(
    itineraries as unknown as Model<Itinerary>,
    activities as unknown as Model<Activity>,
    itineraryService as unknown as ItinerariesService,
    reference,
    connection as unknown as Connection,
    opts.budgets ? budgets : undefined,
  );
  const writtenDays = (call = 0) =>
    (
      itineraries.findOneAndUpdate.mock.calls[call][1] as {
        $set: { days: { order: number; cityId: string; notes: string }[] };
      }
    ).$set.days;
  return {
    service,
    itineraries,
    activities,
    itineraryService,
    budgets,
    session,
    writtenDays,
  };
}

describe('ItineraryDaysService (ITN-05, ITN-07, ITN-08)', () => {
  it('ITN-05: appends the next day number, guarded by the revision', async () => {
    const stored = storedWithDays(['cairo']);
    const { service, itineraries, writtenDays } = setup(stored);
    await service.addDay(user, stored.id, { cityId: 'dubai' });
    expect(writtenDays().map((d) => [d.order, d.cityId, d.notes])).toEqual([
      [1, 'cairo', ''],
      [2, 'dubai', ''],
    ]);
    expect(itineraries.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      _id: stored._id,
      __v: 4,
    });
    expect(itineraries.findOneAndUpdate.mock.calls[0][1]).toMatchObject({
      $inc: { __v: 1 },
    });
  });

  it('ITN-05: rejects the 61st day and an unknown city', async () => {
    const full = storedWithDays(Array.from({ length: 60 }, () => 'cairo'));
    await expect(
      setup(full).service.addDay(user, full.id, { cityId: 'cairo' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'ITINERARY_DAY_LIMIT',
    });
    const stored = storedWithDays([]);
    const { service, itineraries } = setup(stored);
    await expect(
      service.addDay(user, stored.id, { cityId: 'atlantis' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(itineraries.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('retries a lost race and gives up with 409 after three attempts', async () => {
    const stored = storedWithDays(['cairo']);
    const retried = setup(stored, { conflicts: 2 });
    await retried.service.addDay(user, stored.id, { cityId: 'cairo' });
    expect(retried.itineraries.findOneAndUpdate).toHaveBeenCalledTimes(3);
    expect(retried.itineraryService.loadOwned).toHaveBeenCalledTimes(3);

    const lost = setup(stored, { conflicts: 3 });
    await expect(
      lost.service.addDay(user, stored.id, { cityId: 'cairo' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('ITN-05: edits the city or notes of one day only', async () => {
    const stored = storedWithDays(['cairo', 'cairo']);
    const { service, writtenDays } = setup(stored);
    await service.updateDay(user, stored.id, stored.days[1]._id.toHexString(), {
      notes: 'Late check-out',
    });
    expect(writtenDays().map((d) => [d.cityId, d.notes])).toEqual([
      ['cairo', ''],
      ['cairo', 'Late check-out'],
    ]);
  });

  it('ITN-05: an empty edit, an unknown city and an unknown day are rejected', async () => {
    const stored = storedWithDays(['cairo']);
    const dayId = stored.days[0]._id.toHexString();
    const { service } = setup(stored);
    await expect(
      service.updateDay(user, stored.id, dayId, {}),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.updateDay(user, stored.id, dayId, { cityId: 'atlantis' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.updateDay(user, stored.id, new Types.ObjectId().toHexString(), {
        cityId: 'dubai',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('ITN-07: deletes the day, renumbers and removes its activities, images and budget rows', async () => {
    const stored = storedWithDays(['cairo', 'dubai', 'cairo']);
    const dayId = stored.days[1]._id.toHexString();
    const {
      service,
      itineraries,
      writtenDays,
      activities,
      budgets,
      itineraryService,
      session,
    } = setup(stored, { budgets: true, images: ['/uploads/activities/a.jpg'] });
    await service.deleteDay(user, stored.id, dayId);
    expect(writtenDays().map((d) => [d.order, d.cityId])).toEqual([
      [1, 'cairo'],
      [2, 'cairo'],
    ]);
    // The day list and the day's activities change in the same transaction.
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(
      (itineraries.findOneAndUpdate.mock.calls[0] as unknown[])[2],
    ).toMatchObject({
      session,
    });
    expect(activities.deleteMany).toHaveBeenCalledWith(
      { itineraryId: stored._id, dayId: new Types.ObjectId(dayId) },
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
    expect(budgets.deleteForDays).toHaveBeenCalledWith(stored.id, [dayId]);
    expect(itineraryService.deleteUnusedImages).toHaveBeenCalledWith([
      '/uploads/activities/a.jpg',
    ]);
  });

  it('ITN-07: an unknown day or a failed transaction deletes no budget rows or files', async () => {
    const stored = storedWithDays(['cairo']);
    const unknown = setup(stored, { budgets: true });
    await expect(
      unknown.service.deleteDay(
        user,
        stored.id,
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(unknown.activities.deleteMany).not.toHaveBeenCalled();
    expect(unknown.session.endSession).toHaveBeenCalled();

    const failing = setup(stored, { budgets: true, images: ['/x.jpg'] });
    failing.activities.deleteMany.mockImplementation(() => {
      throw new Error('crash');
    });
    await expect(
      failing.service.deleteDay(
        user,
        stored.id,
        stored.days[0]._id.toHexString(),
      ),
    ).rejects.toThrow('crash');
    expect(failing.budgets.deleteForDays).not.toHaveBeenCalled();
    expect(failing.itineraryService.deleteUnusedImages).not.toHaveBeenCalled();
  });

  it('ITN-07: works without the budgets port', async () => {
    const stored = storedWithDays(['cairo']);
    const { service } = setup(stored);
    await expect(
      service.deleteDay(user, stored.id, stored.days[0]._id.toHexString()),
    ).resolves.toBeDefined();
  });

  it('ITN-08: moves a day and renumbers every day', async () => {
    const stored = storedWithDays(['cairo', 'dubai', 'cairo']);
    const { service, writtenDays } = setup(stored);
    await service.moveDay(user, stored.id, {
      dayId: stored.days[0]._id.toHexString(),
      position: 3,
    });
    expect(writtenDays().map((d) => [d.order, d.cityId])).toEqual([
      [1, 'dubai'],
      [2, 'cairo'],
      [3, 'cairo'],
    ]);
  });

  it('ITN-08: a position past the last day is a field error', async () => {
    const stored = storedWithDays(['cairo', 'dubai']);
    const { service, itineraries } = setup(stored);
    await expect(
      service.moveDay(user, stored.id, {
        dayId: stored.days[0]._id.toHexString(),
        position: 3,
      }),
    ).rejects.toMatchObject({
      status: 400,
      fieldErrors: [expect.objectContaining({ field: 'position' })],
    });
    expect(itineraries.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
