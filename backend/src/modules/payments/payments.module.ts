import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { REFUNDS_SERVICE } from '../../common/contracts';
import { HttpStripeGateway } from './http-stripe-gateway';
import { PaymentsJobsService } from './payments-jobs.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsController } from './refunds.controller';
import { RefundsServiceImpl } from './refunds.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeEvent, StripeEventSchema } from './schemas/stripe-event.schema';
import { STRIPE_GATEWAY } from './stripe-gateway';

/**
 * Payments, refunds and Stripe webhook bookkeeping (PAY-01..PAY-04, ADR-0003). Bookings are reached only
 * through the FLIGHT_PAYABLE_BOOKING and HOTEL_PAYABLE_BOOKING contracts (provided by the global
 * bookings module); Stripe only through STRIPE_GATEWAY, which e2e tests replace with a fake.
 *
 * Global so bookings can inject REFUNDS_SERVICE (PAY-03 refund block; FLT-26, HTL-21, FLT-06) without
 * importing this module, which would be a module cycle. There is no provider cycle: RefundsServiceImpl
 * needs no booking contract, so bookings -> RefundsServiceImpl and
 * PaymentsService -> {bookings, RefundsServiceImpl} resolve in one direction.
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
  controllers: [PaymentsController, RefundsController],
  providers: [
    PaymentsService,
    RefundsServiceImpl,
    { provide: REFUNDS_SERVICE, useExisting: RefundsServiceImpl },
    PaymentsJobsService,
    HttpStripeGateway,
    { provide: STRIPE_GATEWAY, useExisting: HttpStripeGateway },
  ],
  exports: [PaymentsService, RefundsServiceImpl, REFUNDS_SERVICE],
})
export class PaymentsModule {}
