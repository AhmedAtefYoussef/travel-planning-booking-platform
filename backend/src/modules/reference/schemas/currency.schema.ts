import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

/** currencies (GEN-12): the distinct `currency` values of Countries.csv (brief section 5.1). */
@Schema({ ...SCHEMA_OPTIONS, collection: 'currencies' })
export class Currency {
  @Prop({
    type: String,
    required: true,
    unique: true,
    match: /^[A-Z]{3}$/,
  })
  code!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** Minor-unit digits (USD 2, JPY 0), used for integer money (PAY-04). */
  @Prop({ type: Number, required: true, min: 0, max: 4 })
  minorUnits!: number;
}

export type CurrencyDocument = HydratedDocument<Currency>;
export const CurrencySchema = SchemaFactory.createForClass(Currency);
