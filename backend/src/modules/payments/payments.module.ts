import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingPoliciesController } from './booking-policies.controller';
import {
  BookingPoliciesService,
  PayableBookings,
} from './booking-policies.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeEvent, StripeEventSchema } from './schemas/stripe-event.schema';

/**
 * Payments, refunds and Stripe webhook bookkeeping (PAY-01..PAY-04).
 * Sprint 0 registered the schemas (TRVL-161). PAY-02 adds the policies step; PAY-01 and PAY-03 add
 * payments and refunds. Bookings are reached only through the PayableBooking contracts.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: StripeEvent.name, schema: StripeEventSchema },
    ]),
  ],
  controllers: [BookingPoliciesController],
  providers: [PayableBookings, BookingPoliciesService],
})
export class PaymentsModule {}
