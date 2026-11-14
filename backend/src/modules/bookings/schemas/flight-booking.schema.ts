import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus, SCHEMA_OPTIONS } from '../../../common/contracts';
import {
  addLifecycle,
  BOOKING_STATUS,
  CancelledBy,
  MINOR_AMOUNT,
} from './booking-fields';

export const FLIGHT_BOOKINGS_COLLECTION = 'flight_bookings';

export enum TripType {
  OneWay = 'ONE_WAY',
  RoundTrip = 'ROUND_TRIP',
}

/** FLT-12: by age at departure. Infants pay 10% of the fare and take no seat. */
export enum PassengerType {
  Adult = 'ADULT',
  Child = 'CHILD',
  Infant = 'INFANT',
}

/** One flown leg, copied at hold time so later flight edits never change what was sold (FLT-12). */
@Schema({ _id: false })
export class FlightSegment {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  flightId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  cabinId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  cabinClass!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  airlineId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  flightNumber!: string;

  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  from!: string;

  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  to!: string;

  @Prop({ type: Date, required: true })
  departureUtc!: Date;

  @Prop({ type: Date, required: true })
  arrivalUtc!: Date;

  /** Seats taken on this leg: adults + children (infants sit on a lap). */
  @Prop({ type: Number, required: true, min: 1 })
  seats!: number;

  /** Cabin fare per seat at hold time. */
  @Prop(MINOR_AMOUNT)
  fareMinor!: number;
}
const FlightSegmentSchema = SchemaFactory.createForClass(FlightSegment);

/** FLT-19: passenger details. Passport or ID number only; no other document data is stored. */
@Schema({ _id: false })
export class Passenger {
  @Prop({ type: String, enum: Object.values(PassengerType), required: true })
  type!: PassengerType;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  firstName!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  lastName!: string;

  /** YYYY-MM-DD; the type is validated against it at the departure date (FLT-12, FLT-19). */
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  dateOfBirth!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 30 })
  documentNumber!: string;

  /** FLT-08/FLT-19: extra checked bags bought for this passenger. */
  @Prop({ type: Number, default: 0, min: 0 })
  extraBags!: number;
}
const PassengerSchema = SchemaFactory.createForClass(Passenger);

/**
 * flight_bookings (TRVL-139, GEN-11). Created PENDING_PAYMENT by the FLT-22 hold; confirmed only by a
 * verified payment (PAY-01). A round trip is one booking with two segments, one payment and one reference.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: FLIGHT_BOOKINGS_COLLECTION })
export class FlightBooking {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(TripType), required: true })
  tripType!: TripType;

  @Prop({
    type: [FlightSegmentSchema],
    required: true,
    validate: {
      validator: (v: unknown[]) => v.length >= 1 && v.length <= 2,
      message: 'A booking has one segment (one way) or two (round trip)',
    },
  })
  segments!: FlightSegment[];

  @Prop({
    type: [PassengerSchema],
    required: true,
    validate: {
      validator: (v: unknown[]) => v.length >= 1,
      message: 'A booking needs at least one passenger',
    },
  })
  passengers!: Passenger[];

  @Prop(MINOR_AMOUNT)
  totalMinor!: number;

  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  currency!: string;

  @Prop(BOOKING_STATUS)
  status!: BookingStatus;

  /** End of the 10-minute hold (FLT-22). */
  @Prop({ type: Date, required: true })
  holdExpiresAt!: Date;

  /** First departure (UTC). */
  @Prop({ type: Date, required: true })
  startsAt!: Date;

  /**
   * Last arrival (UTC). The completion job moves CONFIRMED to COMPLETED after it (GEN-11), and until
   * then the booking blocks ACC-12 self-deactivation. FLT-05 schedule changes must update it.
   */
  @Prop({ type: Date, required: true })
  endsAt!: Date;

  /** PAY-02: the airline's cancellation and baggage policies as accepted, used for refunds (PAY-03). */
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

export type FlightBookingDocument = HydratedDocument<FlightBooking>;
export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);
addLifecycle(FlightBookingSchema);
FlightBookingSchema.pre('validate', function () {
  const expected = this.tripType === TripType.RoundTrip ? 2 : 1;
  if (this.segments.length !== expected) {
    this.invalidate(
      'segments',
      this.tripType === TripType.RoundTrip
        ? 'A round trip has exactly two segments (outbound and return)'
        : 'A one-way booking has exactly one segment',
    );
  }
});
// FLT-05 schedule-change notifications and SQ-7 "does this flight have bookings".
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
