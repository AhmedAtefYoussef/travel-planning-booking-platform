import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { safeInteger } from '../../../common/validation';

export const REVIEWS_COLLECTION = 'reviews';
export const MAX_REVIEW_TEXT = 1000;

/**
 * reviews (TRVL-140, HTL-22/23): one per completed reservation. Hidden reviews are left out of the
 * hotel page and of `hotels.averageRating`.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: REVIEWS_COLLECTION })
export class Review {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: Types.ObjectId;

  /** One review per reservation, even under concurrent submits (unique index). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelReservation',
    required: true,
  })
  reservationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** 1..5 whole stars. */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: safeInteger('rating'),
  })
  rating!: number;

  @Prop({ type: String, default: '', trim: true, maxlength: MAX_REVIEW_TEXT })
  text!: string;

  /** Hidden by a moderator or admin. */
  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index(
  { reservationId: 1 },
  { unique: true, name: 'one_review_per_reservation' },
);
// Hotel page: a hotel's visible reviews, newest first; also the rating average.
ReviewSchema.index({ hotelId: 1, isHidden: 1, createdAt: -1 });
