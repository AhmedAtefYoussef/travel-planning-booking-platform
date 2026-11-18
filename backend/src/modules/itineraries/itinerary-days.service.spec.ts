import { Types, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type { ReferenceService } from '../../common/contracts/services.contract';
import type { ItinerariesService } from './itineraries.service';
import { ItineraryDaysService } from './itinerary-days.service';
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

function setup(stored: Stored, opts: { conflicts?: number } = {}) {
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
  const itineraryService = {
    loadOwned: jest.fn(() => Promise.resolve(stored)),
    toDetail: jest.fn((doc: unknown) => Promise.resolve(doc)),
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
  const service = new ItineraryDaysService(
    itineraries as unknown as Model<Itinerary>,
    itineraryService as unknown as ItinerariesService,
    reference,
  );
  const writtenDays = (call = 0) =>
    (
      itineraries.findOneAndUpdate.mock.calls[call][1] as {
        $set: { days: { order: number; cityId: string; notes: string }[] };
      }
    ).$set.days;
  return { service, itineraries, itineraryService, writtenDays };
}

describe('ItineraryDaysService (ITN-05)', () => {
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
});
