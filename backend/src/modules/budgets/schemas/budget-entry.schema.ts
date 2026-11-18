import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { safeInteger } from '../../../common/validation';

export const BUDGET_ENTRIES_COLLECTION = 'budget_entries';

/** ITN-14: the four per-day budget categories. Activity costs (ITN-10) also count under ACTIVITIES. */
export enum BudgetCategory {
  Food = 'FOOD',
  Accommodation = 'ACCOMMODATION',
  InCityTransport = 'IN_CITY_TRANSPORT',
  Activities = 'ACTIVITIES',
}

/**
 * budget_entries (TRVL-143). One non-negative amount for one itinerary day and category, in the
 * currency the user chose (any seeded currency). Amounts are integer minor units of that currency.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: BUDGET_ENTRIES_COLLECTION })
export class BudgetEntry {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
  })
  itineraryId!: Types.ObjectId;

  /** The embedded itinerary day's _id. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  dayId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(BudgetCategory),
    required: true,
  })
  category!: BudgetCategory;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: safeInteger('amountMinor'),
  })
  amountMinor!: number;

  /** ISO 4217 code; membership in the seeded currencies is checked by the service. */
  @Prop({ type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ })
  currency!: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 200 })
  note!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type BudgetEntryDocument = HydratedDocument<BudgetEntry>;
export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);
BudgetEntrySchema.index({ itineraryId: 1, dayId: 1 });
