import { Types, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type {
  ItineraryBudgets,
  ReferenceService,
  UploadsService,
} from '../../common/contracts/services.contract';
import { AppException } from '../../common/errors/app.exception';
import { ItinerariesService, ITINERARY_NOT_FOUND } from './itineraries.service';
import type { Activity } from './schemas/activity.schema';
import {
  ItineraryVisibility,
  type Itinerary,
} from './schemas/itinerary.schema';

/** A Mongoose query stand-in: chainable sort/lean, resolved by exec(). */
const query = <T>(value: T) => {
  const q = {
    sort: () => q,
    lean: () => q,
    exec: () => Promise.resolve(value),
  };
  return q;
};

const ownerId = new Types.ObjectId();
const owner: AuthUser = { id: ownerId.toHexString(), role: Role.User };
const stranger: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.User,
};

function storedItinerary(over: Partial<Record<string, unknown>> = {}) {
  const _id = new Types.ObjectId();
  return {
    _id,
    id: _id.toHexString(),
    ownerId,
    title: 'Ten days in Egypt',
    countries: ['EG'],
    startDate: '2027-03-01',
    visibility: ItineraryVisibility.Private,
    days: [
      { _id: new Types.ObjectId(), order: 1, cityId: 'cairo', notes: '' },
      { _id: new Types.ObjectId(), order: 2, cityId: 'luxor', notes: 'Nile' },
    ],
    isHidden: false,
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-02'),
    ...over,
  };
}

function setup(
  stored: ReturnType<typeof storedItinerary> | null,
  opts: {
    activities?: Partial<Activity & { _id: Types.ObjectId }>[];
    sharedUrls?: string[];
    budgets?: boolean;
    deletedCount?: number;
    updateResult?: unknown;
  } = {},
) {
  const itineraries = {
    create: jest.fn((doc: Record<string, unknown>) => {
      const created = { ...storedItinerary(), ...doc };
      return Promise.resolve({ ...created, toObject: () => created });
    }),
    findById: jest.fn(() => query(stored)),
    findOneAndUpdate: jest.fn(() =>
      query(opts.updateResult !== undefined ? opts.updateResult : stored),
    ),
    deleteOne: jest.fn(() =>
      query({ deletedCount: opts.deletedCount ?? (stored ? 1 : 0) }),
    ),
    find: jest.fn(() => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({ lean: () => query(stored ? [stored] : []) }),
        }),
      }),
    })),
    countDocuments: jest.fn(() => query(stored ? 1 : 0)),
  };
  const activities = {
    find: jest.fn(() => query(opts.activities ?? [])),
    deleteMany: jest.fn(() => query({ deletedCount: 0 })),
    exists: jest.fn((filter: { images: string }) =>
      query(
        (opts.sharedUrls ?? []).includes(filter.images)
          ? { _id: new Types.ObjectId() }
          : null,
      ),
    ),
  };
  const reference = {
    getCountry: jest.fn((code: string) =>
      Promise.resolve(
        ['EG', 'AE'].includes(code)
          ? { code, name: code, currency: 'X' }
          : null,
      ),
    ),
    getCity: jest.fn((cityId: string) =>
      Promise.resolve(
        cityId === 'cairo'
          ? { cityId, name: 'Cairo', countryCode: 'EG' }
          : null,
      ),
    ),
  } as unknown as ReferenceService;
  const uploads = {
    deleteImage: jest.fn(() => Promise.resolve()),
  } as unknown as UploadsService;
  const budgets = {
    deleteForItinerary: jest.fn(() => Promise.resolve()),
  } as unknown as ItineraryBudgets;
  const service = new ItinerariesService(
    itineraries as unknown as Model<Itinerary>,
    activities as unknown as Model<Activity>,
    reference,
    uploads,
    opts.budgets ? budgets : undefined,
  );
  return { service, itineraries, activities, reference, uploads, budgets };
}

describe('ItinerariesService (ITN-01, ITN-03, ITN-20)', () => {
  describe('create (ITN-01)', () => {
    it('stores the itinerary private by default for the caller', async () => {
      const { service, itineraries } = setup(null);
      const res = await service.create(owner, {
        title: 'Trip',
        countries: ['EG'],
        startDate: '2027-03-01',
      });
      const stored = itineraries.create.mock.calls[0][0];
      expect(stored).toMatchObject({
        title: 'Trip',
        visibility: ItineraryVisibility.Private,
        days: [],
      });
      expect(String(stored.ownerId)).toBe(owner.id);
      expect(res.visibility).toBe(ItineraryVisibility.Private);
    });

    it('rejects every unknown country with its own field error', async () => {
      const { service, itineraries } = setup(null);
      await expect(
        service.create(owner, {
          title: 'Trip',
          countries: ['XX', 'EG', 'YY'],
          startDate: '2027-03-01',
        }),
      ).rejects.toMatchObject({
        fieldErrors: [
          expect.objectContaining({ field: 'countries[0]' }),
          expect.objectContaining({ field: 'countries[2]' }),
        ],
      });
      expect(itineraries.create).not.toHaveBeenCalled();
    });
  });

  describe('loadOwned / getMine (ITN-03, ACC-11)', () => {
    it('returns the detail with derived dates and city names for the owner', async () => {
      const stored = storedItinerary();
      const { service } = setup(stored);
      const res = await service.getMine(owner, stored.id);
      expect(res.days.map((d) => [d.dayNumber, d.date, d.cityName])).toEqual([
        [1, '2027-03-01', 'Cairo'],
        [2, '2027-03-02', null],
      ]);
      expect(res.endDate).toBe('2027-03-02');
    });

    it('gives a stranger the same 404 as an unknown id', async () => {
      const stored = storedItinerary();
      const { service } = setup(stored);
      await expect(service.getMine(stranger, stored.id)).rejects.toMatchObject({
        status: 404,
        message: ITINERARY_NOT_FOUND,
      });
      const missing = setup(null).service;
      await expect(
        missing.getMine(owner, new Types.ObjectId().toHexString()),
      ).rejects.toMatchObject({ status: 404, message: ITINERARY_NOT_FOUND });
      await expect(missing.loadOwned(owner, 'nope')).rejects.toBeInstanceOf(
        AppException,
      );
    });
  });

  describe('listMine (ITN-03)', () => {
    it('maps the page items to summaries', async () => {
      const stored = storedItinerary();
      const { service, itineraries } = setup(stored);
      const page = await service.listMine(owner, 1);
      expect(page).toMatchObject({ total: 1, page: 1 });
      expect(page.items[0]).toMatchObject({ id: stored.id, dayCount: 2 });
      expect(itineraries.find).toHaveBeenCalledWith(
        { ownerId: ownerId },
        undefined,
      );
    });
  });

  describe('update (ITN-01, ITN-20)', () => {
    it('rejects an empty change set before reading anything', async () => {
      const { service, itineraries } = setup(storedItinerary());
      await expect(
        service.update(owner, new Types.ObjectId().toHexString(), {}),
      ).rejects.toMatchObject({ status: 400 });
      expect(itineraries.findById).not.toHaveBeenCalled();
    });

    it('writes only the sent fields with validators on, scoped to the owner', async () => {
      const stored = storedItinerary();
      const { service, itineraries } = setup(stored);
      await service.update(owner, stored.id, {
        visibility: ItineraryVisibility.Public,
      });
      expect(itineraries.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: stored.id, ownerId: ownerId },
        { $set: { visibility: ItineraryVisibility.Public } },
        { new: true, runValidators: true },
      );
    });

    it('checks new countries and 404s when the itinerary vanished meanwhile', async () => {
      const stored = storedItinerary();
      const bad = setup(stored);
      await expect(
        bad.service.update(owner, stored.id, { countries: ['ZZ'] }),
      ).rejects.toMatchObject({ status: 400 });
      const vanished = setup(stored, { updateResult: null });
      await expect(
        vanished.service.update(owner, stored.id, { title: 'New' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('never lets a stranger edit', async () => {
      const stored = storedItinerary();
      const { service, itineraries } = setup(stored);
      await expect(
        service.update(stranger, stored.id, { title: 'Mine now' }),
      ).rejects.toMatchObject({ status: 404 });
      expect(itineraries.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('remove (ITN-01)', () => {
    const url = (n: number) =>
      `/uploads/activities/${String(n).padStart(8, '0')}-0000-4000-8000-000000000000.jpg`;

    it('deletes activities and budgets, and only the image files no clone still uses', async () => {
      const stored = storedItinerary();
      const { service, activities, uploads, budgets } = setup(stored, {
        activities: [{ images: [url(1), url(2)] }, { images: [url(2)] }],
        sharedUrls: [url(2)],
        budgets: true,
      });
      await service.remove(owner, stored.id);
      expect(activities.deleteMany).toHaveBeenCalledWith({
        itineraryId: stored._id,
      });
      expect(budgets.deleteForItinerary).toHaveBeenCalledWith(stored.id);
      expect(uploads.deleteImage).toHaveBeenCalledTimes(1);
      expect(uploads.deleteImage).toHaveBeenCalledWith(url(1));
    });

    it('works without the budgets port and 404s when another request deleted it first', async () => {
      const stored = storedItinerary();
      const ok = setup(stored);
      await expect(
        ok.service.remove(owner, stored.id),
      ).resolves.toBeUndefined();
      const raced = setup(stored, { deletedCount: 0 });
      await expect(
        raced.service.remove(owner, stored.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(raced.activities.deleteMany).not.toHaveBeenCalled();
    });
  });
});
