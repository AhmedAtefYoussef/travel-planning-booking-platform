import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { BookingType } from '../../common/contracts/booking.contract';
import { PaymentStatus } from '../../common/contracts/payments.contract';
import {
  type RefundReason,
  RefundStatus,
} from '../../common/contracts/refunds.contract';

/** Only the PAY-01 fields are stored; never card data. */
@Schema({ collection: 'payments', timestamps: true })
export class Payment {
  @Prop({ type: String, required: true, enum: BookingType })
  bookingType: BookingType;
  @Prop({ required: true, index: true }) bookingId: string;
  @Prop({ required: true }) userId: string;
  @Prop({ required: true, index: true }) stripeId: string;
  /** Earlier PaymentIntent ids superseded by retries. */
  @Prop({ type: [String], default: [], index: true })
  stripeIdHistory: string[];
  @Prop({ required: true }) amountMinor: number;
  /** Always PLATFORM_CURRENCY, set by the service (no schema default). */
  @Prop({ required: true }) currency: string;
  @Prop({
    type: String,
    required: true,
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;
}
export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);

@Schema({ collection: 'refunds', timestamps: true })
export class Refund {
  @Prop({ type: String, required: true, enum: BookingType })
  bookingType: BookingType;
  @Prop({ required: true, index: true }) bookingId: string;
  @Prop({ required: true }) userId: string;
  @Prop({ required: true }) paymentId: string;
  /** The PaymentIntent refunded; refunds are deduped per PI. */
  @Prop({ type: String, required: true, index: true })
  paymentIntentId: string;
  @Prop({ type: String, default: null })
  stripeRefundId: string | null;
  @Prop({ required: true }) amountMinor: number;
  /** Always PLATFORM_CURRENCY, set by the service (no schema default). */
  @Prop({ required: true }) currency: string;
  @Prop({ type: String, required: true, enum: ['USER', 'PROVIDER'] })
  reason: RefundReason;
  @Prop({
    type: String,
    required: true,
    enum: RefundStatus,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;
}
export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);
/** One local record per Stripe refund, even under concurrent webhooks. */
RefundSchema.index(
  { stripeRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeRefundId: { $type: 'string' } },
  },
);
