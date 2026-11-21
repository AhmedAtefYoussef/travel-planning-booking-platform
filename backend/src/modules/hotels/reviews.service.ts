import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  ACTIVE_PROVIDER_FILTER,
  VISIBLE_CONTENT_FILTER,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { paginate, type Page } from '../../common/pagination/pagination';
import { AccountStatus, UsersService } from '../users';
import type {
  CreateReviewDto,
  HotelRatingDto,
  ReviewDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { HotelDetailsService } from './hotel-details.service';
import { Hotel } from './schemas/hotel.schema';
import { Review } from './schemas/review.schema';
import { runInTransaction } from '../../common/utils/transaction';

/** paginate() and lean() return plain documents, which always carry _id. */
type ReviewRow = Review & { _id: Types.ObjectId };

/** What a Completed reservation contributes to its review (checked by the bookings module). */
export interface ReviewedStay {
  hotelId: string;
  reservationId: string;
  userId: string;
}

/** HTL-24: the rating summary with one page of visible reviews. */
export type HotelReviewsPage = HotelRatingDto & Page<ReviewDto>;

const DELETED_USER = 'Deleted user';

/**
 * Hotel reviews (HTL-23, HTL-24). The reviews collection and the hotel's rating belong to this module:
 * the bookings module checks that a reservation is the caller's and Completed, then calls `create`.
 *
 * Every write runs in one transaction with `recalculateRating`, which rewrites the hotel's ratingAvg
 * and ratingCount from its visible reviews (GEN-10 hidden ones never count). The write to the hotel
 * document makes two concurrent reviews of one hotel conflict, so the driver retries one of them and
 * neither average is lost. The public average itself is always computed from the reviews
 * (HotelDetailsService.visibleRatings), the same number HTL-02 and HTL-12 show.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectConnection() private readonly connection: Connection,
    private readonly details: HotelDetailsService,
    private readonly users: UsersService,
  ) {}

  /**
   * HTL-23: one review per reservation, whatever its number of rooms; the unique reservationId index
   * makes a second one (even submitted at the same moment) a 409 REVIEW_ALREADY_EXISTS.
   */
  async create(stay: ReviewedStay, dto: CreateReviewDto): Promise<ReviewDto> {
    let created: ReviewRow | undefined;
    try {
      await this.inTransaction(async (session) => {
        const [doc] = await this.reviews.create(
          [
            {
              hotelId: new Types.ObjectId(stay.hotelId),
              reservationId: new Types.ObjectId(stay.reservationId),
              userId: new Types.ObjectId(stay.userId),
              rating: dto.rating,
              text: dto.text ?? '',
            },
          ],
          { session },
        );
        created = doc.toObject<ReviewRow>();
        await this.recalculateRating(stay.hotelId, session);
      });
    } catch (e) {
      if (isDuplicateKey(e)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.REVIEW_ALREADY_EXISTS,
          'This reservation already has a review; edit it with PATCH /api/reviews/{id}',
        );
      }
      throw e;
    }
    return this.toDto(created!);
  }

  /** HTL-23: the author changes the rating and/or the text; the hotel average follows. */
  async update(
    user: AuthUser,
    reviewId: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewDto> {
    if (dto.rating === undefined && dto.text === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Send rating, text or both',
      );
    }
    const review = await this.ownReview(user, reviewId);
    let updated: ReviewRow | null = null;
    await this.inTransaction(async (session) => {
      updated = await this.reviews
        .findOneAndUpdate(
          { _id: review._id },
          {
            $set: {
              ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
              ...(dto.text !== undefined ? { text: dto.text } : {}),
            },
          },
          { new: true, runValidators: true, session },
        )
        .lean<ReviewRow>()
        .exec();
      if (updated) {
        await this.recalculateRating(review.hotelId.toHexString(), session);
      }
    });
    if (!updated) throw notFound();
    return this.toDto(updated);
  }

  /** HTL-23: the author deletes the review; the hotel average follows. */
  async remove(user: AuthUser, reviewId: string): Promise<void> {
    const review = await this.ownReview(user, reviewId);
    await this.inTransaction(async (session) => {
      const res = await this.reviews
        .deleteOne({ _id: review._id }, { session })
        .exec();
      if (res.deletedCount) {
        await this.recalculateRating(review.hotelId.toHexString(), session);
      }
    });
  }

  /**
   * HTL-24 (public): the hotel's average rating, number of ratings and its visible reviews, newest
   * first, 10 per page (GEN-05). A deactivated hotel is hidden like an unknown one (404, ACC-15).
   */
  async listForHotel(hotelId: string, page: number): Promise<HotelReviewsPage> {
    const hotel = Types.ObjectId.isValid(hotelId)
      ? await this.hotels
          .findOne({ _id: hotelId, ...ACTIVE_PROVIDER_FILTER }, { _id: 1 })
          .lean()
          .exec()
      : null;
    if (!hotel) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Hotel not found',
      );
    }
    const [ratings, reviews] = await Promise.all([
      this.details.visibleRatings([hotel._id]),
      paginate(
        this.reviews,
        { hotelId: hotel._id, ...VISIBLE_CONTENT_FILTER },
        page,
        { sort: { createdAt: -1 } },
      ),
    ]);
    const summary = ratings.get(hotel._id.toHexString());
    const rows = reviews.items as ReviewRow[];
    const authors = await this.authorsOf(rows.map((r) => r.userId));
    return {
      ratingAvg: summary?.avg ?? 0,
      ratingCount: summary?.count ?? 0,
      ...reviews,
      items: rows.map((r) => toDto(r, authors)),
    };
  }

  /**
   * Rewrites the hotel's stored ratingAvg and ratingCount from its visible reviews, inside the caller's
   * transaction. Also for GEN-10 when a review is hidden or deleted by an admin.
   */
  async recalculateRating(
    hotelId: string,
    session: ClientSession,
  ): Promise<void> {
    const id = new Types.ObjectId(hotelId);
    const [row] = await this.reviews
      .aggregate<{ avg: number; count: number }>(
        [
          { $match: { hotelId: id, ...VISIBLE_CONTENT_FILTER } },
          {
            $group: {
              _id: null,
              avg: { $avg: '$rating' },
              count: { $sum: 1 },
            },
          },
        ],
        { session },
      )
      .exec();
    await this.hotels
      .updateOne(
        { _id: id },
        {
          $set: {
            ratingAvg: row ? Math.round(row.avg * 10) / 10 : 0,
            ratingCount: row?.count ?? 0,
          },
        },
        { runValidators: true, session },
      )
      .exec();
  }

  /** The caller's own review: 404 when it does not exist, 403 when it is someone else's (ACC-11). */
  private async ownReview(user: AuthUser, reviewId: string) {
    const review = Types.ObjectId.isValid(reviewId)
      ? await this.reviews
          .findById(reviewId, { userId: 1, hotelId: 1 })
          .lean()
          .exec()
      : null;
    if (!review) throw notFound();
    assertOwner(user, review.userId);
    return review;
  }

  private async inTransaction(
    work: (session: ClientSession) => Promise<void>,
  ): Promise<void> {
    await runInTransaction(this.connection, work);
  }

  private async toDto(review: ReviewRow): Promise<ReviewDto> {
    return toDto(review, await this.authorsOf([review.userId]));
  }

  /**
   * Account id -> name, one lookup per distinct author. A deactivated (ACC-12) or missing account is
   * shown as "Deleted user"; a suspended one keeps its name (ACC-16: content stays visible).
   */
  private async authorsOf(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.map((id) => id.toHexString()))];
    const profiles = await Promise.all(
      unique.map((id) => this.users.findProfile(id)),
    );
    const names = new Map<string, string>();
    unique.forEach((id, i) => {
      const p = profiles[i];
      names.set(
        id,
        p && p.status !== AccountStatus.Deactivated ? p.name : DELETED_USER,
      );
    });
    return names;
  }
}

function toDto(r: ReviewRow, authors: ReadonlyMap<string, string>): ReviewDto {
  const authorId = r.userId.toHexString();
  return {
    id: r._id.toHexString(),
    hotelId: r.hotelId.toHexString(),
    reservationId: r.reservationId.toHexString(),
    rating: r.rating,
    text: r.text ?? '',
    author: { id: authorId, name: authors.get(authorId) ?? DELETED_USER },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Review not found',
  );
}

function isDuplicateKey(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}
