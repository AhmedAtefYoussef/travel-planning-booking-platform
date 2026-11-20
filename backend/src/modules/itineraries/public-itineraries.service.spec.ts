import { Types, type Connection, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type {
  AccountAdmin,
  ItineraryBudgets,
  ReferenceService,
} from '../../common/contracts/services.contract';
import type { ItinerariesService } from './itineraries.service';
import {
  PublicItinerariesService,
  UNKNOWN_AUTHOR,
} from './public-itineraries.service';
import type { Activity } from './schemas/activity.schema';
import {
  ItineraryVisibility,
  type Itinerary,
} from './schemas/itinerary.schema';

const query = <T>(value: T) => {
  const q = {
    sort: () => q,
    skip: () => q,
    limit: () => q,
    lean: () => q,
    exec: () => Promise.resolve(value),
  };
  return q;
};

const reader: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.User,
};

function publicItinerary() {
  const _id = new Types.ObjectId();
  return {
    _id,
    id: _id.toHexString(),
    ownerId: new Types.ObjectId(),
    title: 'Nile',
    countries: ['EG'],
    startDate: '2027-01-01',
    visibility: ItineraryVisibility.Public,
    days: [
      { _id: new Types.ObjectId(), order: 2, cityId: 'dubai', notes: 'b' },
      { _id: new Types.ObjectId(), order: 1, cityId: 'cairo', notes: 'a' },
    ],
    updatedAt: new Date(),
  };
}

type Stored = ReturnType<typeof publicItinerary>;

function setup(
  stored: Stored | null,
  opts: {
    budgets?: boolean;
    insertError?: Error;
    budgetCloneError?: Error;
    authorName?: string | null;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const itineraries = {
    find: jest.fn((filter: unknown) => query(stored && filter ? [stored] : [])),
    countDocuments: jest.fn(() => query(stored ? 1 : 0)),
    findOne: jest.fn((filter: unknown) => query(filter ? stored : null)),
    create: jest.fn((docs: Record<string, unknown>[]) => {
      created.push(...docs);
      return Promise.resolve(docs);
    }),
    findById: jest.fn((id: Types.ObjectId) =>
      query({ ...created[0], _id: id, id: id.toHexString() }),
    ),
    deleteOne: jest.fn(() => query({ deletedCount: 1 })),
  };
  const sourceActivity = stored && {
    itineraryId: stored._id,
    dayId: stored.days[1]._id,
    name: 'Tour',
    description: 'Guided',
    costMinor: 100,
    currency: 'EGP',
    images: ['/uploads/activities/x.png'],
  };
  const orphan = stored && { ...sourceActivity, dayId: new Types.ObjectId() };
  const activities = {
    find: jest.fn(() => query(stored ? [sourceActivity, orphan] : [])),
    insertMany: jest.fn(() =>
      opts.insertError ? Promise.reject(opts.insertError) : Promise.resolve([]),
    ),
    deleteMany: jest.fn(() => query({ deletedCount: 0 })),
  };
  const itineraryService = {
    toDetail: jest.fn(() =>
      Promise.resolve({
        cityGroups: [
          { subtotals: [{ currency: 'EGP', amountMinor: 100 }] },
          { subtotals: [{ currency: 'EGP', amountMinor: 50 }] },
        ],
      }),
    ),
  };
  const reference = {
    listCountries: jest.fn(() =>
      Promise.resolve([
        { code: 'EG', name: 'Egypt', currency: 'EGP' },
        { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
      ]),
    ),
    listCities: jest.fn(() =>
      Promise.resolve([
        { cityId: 'cairo', name: 'Cairo', countryCode: 'EG' },
        { cityId: 'new_york', name: 'New York', countryCode: 'US' },
      ]),
    ),
  } as unknown as ReferenceService;
  const accounts = {
    find: jest.fn(() =>
      Promise.resolve(
        opts.authorName === null
          ? null
          : { id: 'x', name: opts.authorName ?? 'Mona', role: Role.User },
      ),
    ),
  } as unknown as AccountAdmin;
  const budgets = {
    cloneForItinerary: jest.fn(() =>
      opts.budgetCloneError
        ? Promise.reject(opts.budgetCloneError)
        : Promise.resolve(),
    ),
    deleteForItinerary: jest.fn(() => Promise.resolve()),
  } as unknown as ItineraryBudgets;
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    endSession: jest.fn(() => Promise.resolve()),
  };
  const connection = { startSession: jest.fn(() => Promise.resolve(session)) };
  const service = new PublicItinerariesService(
    itineraries as unknown as Model<Itinerary>,
    activities as unknown as Model<Activity>,
    itineraryService as unknown as ItinerariesService,
    reference,
    accounts,
    connection as unknown as Connection,
    opts.budgets ? budgets : undefined,
  );
  return { service, itineraries, activities, budgets, created, session };
}

describe('PublicItinerariesService (ITN-20, ITN-21)', () => {
  describe('search', () => {
    it('always restricts to PUBLIC, not hidden itineraries, and adds author and cities', async () => {
      const stored = publicItinerary();
      const { service, itineraries } = setup(stored);
      const page = await service.search({ page: 1 });
      expect(itineraries.find.mock.calls[0][0]).toEqual({
        visibility: ItineraryVisibility.Public,
        isHidden: { $ne: true },
      });
      expect(page.items[0]).toMatchObject({
        id: stored.id,
        author: { id: stored.ownerId.toHexString(), name: 'Mona' },
        cityIds: ['dubai', 'cairo'],
      });
    });

    it('builds keyword, country, city and duration filters', async () => {
      const { service, itineraries } = setup(null);
      await service.search({
        page: 1,
        q: 'new york',
        country: 'EG',
        city: 'cairo',
        minDays: 2,
        maxDays: 5,
      });
      const filter = itineraries.find.mock.calls[0][0] as { $and: unknown[] };
      expect(filter.$and).toEqual([
        {
          $or: [
            { title: /new york/i },
            { 'days.cityId': { $in: ['new_york'] } },
          ],
        },
        { countries: 'EG' },
        { 'days.cityId': 'cairo' },
        { $expr: { $gte: [{ $size: '$days' }, 2] } },
        { $expr: { $lte: [{ $size: '$days' }, 5] } },
      ]);
    });

    it('matches countries by name or code and escapes regex characters', async () => {
      const { service, itineraries } = setup(null);
      await service.search({ page: 1, q: 'emirates' });
      await service.search({ page: 1, q: 'eg' });
      await service.search({ page: 1, q: 'a.b' });
      const ors = itineraries.find.mock.calls.map(
        (c) => (c[0] as { $and: { $or: unknown[] }[] }).$and[0].$or,
      );
      expect(ors[0]).toContainEqual({ countries: { $in: ['AE'] } });
      expect(ors[1]).toContainEqual({ countries: { $in: ['EG'] } });
      expect(ors[2]).toEqual([{ title: /a\.b/i }]);
    });

    it('names a deleted author account as a former member', async () => {
      const { service } = setup(publicItinerary(), { authorName: null });
      const page = await service.search({ page: 1 });
      expect(page.items[0].author.name).toBe(UNKNOWN_AUTHOR);
    });
  });

  describe('getPublic', () => {
    it('adds the author and the whole budget per currency', async () => {
      const stored = publicItinerary();
      const { service, itineraries } = setup(stored);
      const res = await service.getPublic(stored.id);
      expect(res.budgetTotal).toEqual([{ currency: 'EGP', amountMinor: 150 }]);
      expect(itineraries.findOne.mock.calls[0][0]).toMatchObject({
        visibility: ItineraryVisibility.Public,
      });
    });

    it('404s for a private, hidden, unknown or malformed id', async () => {
      const { service } = setup(null);
      await expect(
        service.getPublic(new Types.ObjectId().toHexString()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.getPublic('nope')).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('clone', () => {
    it('creates a private copy with new day ids, its activities and budgets, crediting the author', async () => {
      const stored = publicItinerary();
      const { service, created, activities, budgets } = setup(stored, {
        budgets: true,
      });
      await service.clone(reader, stored.id);
      const copy = created[0] as {
        ownerId: Types.ObjectId;
        visibility: string;
        days: { _id: Types.ObjectId; order: number; cityId: string }[];
        clonedFrom: Record<string, unknown>;
      };
      expect(copy.ownerId.toHexString()).toBe(reader.id);
      expect(copy.visibility).toBe(ItineraryVisibility.Private);
      expect(copy.days.map((d) => [d.order, d.cityId])).toEqual([
        [1, 'cairo'],
        [2, 'dubai'],
      ]);
      expect(copy.days[0]._id.equals(stored.days[1]._id)).toBe(false);
      expect(copy.clonedFrom).toEqual({
        itineraryId: stored._id,
        authorId: stored.ownerId,
        authorName: 'Mona',
      });
      // The activity of day "cairo" is copied onto the clone's first day; one of an unknown day is not.
      const inserted = (
        activities.insertMany.mock.calls[0] as unknown as [
          { dayId: Types.ObjectId; images: string[] }[],
        ]
      )[0];
      expect(inserted).toHaveLength(1);
      expect(inserted[0].dayId.equals(copy.days[0]._id)).toBe(true);
      expect(inserted[0].images).toEqual(['/uploads/activities/x.png']);
      const map = (budgets.cloneForItinerary as jest.Mock).mock
        .calls[0][2] as Map<string, string>;
      expect(map.get(stored.days[1]._id.toHexString())).toBe(
        copy.days[0]._id.toHexString(),
      );
    });

    it('copies the itinerary and its activities in one transaction', async () => {
      const stored = publicItinerary();
      const { service, itineraries, activities, session } = setup(stored);
      await service.clone(reader, stored.id);
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect((itineraries.create.mock.calls[0] as unknown[])[1]).toEqual({
        session,
      });
      expect((activities.insertMany.mock.calls[0] as unknown[])[1]).toEqual({
        session,
      });
      expect(session.endSession).toHaveBeenCalled();
    });

    it('a failed activity copy aborts the transaction, so nothing else runs', async () => {
      const stored = publicItinerary();
      const { service, itineraries, budgets, session } = setup(stored, {
        budgets: true,
        insertError: new Error('write failed'),
      });
      await expect(service.clone(reader, stored.id)).rejects.toThrow(
        'write failed',
      );
      expect(session.endSession).toHaveBeenCalled();
      expect(budgets.cloneForItinerary).not.toHaveBeenCalled();
      expect(itineraries.deleteOne).not.toHaveBeenCalled();
    });

    it('removes the committed copy again when copying the budget rows fails', async () => {
      const stored = publicItinerary();
      const { service, itineraries, activities, budgets } = setup(stored, {
        budgets: true,
        budgetCloneError: new Error('budgets down'),
      });
      await expect(service.clone(reader, stored.id)).rejects.toThrow(
        'budgets down',
      );
      expect(budgets.deleteForItinerary).toHaveBeenCalled();
      expect(activities.deleteMany).toHaveBeenCalled();
      expect(itineraries.deleteOne).toHaveBeenCalled();
    });

    it('cannot clone what is not public', async () => {
      const { service, itineraries } = setup(null);
      await expect(
        service.clone(reader, new Types.ObjectId().toHexString()),
      ).rejects.toMatchObject({ status: 404 });
      expect(itineraries.create).not.toHaveBeenCalled();
    });
  });
});
