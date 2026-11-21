import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

/**
 * airports (GEN-12, FLT-02): seeded from Airports.csv and read-only through the API.
 * `iataCode` stores the dataset's `iata_code`; flights reference airports by this code.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: 'airports' })
export class Airport {
  @Prop({
    type: String,
    required: true,
    unique: true,
    match: /^[A-Z]{3}$/,
  })
  iataCode!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, index: true })
  cityId!: string;

  @Prop({ type: String, required: true, match: /^[A-Z]{2}$/ })
  countryCode!: string;

  /** IANA zone used to enter and display flight times (FLT-03, GEN-06). */
  @Prop({ type: String, required: true })
  timeZone!: string;
}

export type AirportDocument = HydratedDocument<Airport>;
export const AirportSchema = SchemaFactory.createForClass(Airport);
