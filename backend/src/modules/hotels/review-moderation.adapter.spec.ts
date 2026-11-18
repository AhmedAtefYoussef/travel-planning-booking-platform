import { Types } from 'mongoose';
import {
  ModeratableContentType,
  type ContentModeration,
} from '../../common/contracts';
import { ReviewModerationAdapter } from './review-moderation.adapter';

const ID = new Types.ObjectId();
const HOTEL = new Types.ObjectId();
const AUTHOR = new Types.ObjectId();
const SESSION = {} as never;

const chain = (value: unknown) => ({
  session: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

function setup(found: unknown = null) {
  const reviews = {
    findById: jest.fn(() => chain(found)),
    findOneAndUpdate: jest.fn(() => chain({ _id: ID, hotelId: HOTEL })),
    findOneAndDelete: jest.fn(() => chain({ _id: ID, hotelId: HOTEL })),
  };
  const service = { recalculateRating: jest.fn().mockResolvedValue(undefined) };
  const registry: jest.Mocked<ContentModeration> = {
    register: jest.fn(),
    get: jest.fn(),
  };
  const adapter = new ReviewModerationAdapter(
    reviews as never,
    service as never,
    registry,
  );
  return { adapter, reviews, service, registry };
}

describe('ReviewModerationAdapter: GEN-09, GEN-10 hotel reviews as moderatable content', () => {
  it('registers itself for REVIEW at start-up', () => {
    const { adapter, registry } = setup();
    adapter.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(adapter);
    expect(adapter.type).toBe(ModeratableContentType.Review);
  });

  it('starts without a moderation module (nothing to register with)', () => {
    const adapter = new ReviewModerationAdapter({} as never, {} as never);
    expect(() => adapter.onModuleInit()).not.toThrow();
  });

  it('describes a review: the guest is the author and it is always public', async () => {
    const { adapter, reviews } = setup({
      _id: ID,
      userId: AUTHOR,
      isHidden: true,
    });
    await expect(adapter.find(ID.toHexString())).resolves.toEqual({
      id: ID.toHexString(),
      authorId: AUTHOR.toHexString(),
      isHidden: true,
      isPublic: true,
    });
    expect(reviews.findById).toHaveBeenCalledWith(ID.toHexString(), {
      userId: 1,
      isHidden: 1,
    });
  });

  it('answers null for an unknown review', async () => {
    const { adapter } = setup(null);
    await expect(adapter.find(ID.toHexString())).resolves.toBeNull();
  });

  it('answers null/false for a malformed id without querying (no CastError)', async () => {
    const { adapter, reviews } = setup(null);
    await expect(adapter.find('nope')).resolves.toBeNull();
    await expect(adapter.setHidden('nope', true, SESSION)).resolves.toBe(false);
    await expect(adapter.remove('nope', SESSION)).resolves.toBeNull();
    expect(reviews.findById).not.toHaveBeenCalled();
    expect(reviews.findOneAndUpdate).not.toHaveBeenCalled();
    expect(reviews.findOneAndDelete).not.toHaveBeenCalled();
  });

  it('hides only a visible review and recalculates the hotel rating in the caller session', async () => {
    const { adapter, reviews, service } = setup();
    await expect(
      adapter.setHidden(ID.toHexString(), true, SESSION),
    ).resolves.toBe(true);
    expect(reviews.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: ID.toHexString(), isHidden: { $ne: true } },
      { $set: { isHidden: true } },
      { session: SESSION, projection: { hotelId: 1 } },
    );
    expect(service.recalculateRating).toHaveBeenCalledWith(
      HOTEL.toHexString(),
      SESSION,
    );
  });

  it('unhides only a hidden review', async () => {
    const { adapter, reviews } = setup();
    await adapter.setHidden(ID.toHexString(), false, SESSION);
    expect(reviews.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: ID.toHexString(), isHidden: true },
      { $set: { isHidden: false } },
      expect.anything(),
    );
  });

  it('answers false and leaves the rating alone when nothing changed', async () => {
    const { adapter, reviews, service } = setup();
    reviews.findOneAndUpdate.mockReturnValueOnce(chain(null));
    await expect(
      adapter.setHidden(ID.toHexString(), true, SESSION),
    ).resolves.toBe(false);
    expect(service.recalculateRating).not.toHaveBeenCalled();
  });

  it('removes the review and recalculates the hotel rating in the caller session', async () => {
    const { adapter, reviews, service } = setup();
    const removed = await adapter.remove(ID.toHexString(), SESSION);
    expect(reviews.findOneAndDelete).toHaveBeenCalledWith(
      { _id: ID.toHexString() },
      { session: SESSION, projection: { hotelId: 1 } },
    );
    expect(service.recalculateRating).toHaveBeenCalledWith(
      HOTEL.toHexString(),
      SESSION,
    );
    await expect(removed!.afterCommit()).resolves.toBeUndefined();
  });

  it('answers null when the review was already gone', async () => {
    const { adapter, reviews, service } = setup();
    reviews.findOneAndDelete.mockReturnValueOnce(chain(null));
    await expect(adapter.remove(ID.toHexString(), SESSION)).resolves.toBeNull();
    expect(service.recalculateRating).not.toHaveBeenCalled();
  });
});
