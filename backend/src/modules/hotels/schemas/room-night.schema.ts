import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { calendarDate } from '../../../common/validation';

export const ROOM_NIGHTS_COLLECTION = 'room_nights';

export enum RoomNightKind {
  /** Owner-blocked date (HTL-06). */
  BLOCKED = 'BLOCKED',
  /** 10-minute hold while the reservation awaits payment. */
  HELD = 'HELD',
  BOOKED = 'BOOKED',
}

/**
 * One document per room per night (ADR-002). Bookings insert these inside a
 * transaction; the unique {roomId, date} index rejects any overlap.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: ROOM_NIGHTS_COLLECTION })
export class RoomNight {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
    index: true,
  })
  hotelId: Types.ObjectId;

  /** The night, as the hotel's local calendar date. */
  @Prop({ type: String, required: true, validate: calendarDate('date') })
  date: string;

  @Prop({ type: String, required: true, enum: RoomNightKind })
  kind: RoomNightKind;

  /** Null for BLOCKED nights. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelReservation',
    default: null,
    index: true,
  })
  reservationId: Types.ObjectId | null;

  @Prop({ type: String, default: null }) reference: string | null;

  /** End of the hold for HELD nights; released by the expiry job. */
  @Prop({ type: Date, default: null }) expiresAt: Date | null;
}

export type RoomNightDocument = HydratedDocument<RoomNight>;
export const RoomNightSchema = SchemaFactory.createForClass(RoomNight);
/** A room can be held, booked or blocked at most once per night. */
RoomNightSchema.index({ roomId: 1, date: 1 }, { unique: true });
