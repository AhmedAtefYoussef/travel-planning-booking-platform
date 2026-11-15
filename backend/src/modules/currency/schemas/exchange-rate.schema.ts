import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

/**
 * exchange_rates (ITN-18, TRVL-133): one document per base currency and rate day, fetched once a day
 * from FXRatesAPI. `rates[CODE]` is how many units of CODE one unit of `base` buys; the base itself is
 * not stored (its rate is 1). Old days are kept, so an API outage falls back to the newest cached day.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: 'exchange_rates' })
export class ExchangeRate {
  /** PLATFORM_CURRENCY at fetch time (PAY-04). */
  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  base!: string;

  /** UTC day the rates are for, as reported by the API, YYYY-MM-DD (shown to users, ITN-18). */
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  rateDate!: string;

  @Prop({
    type: Map,
    of: { type: Number, min: Number.MIN_VALUE },
    required: true,
  })
  rates!: Record<string, number>;

  @Prop({ type: Date, required: true })
  fetchedAt!: Date;
}

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;
export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
ExchangeRateSchema.index({ base: 1, rateDate: 1 }, { unique: true });
