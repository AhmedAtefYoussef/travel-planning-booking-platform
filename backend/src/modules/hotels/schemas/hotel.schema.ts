import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SCHEMA_OPTIONS, UPLOAD_LIMITS } from '../../../common/contracts';
import { isValidTimeZone } from '../../../common/utils/dates';
import { safeInteger } from '../../../common/validation';

export const HOTELS_COLLECTION = 'hotels';

/** Local wall-clock time "HH:mm", 00:00 to 23:59 (HTL-09). */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

// `match` lets "" through, so an explicit validator: null or a real time.
const hhMm = (field: string) => ({
  validator: (value: string | null) => value === null || HH_MM.test(value),
  message: `${field} must be a time HH:mm`,
});

/** One hotel cancellation tier (HTL-10); same shape and selection rule as FLT-09 (CancellationTier). */
@Schema({ _id: false })
export class HotelCancellationTierDoc {
  /** Whole days before check-in, >= 0, unique within the policy (checked by the policy DTO). */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: safeInteger('daysBefore'),
  })
  daysBefore!: number;

  /** 0..100. */
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercent!: number;
}
const HotelCancellationTierSchema = SchemaFactory.createForClass(
  HotelCancellationTierDoc,
);

@Schema({ _id: false })
export class HotelPolicyDoc {
  /** Empty means no tier applies, so a user cancellation refunds 0% (HTL-10, FLT-09 rule). */
  @Prop({ type: [HotelCancellationTierSchema], default: [] })
  cancellationTiers!: HotelCancellationTierDoc[];

  /** HTL-09: hotel-local "HH:mm"; null until the moderator sets it (never ""). */
  @Prop({ type: String, default: null, validate: hhMm('checkInTime') })
  checkInTime!: string | null;

  @Prop({ type: String, default: null, validate: hhMm('checkOutTime') })
  checkOutTime!: string | null;
}
const HotelPolicySchema = SchemaFactory.createForClass(HotelPolicyDoc);

/**
 * hotels (TRVL-140, HTL-01, docs/architecture/erd.md). Created by an admin; edited by the hotel
 * moderator assigned to it (assignedProvider, ACC-13). `isActive` false hides the hotel from search
 * and booking while existing Confirmed reservations stay valid (ACC-15, ACTIVE_PROVIDER_FILTER).
 */
@Schema({ ...SCHEMA_OPTIONS, collection: HOTELS_COLLECTION })
export class Hotel {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 150,
  })
  name!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 300,
  })
  address!: string;

  /** The seeded city's `cityId` (GEN-12 dataset id), checked against REFERENCE_SERVICE by the service. */
  @Prop({ type: String, required: true, trim: true })
  cityId!: string;

  /** ISO 3166-1 alpha-2 of that city, stored for search by country (HTL-11). */
  @Prop({ type: String, required: true, uppercase: true, match: /^[A-Z]{2}$/ })
  countryCode!: string;

  /**
   * IANA zone of the hotel, e.g. Africa/Cairo. Stay dates are hotel-local calendar dates; "check-in
   * cannot be in the past" (HTL-11, HTL-18) and refund days-before (HTL-10) are computed in this zone.
   */
  @Prop({
    type: String,
    required: true,
    validate: {
      validator: (zone: string) => isValidTimeZone(zone),
      message: 'timeZone must be an IANA time zone, e.g. Africa/Cairo',
    },
  })
  timeZone!: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 2000 })
  description!: string;

  /** Public URLs from UPLOADS_SERVICE (GEN-08), at most 5. */
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (images: string[]) =>
        images.length <= UPLOAD_LIMITS.maxImagesPerEntity,
      message: `A hotel can have at most ${UPLOAD_LIMITS.maxImagesPerEntity} images`,
    },
  })
  images!: string[];

  /** 1..5 stars; null when not classified. */
  @Prop({
    type: Number,
    default: null,
    min: 1,
    max: 5,
    validate: {
      validator: (v: number | null) => v === null || Number.isSafeInteger(v),
      message: 'starClass must be a whole number',
    },
  })
  starClass!: number | null;

  @Prop({
    type: [{ type: String, trim: true, minlength: 1, maxlength: 60 }],
    default: [],
    validate: {
      validator: (amenities: string[]) => amenities.length <= 50,
      message: 'A hotel can list at most 50 amenities',
    },
  })
  amenities!: string[];

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({
    type: HotelPolicySchema,
    default: () => ({
      cancellationTiers: [],
      checkInTime: null,
      checkOutTime: null,
    }),
  })
  policy!: HotelPolicyDoc;

  /** Mean rating of visible reviews (HTL-23); null while unrated, so rating filters exclude it (HTL-12). */
  @Prop({ type: Number, default: null, min: 1, max: 5 })
  averageRating!: number | null;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
    validate: safeInteger('ratingCount'),
  })
  ratingCount!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type HotelDocument = HydratedDocument<Hotel>;
export const HotelSchema = SchemaFactory.createForClass(Hotel);
// HTL-11: active hotels of a city or of a country.
HotelSchema.index({ cityId: 1, isActive: 1 });
HotelSchema.index({ countryCode: 1, isActive: 1 });
