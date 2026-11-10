import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

/**
 * exchange_rates (TRVL-133, ITN-18): one document per base currency and rate day, holding the rates
 * FXRatesAPI returned for the supported currencies. `rates[CODE]` means "1 unit of base = rate units
 * of CODE". The newest document is the cache every conversion reads, so the API being down never
 * blocks a budget summary as long as one fetch ever succeeded.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: 'exchange_rates' })
export class ExchangeRate {
  /** Always PLATFORM_CURRENCY (PAY-04). */
  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  base!: string;

  /** The day the rates are from, as reported by the API (UTC, YYYY-MM-DD). Shown to users (ITN-18). */
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  rateDate!: string;

  @Prop({ type: Map, of: Number, required: true })
  rates!: Map<string, number>;

  /** When this backend last stored the document; drives the once-per-day fetch. */
  @Prop({ type: Date, required: true })
  fetchedAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;
export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
// One document per base and day: a second fetch on the same rate day updates it instead of adding one.
ExchangeRateSchema.index(
  { base: 1, rateDate: 1 },
  { unique: true, name: 'uniq_base_rate_date' },
);
