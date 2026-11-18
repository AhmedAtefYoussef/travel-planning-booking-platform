import { Types } from 'mongoose';
import {
  ModeratableContentType,
  type ContentModeration,
} from '../../common/contracts';
import { ItineraryModerationAdapter } from './itinerary-moderation.adapter';
import { ItineraryVisibility } from './schemas/itinerary.schema';

const ID = new Types.ObjectId();
const OWNER = new Types.ObjectId();
const SESSION = {} as never;

const chain = (value: unknown) => ({
  session: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

function setup(found: unknown = null) {
  const itineraries = {
    findById: jest.fn(() => chain(found)),
    updateOne: jest.fn(() => chain({ modifiedCount: 1 })),
    deleteOne: jest.fn(() => chain({ deletedCount: 1 })),
  };
  const activities = { deleteMany: jest.fn(() => chain({})) };
  const registry: jest.Mocked<ContentModeration> = {
    register: jest.fn(),
    get: jest.fn(),
  };
  const adapter = new ItineraryModerationAdapter(
    itineraries as never,
    activities as never,
    registry,
  );
  return { adapter, itineraries, activities, registry };
}

describe('ItineraryModerationAdapter: GEN-09, GEN-10 itineraries as moderatable content', () => {
  it('registers itself for ITINERARY at start-up', () => {
    const { adapter, registry } = setup();
    adapter.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(adapter);
    expect(adapter.type).toBe(ModeratableContentType.Itinerary);
  });

  it('starts without a moderation module (nothing to register with)', () => {
    const adapter = new ItineraryModerationAdapter({} as never, {} as never);
    expect(() => adapter.onModuleInit()).not.toThrow();
  });

  it('describes an itinerary: owner as author, PRIVATE as not public', async () => {
    const { adapter } = setup({
      _id: ID,
      ownerId: OWNER,
      visibility: ItineraryVisibility.Private,
      isHidden: false,
    });
    await expect(adapter.find(ID.toHexString())).resolves.toEqual({
      id: ID.toHexString(),
      authorId: OWNER.toHexString(),
      isHidden: false,
      isPublic: false,
    });
  });

  it('answers null for an unknown or malformed id', async () => {
    const { adapter, itineraries } = setup(null);
    await expect(adapter.find(ID.toHexString())).resolves.toBeNull();
    await expect(adapter.find('nope')).resolves.toBeNull();
    expect(itineraries.findById).toHaveBeenCalledTimes(1);
  });

  it('hides only an itinerary that is not hidden yet, in the caller session', async () => {
    const { adapter, itineraries } = setup();
    await expect(
      adapter.setHidden(ID.toHexString(), true, SESSION),
    ).resolves.toBe(true);
    expect(itineraries.updateOne).toHaveBeenCalledWith(
      { _id: ID.toHexString(), isHidden: { $ne: true } },
      { $set: { isHidden: true } },
      { session: SESSION },
    );
  });

  it('removes the itinerary with its activities, or reports that it was gone', async () => {
    const { adapter, itineraries, activities } = setup();
    await expect(adapter.remove(ID.toHexString(), SESSION)).resolves.toBe(true);
    expect(activities.deleteMany).toHaveBeenCalledWith(
      { itineraryId: ID.toHexString() },
      { session: SESSION },
    );
    itineraries.deleteOne.mockReturnValueOnce(chain({ deletedCount: 0 }));
    await expect(adapter.remove(ID.toHexString(), SESSION)).resolves.toBe(
      false,
    );
  });
});
