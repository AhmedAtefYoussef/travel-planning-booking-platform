import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { safeInteger } from '../../../common/validation';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

export const AIRLINES_COLLECTION = 'airlines';

/** One tier of the airline cancellation policy (FLT-09); same shape as CancellationTier. */
@Schema({ _id: false })
export class CancellationTierDoc {
  /** Whole days before departure, >= 0, unique within the policy (checked by the policy DTO). */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: safeInteger('daysBefore'),
  })
  daysBefore!: number;

  /** 0..100, up to two decimals. */
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercent!: number;
}
const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTierDoc);

/** FLT-08 extra baggage; same shape as ExtraBaggagePolicy. */
@Schema({ _id: false })
export class ExtraBaggageDoc {
  /** > 0, minor units of PLATFORM_CURRENCY (PAY-04). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: safeInteger('pricePerBagMinor'),
  })
  pricePerBagMinor!: number;

  /** >= 0 */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: safeInteger('maxExtraBagsPerPassenger'),
  })
  maxExtraBagsPerPassenger!: number;
}
const ExtraBaggageSchema = SchemaFactory.createForClass(ExtraBaggageDoc);

@Schema({ _id: false })
export class AirlinePolicyDoc {
  /** Empty means no tier applies, so a user cancellation refunds 0% (FLT-09). */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers!: CancellationTierDoc[];

  /** Absent until the moderator sets it (FLT-08); then extra bags can be bought (FLT-19). */
  @Prop({ type: ExtraBaggageSchema, default: undefined })
  extraBaggage?: ExtraBaggageDoc;
}
const AirlinePolicySchema = SchemaFactory.createForClass(AirlinePolicyDoc);

/**
 * airlines (TRVL-138, FLT-01, docs/architecture/erd.md). Created by an admin; edited by the airline
 * moderator assigned to it (assignedProvider, ACC-13). `isActive` false hides its flights from search
 * and booking while existing Confirmed bookings stay valid (ACC-15, ACTIVE_PROVIDER_FILTER).
 */
@Schema({ ...SCHEMA_OPTIONS, collection: AIRLINES_COLLECTION })
export class Airline {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  })
  name!: string;

  /** Airline designator, e.g. MS or EK (2-3 capital letters or digits); unique. */
  @Prop({
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z0-9]{2,3}$/,
  })
  code!: string;

  /** Public URL from UPLOADS_SERVICE (GEN-08, one logo per airline). */
  @Prop({ type: String, default: null })
  logoUrl!: string | null;

  @Prop({ type: Boolean, default: true, index: true })
  isActive!: boolean;

  @Prop({
    type: AirlinePolicySchema,
    default: () => ({ cancellationTiers: [] }),
  })
  policy!: AirlinePolicyDoc;

  createdAt!: Date;
  updatedAt!: Date;
}

export type AirlineDocument = HydratedDocument<Airline>;
export const AirlineSchema = SchemaFactory.createForClass(Airline);
