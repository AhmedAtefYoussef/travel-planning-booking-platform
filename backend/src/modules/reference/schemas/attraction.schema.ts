import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

/** attractions (brief section 5.1): seeded from Attractions.csv; `attractionId` stores `attraction_id`. */
@Schema({ ...SCHEMA_OPTIONS, collection: 'attractions' })
export class Attraction {
  @Prop({ type: String, required: true, unique: true })
  attractionId!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, index: true })
  cityId!: string;
}

export type AttractionDocument = HydratedDocument<Attraction>;
export const AttractionSchema = SchemaFactory.createForClass(Attraction);
