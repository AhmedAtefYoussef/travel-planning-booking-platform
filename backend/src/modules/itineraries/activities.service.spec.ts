import { HttpStatus } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type { ReferenceService } from '../../common/contracts/services.contract';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ActivitiesService, ACTIVITY_NOT_FOUND } from './activities.service';
import type { ItinerariesService } from './itineraries.service';
import type { Activity } from './schemas/activity.schema';

const query = <T>(value: T) => {
  const q = { lean: () => q, exec: () => Promise.resolve(value) };
  return q;
};
const IMG = (n: number) =>
  `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const urlOf = (n: number) => `/uploads/activities/${IMG(n)}.png`;

const user: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.User,
};
function fakeActivity(over: Partial<Record<string, unknown>> = {}) {
  const _id = new Types.ObjectId();
  const doc = {
    _id,
    id: _id.toHexString(),
    itineraryId: new Types.ObjectId(),
    dayId: new Types.ObjectId(),
    name: 'Pyramids',
    description: 'Tour',
    images: [] as string[],
    costMinor: undefined as number | undefined,
    currency: undefined as string | undefined,
    ...over,
  };
  return { ...doc, toObject: () => doc };
}

type Fake = ReturnType<typeof fakeActivity>;

function setup(
  stored: Fake | null,
  opts: {
    ownerOk?: boolean;
    ownerError?: Error;
    writeResult?: Fake | null;
    writeError?: Error;
    deletedCount?: number;
  } = {},
) {
  const dayId = new Types.ObjectId();
  const itinerary = {
    _id: stored?.itineraryId ?? new Types.ObjectId(),
    days: [{ _id: dayId }],
  };
  const activities = {
    create: jest.fn((doc: Record<string, unknown>) =>
      Promise.resolve({
        toObject: () => ({ _id: new Types.ObjectId(), ...doc }),
      }),
    ),
    findById: jest.fn(() => query(stored)),
    findOneAndUpdate: jest.fn(
      (filter: unknown, update: unknown, options?: unknown) => ({
        calledWith: [filter, update, options],
        exec: () =>
          opts.writeError
            ? Promise.reject(opts.writeError)
            : Promise.resolve(
                opts.writeResult !== undefined ? opts.writeResult : stored,
              ),
      }),
    ),
    deleteOne: jest.fn(() => query({ deletedCount: opts.deletedCount ?? 1 })),
  };
  const itineraryService = {
    loadOwned: jest.fn(() => {
      if (opts.ownerError) return Promise.reject(opts.ownerError);
      if (opts.ownerOk === false) {
        return Promise.reject(
          new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'x'),
        );
      }
      return Promise.resolve(itinerary);
    }),
    touch: jest.fn(() => Promise.resolve()),
    deleteUnusedImages: jest.fn(() => Promise.resolve()),
  };
  const reference = {
    listCurrencies: jest.fn(() =>
      Promise.resolve([{ code: 'EGP', name: 'Pound', minorUnits: 2 }]),
    ),
  } as unknown as ReferenceService;
  const service = new ActivitiesService(
    activities as unknown as Model<Activity>,
    itineraryService as unknown as ItinerariesService,
    reference,
  );
  return { service, activities, itineraryService, dayId, itinerary };
}

describe('ActivitiesService (ITN-10)', () => {
  describe('create', () => {
    it('adds an activity to an existing day and touches the itinerary', async () => {
      const { service, activities, itineraryService, dayId, itinerary } =
        setup(null);
      const res = await service.create(user, 'it', dayId.toHexString(), {
        name: 'A',
        description: 'B',
        costMinor: 100,
        currency: 'EGP',
      });
      expect(activities.create).toHaveBeenCalledWith(
        expect.objectContaining({ dayId, costMinor: 100, currency: 'EGP' }),
      );
      expect(itineraryService.touch).toHaveBeenCalledWith(itinerary._id);
      expect(res).toMatchObject({ name: 'A', costMinor: 100 });
    });

    it('rejects an unknown day, a lone cost and an unsupported currency', async () => {
      const { service, dayId } = setup(null);
      await expect(
        service.create(user, 'it', new Types.ObjectId().toHexString(), {
          name: 'A',
          description: 'B',
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.create(user, 'it', dayId.toHexString(), {
          name: 'A',
          description: 'B',
          currency: 'EGP',
        }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'costMinor' })],
      });
      await expect(
        service.create(user, 'it', dayId.toHexString(), {
          name: 'A',
          description: 'B',
          costMinor: 1,
          currency: 'XYZ',
        }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'currency' })],
      });
    });
  });

  describe('update', () => {
    it('sets the sent fields and unsets removed ones', async () => {
      const stored = fakeActivity({
        costMinor: 5,
        currency: 'EGP',
        time: '08:00',
      });
      const { service, activities } = setup(stored);
      await service.update(user, stored.id, {
        name: 'New',
        removeTime: true,
        removeCost: true,
      });
      expect(activities.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: stored._id },
        {
          $set: { name: 'New' },
          $unset: { time: '', costMinor: '', currency: '' },
        },
        { new: true, runValidators: true },
      );
    });

    it('checks a new cost against the stored currency', async () => {
      const stored = fakeActivity({ costMinor: 5, currency: 'EGP' });
      const { service, activities } = setup(stored);
      await service.update(user, stored.id, { costMinor: 9 });
      expect(activities.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $set: { costMinor: 9 },
      });
      const noCurrency = setup(fakeActivity());
      await expect(
        noCurrency.service.update(user, stored.id, { costMinor: 9 }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects an empty body and contradictory remove flags', async () => {
      const { service, activities } = setup(fakeActivity());
      await expect(service.update(user, 'x', {})).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        service.update(user, 'x', { removeTime: true, time: '09:00' }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'removeTime' })],
      });
      await expect(
        service.update(user, 'x', { removeCost: true, currency: 'EGP' }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'removeCost' })],
      });
      expect(activities.findById).not.toHaveBeenCalled();
    });

    it('404s when the activity vanished during the write', async () => {
      const stored = fakeActivity();
      const { service } = setup(stored, { writeResult: null });
      await expect(
        service.update(user, stored.id, { name: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('ownership', () => {
    it('answers a stranger exactly like an unknown activity', async () => {
      const stored = fakeActivity();
      const stranger = setup(stored, { ownerOk: false });
      await expect(
        stranger.service.remove(user, stored.id),
      ).rejects.toMatchObject({
        status: 404,
        message: ACTIVITY_NOT_FOUND,
      });
      await expect(
        setup(null).service.remove(user, new Types.ObjectId().toHexString()),
      ).rejects.toMatchObject({ status: 404, message: ACTIVITY_NOT_FOUND });
      await expect(
        setup(null).service.remove(user, 'bad'),
      ).rejects.toMatchObject({
        status: 404,
      });
    });

    it('does not hide unexpected errors', async () => {
      const stored = fakeActivity();
      const { service } = setup(stored, { ownerError: new Error('db down') });
      await expect(service.remove(user, stored.id)).rejects.toThrow('db down');
    });
  });

  describe('remove', () => {
    it('deletes the activity and its unused image files', async () => {
      const stored = fakeActivity({ images: [urlOf(1)] });
      const { service, itineraryService } = setup(stored);
      await service.remove(user, stored.id);
      expect(itineraryService.deleteUnusedImages).toHaveBeenCalledWith([
        urlOf(1),
      ]);
    });

    it('404s when another request deleted it first', async () => {
      const stored = fakeActivity();
      const { service } = setup(stored, { deletedCount: 0 });
      await expect(service.remove(user, stored.id)).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
