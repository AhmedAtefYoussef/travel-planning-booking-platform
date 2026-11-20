import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { safeInteger } from '../../../common/validation';

export const TRANSPORT_COSTS_COLLECTION = 'transport_costs';

/** ITN-16: how the traveller goes from one city to the next. */
export enum TransportMode {
  Flight = 'FLIGHT',
  Train = 'TRAIN',
  Bus = 'BUS',
  Car = 'CAR',
  Ferry = 'FERRY',
  Other = 'OTHER',
}

/**
 * transport_costs (TRVL-143). An intercity transport cost on one itinerary day, between two
 * reference cities (dataset city ids), in integer minor units of the chosen currency.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: TRANSPORT_COSTS_COLLECTION })
export class TransportCost {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
  })
  itineraryId!: Types.ObjectId;

  /** The embedded itinerary day's _id. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  dayId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(TransportMode), required: true })
  mode!: TransportMode;

  @Prop({ type: String, required: true, trim: true })
  fromCityId!: string;

  @Prop({ type: String, required: true, trim: true })
  toCityId!: string;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: safeInteger('amountMinor'),
  })
  amountMinor!: number;

  @Prop({ type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ })
  currency!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type TransportCostDocument = HydratedDocument<TransportCost>;
export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);
TransportCostSchema.index({ itineraryId: 1, dayId: 1 });
