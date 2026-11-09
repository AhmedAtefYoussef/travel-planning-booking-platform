import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../../common/contracts/auth.contract';
import { BookingStatus } from '../../common/contracts/booking.contract';
import type { HotelReservationsReader } from '../../common/contracts/hotel-reservations.contract';
import { HOTEL_RESERVATIONS } from '../../common/contracts/tokens';
import {
  PaginatedResponse,
  pageOffset,
  paginate,
} from '../../common/dto/pagination.dto';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { isDuplicateKeyError } from './hotel-access';
import { Hotel, HotelDocument } from './hotel.schema';
import { Review, ReviewDocument } from './review.schema';

export interface ReviewView {
  id: string;
  hotelId: string;
  reservationId: string;
  userId: string;
  rating: number;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewsPage extends PaginatedResponse<ReviewView> {
  /** Average of visible reviews, one decimal; null when there are none. */
  average: number | null;
  count: number;
}

type ReviewLean = Review & { _id: Types.ObjectId };

function toReviewView(r: ReviewLean | ReviewDocument): ReviewView {
  return {
    id: String(r._id),
    hotelId: String(r.hotelId),
    reservationId: String(r.reservationId),
    userId: String(r.userId),
    rating: r.rating,
    text: r.text ?? '',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @Inject(HOTEL_RESERVATIONS)
    private readonly reservations: HotelReservationsReader,
  ) {}

  /** HTL-23: one rating/review per Completed reservation, by its owner. */
  async create(
    reservationId: string,
    user: AuthUser | undefined,
    dto: CreateReviewDto,
  ): Promise<ReviewView> {
    const userId = this.requireUserId(user);
    const reservation = await this.reservations.getById(reservationId);
    // Other people's reservations look the same as missing ones.
    if (!reservation || reservation.userId !== userId) {
      throw new NotFoundException('Reservation not found');
    }
    if (reservation.status !== BookingStatus.COMPLETED) {
      throw new ConflictException(
        'Only a Completed reservation can be reviewed',
      );
    }
    if (await this.reviews.exists({ reservationId })) {
      throw new ConflictException('This reservation already has a review');
    }

    try {
      const review = await this.reviews.create({
        hotelId: new Types.ObjectId(reservation.hotelId),
        reservationId: new Types.ObjectId(reservationId),
        userId: new Types.ObjectId(userId),
        rating: dto.rating,
        text: dto.text ?? '',
      });
      await this.recalculateRating(reservation.hotelId);
      return toReviewView(review);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('This reservation already has a review');
      }
      throw error;
    }
  }

  async update(
    reviewId: string,
    user: AuthUser | undefined,
    dto: UpdateReviewDto,
  ): Promise<ReviewView> {
    if (dto.rating === undefined && dto.text === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    const review = await this.requireOwnReview(reviewId, user);
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.text !== undefined) review.text = dto.text;
    await review.save();
    await this.recalculateRating(String(review.hotelId));
    return toReviewView(review);
  }

  async remove(reviewId: string, user: AuthUser | undefined): Promise<void> {
    const review = await this.requireOwnReview(reviewId, user);
    await this.reviews.deleteOne({ _id: review._id });
    await this.recalculateRating(String(review.hotelId));
  }

  /** HTL-24: public, newest first, hidden reviews excluded. */
  async listForHotel(hotelId: string, page: number): Promise<ReviewsPage> {
    const hotel = await this.hotels.findById(hotelId).lean();
    if (!hotel) throw new NotFoundException('Hotel not found');

    const filter = { hotelId: new Types.ObjectId(hotelId), hidden: false };
    const [items, total] = await Promise.all([
      this.reviews
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(pageOffset(page))
        .limit(10)
        .lean<ReviewLean[]>(),
      this.reviews.countDocuments(filter),
    ]);
    return {
      ...paginate(items.map(toReviewView), total, page),
      average: hotel.ratingCount > 0 ? hotel.ratingAvg : null,
      count: hotel.ratingCount ?? 0,
    };
  }

  /**
   * Re-derives the hotel's average and count from its visible reviews.
   * Also for the moderation module to call after hiding a review (GEN-10).
   */
  async recalculateRating(hotelId: string): Promise<void> {
    const [agg] = await this.reviews.aggregate<{ avg: number; count: number }>([
      { $match: { hotelId: new Types.ObjectId(hotelId), hidden: false } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    await this.hotels.updateOne(
      { _id: hotelId },
      {
        ratingAvg: agg ? Math.round(agg.avg * 10) / 10 : 0,
        ratingCount: agg?.count ?? 0,
      },
    );
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user || !Types.ObjectId.isValid(user.id)) {
      throw new ForbiddenException('Authentication required');
    }
    return user.id;
  }

  private async requireOwnReview(
    reviewId: string,
    user: AuthUser | undefined,
  ): Promise<ReviewDocument> {
    const userId = this.requireUserId(user);
    const review = await this.reviews.findById(reviewId);
    if (!review) throw new NotFoundException('Review not found');
    if (String(review.userId) !== userId) {
      throw new ForbiddenException('You can only change your own review');
    }
    return review;
  }
}
