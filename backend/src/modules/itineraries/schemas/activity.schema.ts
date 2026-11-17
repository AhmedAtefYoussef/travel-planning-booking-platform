
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS, UPLOAD_LIMITS } from '../../../common/contracts';
import {
  LOCAL_TIME_HH_MM,
  localUploadUrlPattern,
  safeInteger,
} from '../../../common/validation';

export const ACTIVITIES_COLLECTION = 'activities';

const ACTIVITY_UPLOAD_URL = localUploadUrlPattern(['activities']);

@Schema({ ...SCHEMA_OPTIONS, collection: ACTIVITIES_COLLECTION })
export class Activity {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
  })
  itineraryId!: Types.ObjectId;

  /** ObjectId of the embedded day's _id in the referenced itinerary. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  dayId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 2000 })
  description!: string;

  /** Optional wall-clock time, HH:mm. */
  @Prop({ type: String, match: LOCAL_TIME_HH_MM })
  time?: string;

  /** Integer minor units (ADR-0004); must be provided together with currency. */
  @Prop({
    type: Number,
    min: 0,
    validate: safeInteger('costMinor'),
  })
  costMinor?: number;

  /** Uppercase ISO 4217 code; seeded-currency membership is checked by service logic. */
  @Prop({ type: String, uppercase: true, match: /^[A-Z]{3}$/ })
  currency?: string;

  /** Public URLs returned by UPLOADS_SERVICE for ACTIVITY images. */
  @Prop({
    type: [String],
    default: [],
    validate: [
      {
        validator: (images: string[]) =>
          Array.isArray(images) &&
          images.length <= UPLOAD_LIMITS.maxImagesPerEntity,
        message: `An activity can have at most ${UPLOAD_LIMITS.maxImagesPerEntity} images`,
      },
      {
        validator: (images: string[]) =>
          Array.isArray(images) &&
          images.every((url) => ACTIVITY_UPLOAD_URL.test(url)),
        message: 'Activity images must be valid local activity upload URLs',
      },
    ],
  })
  images!: string[];

  createdAt!: Date;
  updatedAt!: Date;
}

export type ActivityDocument = HydratedDocument<Activity>;
export const ActivitySchema = SchemaFactory.createForClass(Activity);

ActivitySchema.index({ itineraryId: 1, dayId: 1 });

ActivitySchema.pre('validate', function () {
  const hasCost = this.costMinor != null;
  const hasCurrency = this.currency != null;

  if (hasCost !== hasCurrency) {
    this.invalidate(
      hasCost ? 'currency' : 'costMinor',
      'costMinor and currency must be provided together',
    );
  }
});
