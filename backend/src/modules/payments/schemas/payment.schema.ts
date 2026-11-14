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

  /**
   * The booking's hold end, copied at creation: the PaymentIntent is cancelled after it (PAY-01).
   * Named holdEndsAt so no field name looks like card data ("exp") to the schema guard rail.
   */
  @Prop({ type: Date, required: true })
  holdEndsAt!: Date;

  /** When the current attempt started: a payment_failed event created before it is stale and ignored. */
  @Prop({ type: Date, default: () => new Date() })
  attemptStartedAt!: Date;

  /** Cancel-on-expiry backoff: when the job may look at this payment again (null = now). */
  @Prop({ type: Date, default: null })
  nextCheckAt!: Date | null;

  @Prop({ type: Number, default: 0, min: 0 })
  checkAttempts!: number;

  /** Failure message from Stripe for the last attempt, shown to the user (PAY-01). */
  @Prop({ type: String, maxlength: 500 })
  lastError?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ userId: 1, createdAt: -1 });
// The cancel-on-expiry job: open payments whose hold has ended.
PaymentSchema.index(
  { holdEndsAt: 1 },
  {
    partialFilterExpression: {
      status: { $in: [PaymentStatus.RequiresPayment, PaymentStatus.Failed] },
    },
    name: 'open_by_hold_expiry',
  },
);
// At most one successful payment per booking, even under concurrent webhooks.
PaymentSchema.index(
  { bookingType: 1, bookingId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: PaymentStatus.Succeeded },
    name: 'one_success_per_booking',
  },
);
