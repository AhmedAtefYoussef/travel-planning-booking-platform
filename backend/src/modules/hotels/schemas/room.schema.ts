import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { safeInteger } from '../../../common/validation';
import { isoDate } from './iso-date';

export const ROOMS_COLLECTION = 'rooms';

/**
 * HTL-04: a range of nights when the room is bookable, hotel-local dates. `from` is the first night,
 * `to` the check-out day after the last night (exclusive), the same convention as a stay. Ranges of one
 * room must not overlap; that spans the whole array, so the rooms service enforces it.
 */
@Schema({ _id: false })
export class AvailabilityRangeDoc {
  @Prop({ type: String, required: true, validate: isoDate('from') })
  from!: string;

  @Prop({ type: String, required: true, validate: isoDate('to') })
  to!: string;
}
const AvailabilityRangeSchema =
  SchemaFactory.createForClass(AvailabilityRangeDoc);
// On the range itself, so `this` is always the range (a path validator's `this` is the Query on updates).
AvailabilityRangeSchema.pre(
  'validate',
  function (
    this: AvailabilityRangeDoc & {
      invalidate: (path: string, message: string) => void;
    },
  ) {
    if (
      typeof this.from === 'string' &&
      typeof this.to === 'string' &&
      this.from >= this.to
    ) {
      this.invalidate('to', 'availability "to" must be after "from"');
    }
  },
);

/**
 * rooms (TRVL-140, HTL-03): one individually bookable unit. Its nights are reserved in room_nights,
 * never on this document (ADR-0002). Price edits do not touch existing reservations, which store
 * their own nightly price (HTL-05).
 */
@Schema({ ...SCHEMA_OPTIONS, collection: ROOMS_COLLECTION })
export class Room {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: Types.ObjectId;

  /** Room number or name, unique within its hotel (HTL-03). */
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 30,
  })
  number!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 60,
  })
  type!: string;

  @Prop({ type: Number, required: true, min: 1, validate: safeInteger('beds') })
  beds!: number;

  /** >= 1 guest, adults and children together (HTL-03, HTL-16). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: safeInteger('maxOccupancy'),
  })
  maxOccupancy!: number;

  /** Price per night, > 0, minor units of PLATFORM_CURRENCY (HTL-03, PAY-04). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: safeInteger('priceMinor'),
  })
  priceMinor!: number;

  @Prop({ type: [AvailabilityRangeSchema], default: [] })
  availability!: AvailabilityRangeDoc[];

  /** False: excluded from search and booking (HTL-06). */
  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  /** Set by the first hold; such rooms can be deactivated but never deleted (HTL-06). */
  @Prop({ type: Boolean, default: false })
  everReserved!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);
// HTL-03: the room number is unique per hotel, even under concurrent creates, ignoring case ("a1" = "A1").
// Also serves hotelId lookups.
RoomSchema.index(
  { hotelId: 1, number: 1 },
  {
    unique: true,
    name: 'room_number_per_hotel',
    collation: { locale: 'en', strength: 2 },
  },
);
