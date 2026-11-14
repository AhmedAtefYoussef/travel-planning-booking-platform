import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus, SCHEMA_OPTIONS } from '../../../common/contracts';
import {
  BOOKING_STATUS,
  LIFECYCLE_INDEXES,
  MINOR_AMOUNT,
  REFERENCE_INDEX_OPTIONS,
} from './booking-fields';

export const HOTEL_RESERVATIONS_COLLECTION = 'hotel_reservations';

/** HTL-16: one room of a reservation, with its guests and the price per night it was booked at (HTL-05). */
@Schema({ _id: false })
export class ReservedRoom {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  roomId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  roomNumber!: string;

  @Prop({ type: Number, required: true, min: 0 })
  adults!: number;

  /** Ages 0-17 (HTL-16). */
  @Prop({
    type: [Number],
    default: [],
    validate: {
      validator: (ages: number[]) =>
        ages.every((a) => Number.isSafeInteger(a) && a >= 0 && a <= 17),
      message: 'Children ages must be whole numbers from 0 to 17',
    },
  })
  childrenAges!: number[];

  /** Stored at booking time and never re-read from the room afterwards (HTL-05 contract). */
  @Prop(MINOR_AMOUNT)
  nightlyPriceMinor!: number;

  /** nights x nightlyPriceMinor. */
  @Prop(MINOR_AMOUNT)
  subtotalMinor!: number;
}
const ReservedRoomSchema = SchemaFactory.createForClass(ReservedRoom);

/**
 * hotel_reservations (TRVL-139, GEN-11). Created PENDING_PAYMENT by the HTL-18 all-or-nothing hold;
 * every held night is a room_nights document (unique {roomId, date}, ADR-0002).
 */
@Schema({ ...SCHEMA_OPTIONS, collection: HOTEL_RESERVATIONS_COLLECTION })
export class HotelReservation {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  hotelId!: Types.ObjectId;

  /** Hotel-local dates, YYYY-MM-DD; check-out is the first night not included. */
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  checkIn!: string;

  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  checkOut!: string;

  @Prop({ type: Number, required: true, min: 1 })
  nights!: number;

  /** IANA zone the local dates belong to, fixed at booking time. */
  @Prop({ type: String, required: true })
  timeZone!: string;

  @Prop({
    type: [ReservedRoomSchema],
    required: true,
    validate: {
      validator: (v: unknown[]) => v.length >= 1,
      message: 'A reservation needs at least one room',
    },
  })
  rooms!: ReservedRoom[];

  @Prop(MINOR_AMOUNT)
  totalMinor!: number;

  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  currency!: string;

  @Prop(BOOKING_STATUS)
  status!: BookingStatus;

  @Prop({ type: Date, required: true })
  holdExpiresAt!: Date;

  /** Start of the check-in day in the hotel's zone (ACC-12 "upcoming"). */
  @Prop({ type: Date, required: true })
  startsAt!: Date;

  /** Start of the check-out day in the hotel's zone; completion runs after it (GEN-11). */
  @Prop({ type: Date, required: true })
  endsAt!: Date;

  /** PAY-02: cancellation tiers and check-in/out times as accepted, used for refunds (PAY-03). */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  policySnapshot!: Record<string, unknown> | null;

  @Prop({ type: Date, default: null })
  policiesAcceptedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  paymentId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  refundId!: Types.ObjectId | null;

  /** Assigned on confirmation (HTL-17). */
  @Prop({ type: String, default: null })
  reference!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type HotelReservationDocument = HydratedDocument<HotelReservation>;
export const HotelReservationSchema =
  SchemaFactory.createForClass(HotelReservation);
HotelReservationSchema.index({ reference: 1 }, REFERENCE_INDEX_OPTIONS);
for (const index of LIFECYCLE_INDEXES) HotelReservationSchema.index(index);
HotelReservationSchema.index({ hotelId: 1, status: 1 });
