import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { safeInteger } from '../../common/validation';
import { isoDate } from './schema-validators';

/**
 * HTL-04: a bookable date range. Ranges of one room must not overlap; that
 * check spans the whole array, so the rooms service enforces it.
 */
@Schema({ _id: false })
export class AvailabilityRange {
  @Prop({ type: String, required: true, validate: isoDate }) from: string;

  @Prop({
    type: String,
    required: true,
    validate: [
      isoDate,
      {
        validator(this: AvailabilityRange, to: string) {
          return typeof this.from !== 'string' || this.from < to;
        },
        message: 'availability "from" must be before "to"',
      },
    ],
  })
  to: string;
}
export const AvailabilityRangeSchema =
  SchemaFactory.createForClass(AvailabilityRange);

@Schema({ collection: 'rooms', timestamps: true })
export class Room {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  /** Unique within its hotel (HTL-03). */
  @Prop({ required: true, trim: true }) number: string;
  @Prop({ required: true, trim: true }) type: string;
  @Prop({ required: true, min: 1, validate: safeInteger('beds') }) beds: number;
  @Prop({ required: true, min: 1, validate: safeInteger('maxOccupancy') })
  maxOccupancy: number;

  /** Price per night in PLATFORM_CURRENCY minor units. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: safeInteger('priceMinor'),
  })
  priceMinor: number;

  @Prop({ type: [AvailabilityRangeSchema], default: [] })
  availability: AvailabilityRange[];

  @Prop({ default: true }) active: boolean;

  /** Set on first reservation; such rooms can be deactivated, not deleted. */
  @Prop({ default: false }) everReserved: boolean;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);
/** HTL-03: room number is unique per hotel, even under concurrent creates. */
RoomSchema.index({ hotelId: 1, number: 1 }, { unique: true });
