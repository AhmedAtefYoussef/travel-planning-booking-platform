import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { calendarDate, safeInteger } from '../../../common/validation';

export const ROOMS_COLLECTION = 'rooms';

/** Most bookable ranges one room may hold (HTL-04), so repeated requests cannot grow it without limit. */
export const MAX_RANGES_PER_ROOM = 200;

/**
 * HTL-04: a bookable date range. Ranges of one room must not overlap; that
 * check spans the whole array, so the rooms service enforces it.
 */
@Schema({ _id: false })
export class AvailabilityRange {
  @Prop({ type: String, required: true, validate: calendarDate('from') })
  from: string;

  @Prop({
    type: String,
    required: true,
    validate: [
      calendarDate('to'),
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

@Schema({ ...SCHEMA_OPTIONS, collection: ROOMS_COLLECTION })
export class Room {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  /** Unique within its hotel (HTL-03). */
  @Prop({ required: true, trim: true }) number: string;
  @Prop({ required: true, trim: true }) type: string;
  @Prop({ required: true, min: 1, validate: safeInteger('beds') }) beds: number;
  @Prop({ required: true, min: 1, validate: safeInteger('maxOccupancy') })
  maxOccupancy: number;

  /** Price per night in PLATFORM_CURRENCY minor units, greater than 0 (HTL-03). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: safeInteger('priceMinor'),
  })
  priceMinor: number;

  @Prop({
    type: [AvailabilityRangeSchema],
    default: [],
    validate: {
      validator: (ranges: unknown[]) => ranges.length <= MAX_RANGES_PER_ROOM,
      message: `A room can have at most ${MAX_RANGES_PER_ROOM} bookable ranges`,
    },
  })
  availability: AvailabilityRange[];

  /** HTL-06: a deactivated room cannot be booked; its existing reservations stay valid. */
  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  /** Set on first reservation; such rooms can be deactivated, not deleted. */
  @Prop({ default: false }) everReserved: boolean;

  /**
   * Incremented (`$inc: { reservationVersion: 1 }`) by every HTL-18 hold transaction. The write always
   * changes the room, so a hold conflicts with a concurrent HTL-05 availability replace instead of
   * interleaving with it; setting `everReserved` alone writes nothing once it is already true.
   */
  @Prop({ type: Number, default: 0 }) reservationVersion: number;

  /** Set by Mongoose `timestamps`. */
  createdAt: Date;
  updatedAt: Date;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);
/**
 * HTL-03: room number is unique per hotel, even under concurrent creates, ignoring case: "a101" and
 * "A101" are the same room. The room keeps the spelling the moderator typed.
 */
export const ROOM_NUMBER_COLLATION = { locale: 'en', strength: 2 } as const;
RoomSchema.index(
  { hotelId: 1, number: 1 },
  { unique: true, collation: ROOM_NUMBER_COLLATION },
);
