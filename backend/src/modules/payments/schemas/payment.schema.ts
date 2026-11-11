import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingType, SCHEMA_OPTIONS } from '../../../common/contracts';

export enum PaymentStatus {
  RequiresPayment = 'REQUIRES_PAYMENT',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
  Canceled = 'CANCELED',
}

/**
 * payments (TRVL-161, PAY-01, PAY-04). Only Stripe identifiers, amount, currency and status are kept:
 * card data never reaches the backend (Stripe Elements + PaymentIntents, brief section 6.4).
 * One document per booking checkout; retries reuse it and increment `attempts`.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: 'payments' })
export class Payment {
  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType!: BookingType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, match: /^pi_/ })
  stripePaymentIntentId!: string;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isSafeInteger,
      message: 'amountMinor must be an integer',
    },
  })
  amountMinor!: number;

  /** Always PLATFORM_CURRENCY (PAY-04); stored for an explicit audit trail. */
  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  currency!: string;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.RequiresPayment,
  })
  status!: PaymentStatus;

  @Prop({ type: Number, default: 1, min: 1 })
  attempts!: number;

  /** Failure message from Stripe for the last attempt, shown to the user (PAY-01). */
  @Prop({ type: String, maxlength: 500 })
  lastError?: string;

  /**
   * Set when a payment that could not confirm its booking (paid after the hold ended, flight
   * cancelled, amount mismatch) was refunded in full through Stripe. Until then the hold-expiry sweep
   * keeps retrying the refund, so nobody stays charged without a booking.
   */
  @Prop({ type: String, match: /^re_/ })
  lateRefundId?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ bookingType: 1, bookingId: 1 });
PaymentSchema.index({ userId: 1, createdAt: -1 });
// At most one successful payment per booking, even under concurrent webhooks.
PaymentSchema.index(
  { bookingType: 1, bookingId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: PaymentStatus.Succeeded },
    name: 'one_success_per_booking',
  },
);
