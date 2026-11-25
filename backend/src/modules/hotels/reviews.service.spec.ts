import { Types } from 'mongoose';
import {
  ProviderType,
  Role,
  type AuthUser,
} from '../../common/auth/auth.types';
import { AuditAction, AuditTargetType } from '../../common/contracts';
import { AccountStatus } from '../users';
import { ReviewsService } from './reviews.service';

const HOTEL = new Types.ObjectId();
const AUTHOR = new Types.ObjectId();
const REVIEW = new Types.ObjectId();
const user = (id = AUTHOR): AuthUser => ({
  id: id.toHexString(),
  role: Role.User,
});

const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value) });

const reviewRow = (over: object = {}) => ({
  _id: REVIEW,
  hotelId: HOTEL,
  reservationId: new Types.ObjectId(),
  userId: AUTHOR,
  rating: 4,
  text: 'Nice',
  createdAt: new Date('2027-11-01T08:00:00Z'),
  updatedAt: new Date('2027-11-01T08:00:00Z'),
  ...over,
});

function setup(opts: {
  createError?: Error;
  stored?: object | null;
  ratings?: { avg: number; count: number }[];
  hotel?: object | null;
  profiles?: Record<string, { name: string; status: AccountStatus }>;
  page?: object[];
}) {
  const sessions = {
    withTransaction: jest.fn((fn: () => Promise<void>) => fn()),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn(() => Promise.resolve(sessions)) };
  const reviews = {
    create: jest.fn((docs: object[]) =>
      opts.createError
        ? Promise.reject(opts.createError)
        : Promise.resolve([
            { toObject: () => ({ ...reviewRow(), ...docs[0] }) },
          ]),
    ),
    findById: jest.fn(() => ({
      lean: () => exec(opts.stored === undefined ? reviewRow() : opts.stored),
    })),
    findOneAndUpdate: jest.fn((_f: unknown, update: { $set: object }) => ({
      lean: () => exec({ ...reviewRow(), ...update.$set }),
    })),
    deleteOne: jest.fn(() => exec({ deletedCount: 1 })),
    aggregate: jest.fn(() => exec(opts.ratings ?? [{ avg: 3.666, count: 3 }])),
    find: jest.fn(() => {
      const chain = {
        sort: () => chain,
        skip: () => chain,
        limit: () => chain,
        lean: () => chain,
        exec: () => Promise.resolve(opts.page ?? []),
      };
      return chain;
    }),
    countDocuments: jest.fn(() => exec((opts.page ?? []).length)),
  };
  const hotels = {
    updateOne: jest.fn(() => exec({ modifiedCount: 1 })),
    findOne: jest.fn(() => ({
      lean: () => exec(opts.hotel === undefined ? { _id: HOTEL } : opts.hotel),
    })),
  };
  const details = {
    visibleRatings: jest.fn(() =>
      Promise.resolve(new Map([[HOTEL.toHexString(), { avg: 3.7, count: 3 }]])),
    ),
  };
  const users = {
    findProfile: jest.fn((id: string) =>
      Promise.resolve(opts.profiles?.[id] ?? null),
    ),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const service = new ReviewsService(
    reviews as never,
    hotels as never,
    connection as never,
    details as never,
    users as never,
    audit,
  );
  return { service, reviews, hotels, sessions, audit };
}

const stay = {
  hotelId: HOTEL.toHexString(),
  reservationId: new Types.ObjectId().toHexString(),
  userId: AUTHOR.toHexString(),
};

describe('ReviewsService (HTL-23, HTL-24)', () => {
  it('HTL-23 creates the review and recalculates the hotel rating in the same transaction', async () => {
    const { service, reviews, hotels, sessions } = setup({
      profiles: {
        [AUTHOR.toHexString()]: {
          name: 'Mona Adel',
          status: AccountStatus.Active,
        },
      },
    });
    const review = await service.create(stay, { rating: 5 });
    expect(reviews.create).toHaveBeenCalledWith(
      [
        {
          hotelId: HOTEL,
          reservationId: new Types.ObjectId(stay.reservationId),
          userId: AUTHOR,
          rating: 5,
          text: '',
        },
      ],
      { session: sessions },
    );
    // Only visible reviews count (GEN-10); the stored average has one decimal.
    expect(reviews.aggregate).toHaveBeenCalledWith(
      [
        { $match: { hotelId: HOTEL, isHidden: { $ne: true } } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ],
      { session: sessions },
    );
    expect(hotels.updateOne).toHaveBeenCalledWith(
      { _id: HOTEL },
      { $set: { ratingAvg: 3.7, ratingCount: 3 } },
      { runValidators: true, session: sessions },
    );
    expect(review).toMatchObject({
      rating: 5,
      text: '',
      author: { name: 'Mona Adel' },
    });
  });

  it('HTL-23 resets the stored rating to 0 when no visible review is left', async () => {
    const { service, hotels } = setup({ ratings: [] });
    await service.remove(user(), REVIEW.toHexString());
    expect(hotels.updateOne).toHaveBeenCalledWith(
      { _id: HOTEL },
      { $set: { ratingAvg: 0, ratingCount: 0 } },
      expect.anything(),
    );
  });

  it('HTL-23 answers a second review of the same reservation with 409 REVIEW_ALREADY_EXISTS', async () => {
    const { service } = setup({
      createError: Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      }),
    });
    await expect(service.create(stay, { rating: 3 })).rejects.toMatchObject({
      code: 'REVIEW_ALREADY_EXISTS',
    });
  });

  it('HTL-23 lets only the author edit (403 for others, 404 for unknown) and needs a field', async () => {
    await expect(
      setup({}).service.update(
        user(new Types.ObjectId()),
        REVIEW.toHexString(),
        { rating: 2 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setup({ stored: null }).service.update(user(), REVIEW.toHexString(), {
        rating: 2,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      setup({}).service.update(user(), REVIEW.toHexString(), {}),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const { service, reviews, hotels } = setup({});
    const edited = await service.update(user(), REVIEW.toHexString(), {
      text: '',
    });
    expect(reviews.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: REVIEW },
      { $set: { text: '' } },
      expect.objectContaining({ runValidators: true }),
    );
    expect(edited.text).toBe('');
    expect(hotels.updateOne).toHaveBeenCalled();
  });

  it('HTL-23 lets only the author delete', async () => {
    const stranger = setup({});
    await expect(
      stranger.service.remove(user(new Types.ObjectId()), REVIEW.toHexString()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(stranger.reviews.deleteOne).not.toHaveBeenCalled();
  });

  it('HTL-24 lists visible reviews newest first with the rating summary; a deactivated author is "Deleted user"', async () => {
    const gone = new Types.ObjectId();
    const { service, reviews } = setup({
      page: [
        reviewRow(),
        reviewRow({ _id: new Types.ObjectId(), userId: gone }),
      ],
      profiles: {
        [AUTHOR.toHexString()]: {
          name: 'Mona Adel',
          status: AccountStatus.Suspended,
        },
        [gone.toHexString()]: {
          name: 'Omar',
          status: AccountStatus.Deactivated,
        },
      },
    });
    const page = await service.listForHotel(HOTEL.toHexString(), 1);
    expect(reviews.find).toHaveBeenCalledWith(
      { hotelId: HOTEL, isHidden: { $ne: true } },
      undefined,
    );
    expect(page).toMatchObject({
      ratingAvg: 3.7,
      ratingCount: 3,
      total: 2,
      limit: 10,
    });
    // A suspended author keeps their name (ACC-16); a deactivated one does not (ACC-12).
    expect(page.items.map((r) => r.author.name)).toEqual([
      'Mona Adel',
      'Deleted user',
    ]);
  });

  it('HTL-24 hides an unknown or deactivated hotel (404)', async () => {
    await expect(
      setup({ hotel: null }).service.listForHotel(HOTEL.toHexString(), 1),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  describe('HTL-26 reply', () => {
    const MODERATOR = new Types.ObjectId();
    const moderator = (hotelId = HOTEL): AuthUser => ({
      id: MODERATOR.toHexString(),
      role: Role.HotelModerator,
      assignedProvider: {
        type: ProviderType.Hotel,
        providerId: hotelId.toHexString(),
      },
    });

    it('stores the reply, audits it and leaves the rating alone', async () => {
      const { service, reviews, hotels, audit } = setup({
        profiles: {
          [AUTHOR.toHexString()]: {
            name: 'Mona',
            status: AccountStatus.Active,
          },
        },
      });
      const dto = await service.reply(moderator(), REVIEW.toHexString(), {
        text: 'Thank you!',
      });
      expect(dto.reply).toMatchObject({ text: 'Thank you!' });
      expect(dto.reply).not.toHaveProperty('moderatorId');
      expect(reviews.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: REVIEW, isHidden: { $ne: true } },
        expect.anything(),
        expect.objectContaining({ timestamps: false }),
      );
      expect(hotels.updateOne).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ReplyReview,
          targetType: AuditTargetType.Review,
          targetId: REVIEW.toHexString(),
          metadata: { hotelId: HOTEL.toHexString(), edited: false },
        }),
        expect.anything(),
      );
    });

    it('keeps createdAt when the reply is posted again', async () => {
      const first = new Date('2026-11-02T08:00:00Z');
      const { service, audit } = setup({
        stored: reviewRow({
          reply: {
            text: 'Old',
            moderatorId: MODERATOR,
            createdAt: first,
            updatedAt: first,
          },
        }),
      });
      const dto = await service.reply(moderator(), REVIEW.toHexString(), {
        text: 'New',
      });
      expect(dto.reply).toMatchObject({ text: 'New', createdAt: first });
      expect(dto.reply!.updatedAt.getTime()).toBeGreaterThan(first.getTime());
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ edited: true }),
        }),
        expect.anything(),
      );
    });

    it('404 for an unknown review', async () => {
      const { service } = setup({ stored: null });
      await expect(
        service.reply(moderator(), REVIEW.toHexString(), { text: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('403 for the moderator of another hotel, nothing written', async () => {
      const { service, reviews, audit } = setup({});
      await expect(
        service.reply(moderator(new Types.ObjectId()), REVIEW.toHexString(), {
          text: 'x',
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(reviews.findOneAndUpdate).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('409 REVIEW_HIDDEN for a hidden review', async () => {
      const { service, reviews } = setup({
        stored: reviewRow({ isHidden: true }),
      });
      await expect(
        service.reply(moderator(), REVIEW.toHexString(), { text: 'x' }),
      ).rejects.toMatchObject({ status: 409, code: 'REVIEW_HIDDEN' });
      expect(reviews.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
