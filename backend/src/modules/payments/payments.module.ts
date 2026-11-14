import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpStripeGateway } from './http-stripe-gateway';
import { PaymentsJobsService } from './payments-jobs.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeEvent, StripeEventSchema } from './schemas/stripe-event.schema';
import { STRIPE_GATEWAY } from './stripe-gateway';

/**
 * Payments, refunds and Stripe webhook bookkeeping (PAY-01..PAY-04, ADR-0003). Bookings are reached only
 * through the FLIGHT_PAYABLE_BOOKING and HOTEL_PAYABLE_BOOKING contracts (provided by the global
 * bookings module); Stripe only through STRIPE_GATEWAY, which e2e tests replace with a fake.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: StripeEvent.name, schema: StripeEventSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsJobsService,
    HttpStripeGateway,
    { provide: STRIPE_GATEWAY, useExisting: HttpStripeGateway },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
