import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { safeInteger } from '../../../common/validation';

export const REVIEWS_COLLECTION = 'reviews';

export const MAX_REVIEW_TEXT = 1000;

@Schema({ ...SCHEMA_OPTIONS, collection: REVIEWS_COLLECTION })
export class Review {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  /** One review per reservation, even under concurrent submits. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelReservation',
    required: true,
    unique: true,
  })
  reservationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5, validate: safeInteger('rating') })
  rating: number;

  @Prop({ default: '', trim: true, maxlength: MAX_REVIEW_TEXT }) text: string;

  /** Hidden by a moderator; excluded from listings and the hotel rating (ContentFlags, GEN-10). */
  @Prop({ type: Boolean, default: false, index: true })
  isHidden: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);
/** Hotel details page: newest reviews of a hotel first. */
ReviewSchema.index({ hotelId: 1, createdAt: -1 });
