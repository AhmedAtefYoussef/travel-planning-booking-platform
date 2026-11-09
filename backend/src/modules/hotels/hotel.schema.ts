import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { CancellationTier as CancellationTierShape } from '../../common/contracts/policies.contract';
import { HH_MM, integer } from './schema-validators';

export const MAX_HOTEL_PHOTOS = 5;

/** HTL-10: refund % when cancelling at least `daysBefore` days before check-in. */
@Schema({ _id: false })
export class CancellationTier implements CancellationTierShape {
  @Prop({ required: true, min: 0, validate: integer })
  daysBefore: number;

  @Prop({ required: true, min: 0, max: 100, validate: integer })
  refundPercent: number;
}
export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, trim: true }) address: string;
  @Prop({ required: true }) cityId: string;
  /** ISO 3166-1 alpha-2, e.g. "EG". */
  @Prop({ required: true, uppercase: true }) countryCode: string;
  @Prop({ default: '' }) description: string;

  /** Public URLs from UploadsService (StoredImage.url). */
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (v: string[]) => v.length <= MAX_HOTEL_PHOTOS,
      message: `A hotel can have at most ${MAX_HOTEL_PHOTOS} photos`,
    },
  })
  photos: string[];

  @Prop({ min: 1, max: 5, validate: integer }) starClass?: number;
  @Prop({ type: [String], default: [] }) amenities: string[];

  /** HTL-09: local time "HH:mm" in the hotel's time zone. */
  @Prop({ match: HH_MM }) checkInTime?: string;
  @Prop({ match: HH_MM }) checkOutTime?: string;

  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];

  @Prop({ default: true }) active: boolean;

  /** Kept in sync from visible reviews. */
  @Prop({ default: 0, min: 0, max: 5 }) ratingAvg: number;
  @Prop({ default: 0, min: 0, validate: integer }) ratingCount: number;
}

export type HotelDocument = HydratedDocument<Hotel>;
export const HotelSchema = SchemaFactory.createForClass(Hotel);
/** HTL-11: search by city or by country, active hotels only. */
HotelSchema.index({ cityId: 1, active: 1 });
HotelSchema.index({ countryCode: 1, active: 1 });
