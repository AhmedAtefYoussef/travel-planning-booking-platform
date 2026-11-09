import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'exchange_rates', timestamps: true, versionKey: false })
export class ExchangeRate {
  @Prop({ required: true, default: 'USD' })
  base: string;

  /** Date reported by the FX API (YYYY-MM-DD); unique per snapshot. */
  @Prop({ required: true, unique: true })
  rateDate: string;

  /** UTC day (YYYY-MM-DD) on which we fetched this snapshot. */
  @Prop()
  fetchedDate?: string;

  @Prop({ type: Object, required: true })
  rates: Record<string, number>;
}

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;
export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
