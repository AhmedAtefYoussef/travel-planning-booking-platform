import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus, SCHEMA_OPTIONS } from '../../../common/contracts';
import { safeInteger } from '../../../common/validation';

export const HOTEL_RESERVATIONS_COLLECTION = 'hotel_reservations';

const money = (field: string, min = 0) => ({
  type: Number,
  required: true,
  min,
  validate: safeInteger(field),
});

/** One hotel cancellation tier as it was when the reservation was made (PAY-02 snapshot, HTL-10). */
@Schema({ _id: false })
export class ReservationTier {
  @Prop({ type: Number, required: true, min: 0 }) daysBefore!: number;
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercent!: number;
}
const ReservationTierSchema = SchemaFactory.createForClass(ReservationTier);

/**
 * One room of the reservation (HTL-16): its guests and its price per night at booking time, so later
 * room edits never change an existing reservation (HTL-05).
 */
@Schema({ _id: false })
export class ReservationRoom {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  roomId!: Types.ObjectId;

  @Prop({ type: String, required: true }) number!: string;
  @Prop({ type: String, required: true }) type!: string;
  @Prop({ type: Number, required: true, min: 1 }) beds!: number;
  @Prop({ type: Number, required: true, min: 1 }) maxOccupancy!: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: safeInteger('adults'),
  })
  adults!: number;

  /** Ages 0-17 of the children in this room (HTL-16). */
  @Prop({ type: [Number], default: [] })
  childrenAges!: number[];

  /** The room's price per night at booking time (HTL-16). */
  @Prop(money('nightlyPriceMinor', 1)) nightlyPriceMinor!: number;

  /** nights x nightlyPriceMinor. */
  @Prop(money('subtotalMinor', 1)) subtotalMinor!: number;
}
const ReservationRoomSchema = SchemaFactory.createForClass(ReservationRoom);

/**
 * hotel_reservations (TRVL-139 design, built with HTL-16/17/18). One reservation is one or more rooms
 * of one hotel for the same dates, with the GEN-11 lifecycle. Its nights are held in room_nights
 * (one HELD document per room per night, unique {roomId, date}, ADR-0002) when it is created
 * PENDING_PAYMENT; they become BOOKED when it is CONFIRMED and are deleted when it EXPIRES.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: HOTEL_RESERVATIONS_COLLECTION })
export class HotelReservation {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PendingPayment,
  })
  status!: BookingStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  hotelId!: Types.ObjectId;

  /** Hotel details at booking time, shown on the reservation and the confirmation (HTL-17). */
  @Prop({ type: String, required: true }) hotelName!: string;
  @Prop({ type: String, required: true }) hotelAddress!: string;
  @Prop({ type: String, required: true }) cityId!: string;
  @Prop({ type: String, required: true }) countryCode!: string;
  @Prop({ type: String, required: true }) timeZone!: string;

  /** Hotel-local dates; nights = checkIn .. the day before checkOut. */
  @Prop({ type: String, required: true }) checkIn!: string;
  @Prop({ type: String, required: true }) checkOut!: string;
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: safeInteger('nights'),
  })
  nights!: number;

  /** The hotel's check-in/out times at booking time, "HH:mm" hotel-local (HTL-09, PAY-02). */
  @Prop({ type: String, required: true }) checkInTime!: string;
  @Prop({ type: String, required: true }) checkOutTime!: string;

  /** Check-in instant: cancellation days-before are counted to it (HTL-10, PAY-03). */
  @Prop({ type: Date, required: true }) checkInUtc!: Date;
  /** Check-out instant: the reservation becomes COMPLETED after it (GEN-11). */
  @Prop({ type: Date, required: true }) checkOutUtc!: Date;

  @Prop({
    type: [ReservationRoomSchema],
    required: true,
    validate: {
      validator: (v: unknown[]) => v.length >= 1,
      message: 'A reservation has at least one room',
    },
  })
  rooms!: ReservationRoom[];

  /** The hotel's tiers at booking time (HTL-10, PAY-02). */
  @Prop({ type: [ReservationTierSchema], default: [] })
  cancellationTiers!: ReservationTier[];

  /** Amount to pay, minor units of PLATFORM_CURRENCY (PAY-04). */
  @Prop(money('totalMinor', 1)) totalMinor!: number;

  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  currency!: string;

  /** End of the 10-minute hold (HTL-18). */
  @Prop({ type: Date, required: true })
  holdExpiresAt!: Date;

  /** PAY-02: when the user accepted the snapshot policies; payment is blocked until then. */
  @Prop({ type: Date, default: null })
  policiesAcceptedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  paymentId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  refundId!: Types.ObjectId | null;

  /** Unique booking reference, assigned on confirmation (HTL-17). */
  @Prop({ type: String, default: undefined })
  reference?: string;

  /** Message of the last failed payment attempt (PAY-01); the user can retry until the hold ends. */
  @Prop({ type: String, default: null, maxlength: 500 })
  lastPaymentError!: string | null;

  @Prop({ type: Date, default: null }) confirmedAt!: Date | null;
  @Prop({ type: Date, default: null }) expiredAt!: Date | null;
  /** Set once PAYMENT_HOLD_RELEASE cancelled the PaymentIntent of an expired hold (retried until then). */
  @Prop({ type: Date, default: null }) paymentReleasedAt!: Date | null;
  @Prop({ type: Date, default: null }) completedAt!: Date | null;
  @Prop({ type: Date, default: null }) cancelledAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type HotelReservationDocument = HydratedDocument<HotelReservation>;
export const HotelReservationSchema =
  SchemaFactory.createForClass(HotelReservation);

// HTL-17: references are unique among reservations that have one.
HotelReservationSchema.index(
  { reference: 1 },
  {
    unique: true,
    partialFilterExpression: { reference: { $type: 'string' } },
    name: 'uniq_reference',
  },
);
// GEN-11 jobs: expired holds, finished stays, payments to release.
HotelReservationSchema.index({ status: 1, holdExpiresAt: 1 });
HotelReservationSchema.index({ status: 1, checkOutUtc: 1 });
HotelReservationSchema.index({ status: 1, paymentReleasedAt: 1 });
// "My reservations" (HTL-20) and a hotel's reservations (HTL-22).
HotelReservationSchema.index({ userId: 1, createdAt: -1 });
HotelReservationSchema.index({ hotelId: 1, status: 1 });
