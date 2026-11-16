import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { LOCAL_TIME_HH_MM, safeInteger } from '../../../common/validation';

export const ACTIVITIES_COLLECTION = 'activities';
export const MAX_ACTIVITY_IMAGES = 5;

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

  /** Integer minor units (ADR-0004); itinerary costs may use a selected currency. */
  @Prop({ type: Number, min: 0, validate: safeInteger('costMinor') })
  costMinor?: number;

  /** Uppercase ISO 4217 code; seeded-currency membership is checked by service logic. */
  @Prop({ type: String, uppercase: true, match: /^[A-Z]{3}$/ })
  currency?: string;

  /** Public URLs returned by UPLOADS_SERVICE for ACTIVITY images. */
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (images: string[]) => images.length <= MAX_ACTIVITY_IMAGES,
      message: `An activity can have at most ${MAX_ACTIVITY_IMAGES} images`,
    },
  })
  images!: string[];

  createdAt!: Date;
  updatedAt!: Date;
}

export type ActivityDocument = HydratedDocument<Activity>;
export const ActivitySchema = SchemaFactory.createForClass(Activity);

ActivitySchema.index({ itineraryId: 1, dayId: 1 });
