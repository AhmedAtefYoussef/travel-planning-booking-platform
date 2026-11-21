import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

/** countries (GEN-12): seeded from Countries.csv; `code` is the dataset's ISO country code. */
@Schema({ ...SCHEMA_OPTIONS, collection: 'countries' })
export class Country {
  @Prop({
    type: String,
    required: true,
    unique: true,
    match: /^[A-Z]{2}$/,
  })
  code!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  /** ISO 4217 code; the distinct values are the supported currencies (brief section 5.1). */
  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  currency!: string;
}

export type CountryDocument = HydratedDocument<Country>;
export const CountrySchema = SchemaFactory.createForClass(Country);
