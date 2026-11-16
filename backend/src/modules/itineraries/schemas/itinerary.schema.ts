import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { calendarDate, safeInteger } from '../../../common/validation';

export const ITINERARIES_COLLECTION = 'itineraries';
export const MAX_ITINERARY_DAYS = 60;

export enum ItineraryVisibility {
  Public = 'PUBLIC',
  Private = 'PRIVATE',
}

/** An itinerary day is embedded and gets its own MongoDB _id for activity.dayId. */
@Schema()
export class ItineraryDay {
  _id!: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: MAX_ITINERARY_DAYS,
    validate: safeInteger('order'),
  })
  order!: number;

  /** cityId is the seeded identifier from reference.cities, not a MongoDB ObjectId. */
  @Prop({ type: String, required: true, trim: true })
  cityId!: string;

  @Prop({ type: String, default: '', trim: true })
  notes!: string;
}
export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

/** Attribution is a snapshot so the credited author name survives account changes. */
@Schema({ _id: false })
export class ItineraryCloneAttribution {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
  })
  itineraryId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  authorName!: string;
}
export const ItineraryCloneAttributionSchema = SchemaFactory.createForClass(
  ItineraryCloneAttribution,
);

function hasSequentialDays(days: ItineraryDay[]): boolean {
  return (
    Array.isArray(days) &&
    days.length <= MAX_ITINERARY_DAYS &&
    days.every((day, index) => day.order === index + 1)
  );
}

@Schema({ ...SCHEMA_OPTIONS, collection: ITINERARIES_COLLECTION })
export class Itinerary {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  ownerId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  title!: string;

  /** ISO 3166-1 alpha-2 country codes from reference.countries. */
  @Prop({
    type: [String],
    required: true,
    validate: {
      validator: (countries: string[]) =>
        countries.length > 0 &&
        countries.every((code) => /^[A-Z]{2}$/.test(code)),
      message: 'countries must contain one or more seeded country codes',
    },
  })
  countries!: string[];

  /** Calendar date YYYY-MM-DD, not a UTC instant. */
  @Prop({ type: String, required: true, validate: calendarDate('startDate') })
  startDate!: string;

  @Prop({
    type: String,
    enum: Object.values(ItineraryVisibility),
    required: true,
    default: ItineraryVisibility.Private,
    index: true,
  })
  visibility!: ItineraryVisibility;

  @Prop({
    type: [ItineraryDaySchema],
    default: [],
    validate: {
      validator: hasSequentialDays,
      message: `days must have sequential orders from 1 and contain at most ${MAX_ITINERARY_DAYS} days`,
    },
  })
  days!: ItineraryDay[];

  @Prop({ type: ItineraryCloneAttributionSchema, default: undefined })
  clonedFrom?: ItineraryCloneAttribution;

  @Prop({ type: Boolean, default: false, index: true })
  isHidden!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ItineraryDocument = HydratedDocument<Itinerary>;
export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

ItinerarySchema.index({ ownerId: 1, updatedAt: -1 });
ItinerarySchema.index({
  title: 'text',
  countries: 'text',
  'days.cityId': 'text',
});
