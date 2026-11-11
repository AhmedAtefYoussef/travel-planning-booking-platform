import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  BookingStatus,
  PassengerType,
  SCHEMA_OPTIONS,
  type CabinClass,
} from '../../../common/contracts';
import { CABIN_CLASSES } from '../../flights';
import { safeInteger } from '../../../common/validation';

export const FLIGHT_BOOKINGS_COLLECTION = 'flight_bookings';

const money = (field: string) => ({
  type: Number,
  required: true,
  min: 0,
  validate: safeInteger(field),
});

/** One cancellation tier as it was when the booking was made (PAY-02 policy snapshot). */
@Schema({ _id: false })
export class TierSnapshot {
  @Prop({ type: Number, required: true, min: 0 }) daysBefore!: number;
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercent!: number;
}
const TierSnapshotSchema = SchemaFactory.createForClass(TierSnapshot);

/** The airline's extra-baggage policy as it was when the booking was made (FLT-08, PAY-02). */
@Schema({ _id: false })
export class ExtraBaggageSnapshot {
  @Prop(money('pricePerBagMinor')) pricePerBagMinor!: number;
  @Prop({ type: Number, required: true, min: 0 })
  maxExtraBagsPerPassenger!: number;
}
const ExtraBaggageSnapshotSchema =
  SchemaFactory.createForClass(ExtraBaggageSnapshot);

/**
 * One flight of the booking (FLT-12: one segment one-way, two for a round trip). Everything needed
 * to show, price, cancel or refund the booking is copied here at hold time, so later edits to the
 * flight, cabin price or airline policy never change an existing booking (FLT-05, PAY-02).
 */
@Schema({ _id: false })
export class BookingSegment {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  flightId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  airlineId!: Types.ObjectId;

  @Prop({ type: String, required: true }) airlineName!: string;
  @Prop({ type: String, required: true }) airlineCode!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  cabinId!: Types.ObjectId;

  @Prop({ type: String, enum: CABIN_CLASSES, required: true })
  cabinClass!: CabinClass;

  @Prop({ type: String, required: true }) flightNumber!: string;
  @Prop({ type: String, required: true }) from!: string;
  @Prop({ type: String, required: true }) to!: string;
  @Prop({ type: String, required: true }) fromTimeZone!: string;
  @Prop({ type: String, required: true }) toTimeZone!: string;
  @Prop({ type: Date, required: true }) departureUtc!: Date;
  @Prop({ type: Date, required: true }) arrivalUtc!: Date;
  /** YYYY-MM-DD at the departure airport; passenger types are checked against it (FLT-12). */
  @Prop({ type: String, required: true }) departureLocalDate!: string;

  /** Seats taken from the cabin by this booking: adults and children on this segment (FLT-12). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: safeInteger('seats'),
  })
  seats!: number;

  /** Cabin fare per seat at booking time (FLT-05: later price changes do not apply). */
  @Prop(money('farePerSeatMinor')) farePerSeatMinor!: number;
  /** What one infant pays on this segment: 10% of the fare, rounded down (FLT-12). */
  @Prop(money('infantFareMinor')) infantFareMinor!: number;

  @Prop({ type: Number, required: true, min: 0 }) freeBags!: number;
  @Prop({ type: Number, required: true, min: 1 }) maxKgPerBag!: number;

  /** Null when the airline sold no extra bags at booking time. */
  @Prop({ type: ExtraBaggageSnapshotSchema, default: null })
  extraBaggage!: ExtraBaggageSnapshot | null;

  /** The airline's tiers at booking time; the outbound segment's apply to cancellations (FLT-12). */
  @Prop({ type: [TierSnapshotSchema], default: [] })
  cancellationTiers!: TierSnapshot[];

  /** Fares + infant fares + extra-bag fees of this segment, minor units. */
  @Prop(money('subtotalMinor')) subtotalMinor!: number;
}
const BookingSegmentSchema = SchemaFactory.createForClass(BookingSegment);

/** One traveller (FLT-19). */
@Schema({ _id: false })
export class BookingPassenger {
  @Prop({ type: String, required: true, trim: true }) fullName!: string;
  /** YYYY-MM-DD */
  @Prop({ type: String, required: true }) dateOfBirth!: string;
  /** Passport or national ID number, stored in capitals. */
  @Prop({ type: String, required: true }) documentNumber!: string;

  /** Type on each segment, in segment order (a baby may turn 2 between the two flights, FLT-12). */
  @Prop({
    type: [String],
    enum: Object.values(PassengerType),
    required: true,
  })
  types!: PassengerType[];

  /** Extra checked bags bought for this passenger on each segment (FLT-19). */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: safeInteger('extraBags'),
  })
  extraBags!: number;
}
const BookingPassengerSchema = SchemaFactory.createForClass(BookingPassenger);

@Schema({ _id: false })
export class PriceBreakdown {
  /** Adult and child fares on every segment. */
  @Prop(money('faresMinor')) faresMinor!: number;
  /** Infant fares on every segment. */
  @Prop(money('infantFaresMinor')) infantFaresMinor!: number;
  /** Extra-bag fees on every segment (FLT-19). */
  @Prop(money('baggageMinor')) baggageMinor!: number;
}
const PriceBreakdownSchema = SchemaFactory.createForClass(PriceBreakdown);

/**
 * flight_bookings (TRVL-139 design, built with FLT-22). A booking is one or two segments, its
 * passengers, the agreed price and the GEN-11 lifecycle. Seats are held on the flight document with
 * the ADR-0002 conditional $inc when the booking is created PENDING_PAYMENT; they stay taken when it
 * is CONFIRMED and are given back when it EXPIRES or is CANCELLED.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: FLIGHT_BOOKINGS_COLLECTION })
export class FlightBooking {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PendingPayment,
  })
  status!: BookingStatus;

  @Prop({
    type: [BookingSegmentSchema],
    required: true,
    validate: {
      validator: (v: unknown[]) => v.length >= 1 && v.length <= 2,
      message: 'A booking has one segment (one-way) or two (round trip)',
    },
  })
  segments!: BookingSegment[];

  @Prop({
    type: [BookingPassengerSchema],
    required: true,
    validate: {
      validator: (v: unknown[]) => v.length >= 1,
      message: 'A booking needs at least one passenger',
    },
  })
  passengers!: BookingPassenger[];

  @Prop({ type: PriceBreakdownSchema, required: true })
  priceBreakdown!: PriceBreakdown;

  /** Amount to pay, minor units of PLATFORM_CURRENCY (PAY-04). */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: safeInteger('totalMinor'),
  })
  totalMinor!: number;

  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  currency!: string;

  /** End of the 10-minute hold (FLT-22). */
  @Prop({ type: Date, required: true })
  holdExpiresAt!: Date;

  /** Arrival of the last segment; the booking becomes COMPLETED after it (GEN-11). */
  @Prop({ type: Date, required: true })
  lastArrivalUtc!: Date;

  /** PAY-02: when the user accepted the snapshot policies; payment is blocked until then. */
  @Prop({ type: Date, default: null })
  policiesAcceptedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  paymentId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  refundId!: Types.ObjectId | null;

  /** Unique booking reference, assigned on confirmation (FLT-23). */
  @Prop({ type: String, default: undefined })
  reference?: string;

  /** Message of the last failed payment attempt (PAY-01); the user can retry until the hold ends. */
  @Prop({ type: String, default: null, maxlength: 500 })
  lastPaymentError!: string | null;

  @Prop({ type: Date, default: null }) confirmedAt!: Date | null;
  @Prop({ type: Date, default: null }) expiredAt!: Date | null;
  /**
   * Set once PAYMENT_HOLD_RELEASE cancelled the PaymentIntent of an expired hold. Until then the
   * lifecycle job keeps retrying, so a crash or a Stripe outage never leaves a payable intent open.
   */
  @Prop({ type: Date, default: null }) paymentReleasedAt!: Date | null;
  @Prop({ type: Date, default: null }) completedAt!: Date | null;
  @Prop({ type: Date, default: null }) cancelledAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type FlightBookingDocument = HydratedDocument<FlightBooking>;
export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

// FLT-23: references are unique among bookings that have one.
FlightBookingSchema.index(
  { reference: 1 },
  {
    unique: true,
    partialFilterExpression: { reference: { $type: 'string' } },
    name: 'uniq_reference',
  },
);
// GEN-11 jobs: expired holds and finished trips.
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
FlightBookingSchema.index({ status: 1, lastArrivalUtc: 1 });
FlightBookingSchema.index({ status: 1, paymentReleasedAt: 1 });
// "My bookings" (FLT-25) and bookings per flight (FLT-05 notifications, FLT-06, FLT-29).
FlightBookingSchema.index({ userId: 1, createdAt: -1 });
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
