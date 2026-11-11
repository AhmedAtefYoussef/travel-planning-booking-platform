import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  BookingType,
  RefundReason,
  RefundStatus,
  SCHEMA_OPTIONS,
} from '../../../common/contracts';

@Schema({ _id: false })
export class TierApplied {
  @Prop({ type: Number, required: true, min: 0 }) daysBefore!: number;
  @Prop({ type: Number, required: true, min: 0, max: 100 }) percent!: number;
}
const TierAppliedSchema = SchemaFactory.createForClass(TierApplied);

/**
 * refunds (TRVL-161, PAY-03): one per cancellation with a positive amount. Status moves
 * PENDING -> REFUNDED | FAILED (and REFUNDED -> FAILED if Stripe later fails it) from the Stripe
 * response and webhook events, and is shown on the booking details.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: 'refunds' })
export class Refund {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  paymentId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType!: BookingType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** Set once Stripe accepts the refund request; unique among documents that have one. */
  @Prop({ type: String, match: /^re_/ })
  stripeRefundId?: string;

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

  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  currency!: string;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercent!: number;

  /** Null for provider cancellations (always 100%, FLT-06). */
  @Prop({ type: TierAppliedSchema, default: null })
  tierApplied!: TierApplied | null;

  @Prop({ type: String, enum: Object.values(RefundReason), required: true })
  reason!: RefundReason;

  @Prop({
    type: String,
    enum: Object.values(RefundStatus),
    default: RefundStatus.Pending,
  })
  status!: RefundStatus;

  @Prop({ type: String, maxlength: 500 })
  failureReason?: string;

  /** Failed attempts to send the refund to Stripe (retryable errors only). */
  @Prop({ type: Number, default: 0, min: 0 })
  sendAttempts!: number;

  /** Last failed send; the sweep takes the least recently tried first, so one bad row cannot block others. */
  @Prop({ type: Date })
  lastSendAttemptAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);
RefundSchema.index({ userId: 1, createdAt: -1 });
// The send sweep: unsent PENDING refunds, least recently tried first.
RefundSchema.index({ status: 1, lastSendAttemptAt: 1, createdAt: 1 });
RefundSchema.index(
  { stripeRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeRefundId: { $type: 'string' } },
  },
);
// A booking is refunded at most once: partial cancellation is not supported (HTL-21), and a
// cancelled booking cannot be cancelled again (GEN-11). Also serves {bookingType, bookingId} lookups.
RefundSchema.index(
  { bookingType: 1, bookingId: 1 },
  { unique: true, name: 'one_refund_per_booking' },
);
