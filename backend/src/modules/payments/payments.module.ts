import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeEvent, StripeEventSchema } from './schemas/stripe-event.schema';

/**
 * Payments, refunds and Stripe webhook bookkeeping (PAY-01..PAY-04).
 * Sprint 0 registers the schemas (TRVL-161); controllers and services land with PAY-01 and PAY-03.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: StripeEvent.name, schema: StripeEventSchema },
    ]),
  ],
})
export class PaymentsModule {}
