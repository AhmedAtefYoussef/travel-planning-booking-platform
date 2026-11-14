import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus, SCHEMA_OPTIONS } from '../../../common/contracts';
import {
  addLifecycle,
  BOOKING_STATUS,
  CancelledBy,
  MINOR_AMOUNT,
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

  /** Start of the check-in day in the hotel's zone. */
  @Prop({ type: Date, required: true })
  startsAt!: Date;

  /**
   * End of the check-out day in the hotel's zone (the next day's 00:00). The stay is never completed
   * while the guest may still be in the room, and until then it blocks ACC-12 self-deactivation (GEN-11).
   */
  @Prop({ type: Date, required: true })
  endsAt!: Date;

  /** PAY-02: cancellation tiers and check-in/out times as accepted, used for refunds (PAY-03). */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  policySnapshot!: Record<string, unknown> | null;

  @Prop({ type: Date, default: null })
  policiesAcceptedAt!: Date | null;

  // Added by addLifecycle (booking-fields.ts): reference, paymentId, refundId, confirmedAt, cancelledAt, cancelledBy.
  reference!: string | null;
  paymentId!: Types.ObjectId | null;
  refundId!: Types.ObjectId | null;
  confirmedAt!: Date | null;
  cancelledAt!: Date | null;
  cancelledBy!: CancelledBy | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type HotelReservationDocument = HydratedDocument<HotelReservation>;
export const HotelReservationSchema =
  SchemaFactory.createForClass(HotelReservation);
addLifecycle(HotelReservationSchema);
HotelReservationSchema.pre('validate', function () {
  // ISO dates compare correctly as strings.
  if (this.checkIn && this.checkOut && this.checkOut <= this.checkIn) {
    this.invalidate('checkOut', 'checkOut must be after checkIn');
  }
});
HotelReservationSchema.index({ hotelId: 1, status: 1 });
