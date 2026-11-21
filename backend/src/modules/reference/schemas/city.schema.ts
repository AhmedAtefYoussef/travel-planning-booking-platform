import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

/** cities (GEN-12): seeded from Cities.csv; `cityId` stores the dataset's `city_id`. */
@Schema({ ...SCHEMA_OPTIONS, collection: 'cities' })
export class City {
  @Prop({ type: String, required: true, unique: true })
  cityId!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, index: true, match: /^[A-Z]{2}$/ })
  countryCode!: string;
}

export type CityDocument = HydratedDocument<City>;
export const CitySchema = SchemaFactory.createForClass(City);
