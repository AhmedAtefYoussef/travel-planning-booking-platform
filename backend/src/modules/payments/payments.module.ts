import { Global, Module } from '@nestjs/common';
import { PAYMENT_HOLD_RELEASE } from '../../common/contracts';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingPoliciesController } from './booking-policies.controller';
import {
  BookingPoliciesService,
  PayableBookings,
} from './booking-policies.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeEvent, StripeEventSchema } from './schemas/stripe-event.schema';
import { STRIPE_GATEWAY, StripeSdkGateway } from './stripe.gateway';

/**
 * Payments, refunds and Stripe webhook bookkeeping (PAY-01..PAY-04).
 * Sprint 0 registered the schemas (TRVL-161). PAY-02 adds the policies step; PAY-01 and PAY-03 add
 * payments and refunds. Bookings are reached only through the PayableBooking contracts.
 * Global so the hold-expiry jobs can inject PAYMENT_HOLD_RELEASE without importing this module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: StripeEvent.name, schema: StripeEventSchema },
    ]),
  ],
  controllers: [BookingPoliciesController, PaymentsController],
  providers: [
    PayableBookings,
    BookingPoliciesService,
    PaymentsService,
    { provide: STRIPE_GATEWAY, useClass: StripeSdkGateway },
    { provide: PAYMENT_HOLD_RELEASE, useExisting: PaymentsService },
  ],
  exports: [PAYMENT_HOLD_RELEASE],
})
export class PaymentsModule {}
