import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CONTENT_MODERATION,
  ModeratableContentType,
  type ContentModeration,
  type ModeratableContent,
  type ModeratableContentAdapter,
  type RemovedContent,
} from '../../common/contracts';
import { ReviewsService } from './reviews.service';
import { Review } from './schemas/review.schema';

/**
 * Hotel reviews as moderatable content (GEN-09 reports, GEN-10 hide/delete). A review is public as soon
 * as it exists; its author is the guest (userId). The hotel's stored ratingAvg and ratingCount count
 * visible reviews only, so hiding, unhiding and deleting recalculate them in the caller's transaction,
 * exactly like ReviewsService.remove (HTL-23). A reservation keeps no link to its review.
 */
@Injectable()
export class ReviewModerationAdapter
  implements ModeratableContentAdapter, OnModuleInit
{
  readonly type = ModeratableContentType.Review;

  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    private readonly reviewsService: ReviewsService,
    @Optional()
    @Inject(CONTENT_MODERATION)
    private readonly moderation?: ContentModeration,
  ) {}

  onModuleInit(): void {
    this.moderation?.register(this);
  }

  async find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const review = await this.reviews
      .findById(id, { userId: 1, isHidden: 1 })
      .session(session ?? null)
      .lean()
      .exec();
    if (!review) return null;
    return {
      id: review._id.toHexString(),
      authorId: review.userId.toHexString(),
      isHidden: review.isHidden === true,
      isPublic: true,
    };
  }

  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const review = await this.reviews
      .findOneAndUpdate(
        { _id: id, isHidden: hidden ? { $ne: true } : true },
        { $set: { isHidden: hidden } },
        { session, projection: { hotelId: 1 } },
      )
      .lean()
      .exec();
    if (!review) return false;
    await this.reviewsService.recalculateRating(
      review.hotelId.toHexString(),
      session,
    );
    return true;
  }

  /** Deletes the review and recalculates the hotel rating in the same transaction; no files to clean. */
  async remove(
    id: string,
    session: ClientSession,
  ): Promise<RemovedContent | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const review = await this.reviews
      .findOneAndDelete({ _id: id }, { session, projection: { hotelId: 1 } })
      .lean()
      .exec();
    if (!review) return null;
    await this.reviewsService.recalculateRating(
      review.hotelId.toHexString(),
      session,
    );
    return { afterCommit: () => Promise.resolve() };
  }
}
