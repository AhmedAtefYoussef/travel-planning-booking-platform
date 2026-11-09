import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PAYMENTS_SERVICE,
  REFUNDS_SERVICE,
} from '../../common/contracts/tokens';
import { BookingPoliciesService } from './booking-policies.service';
import {
  BookingPoliciesController,
  PaymentsController,
  RefundsController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { Payment, PaymentSchema, Refund, RefundSchema } from './schemas';
import { stripeProvider } from './stripe.provider';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
  ],
  controllers: [
    BookingPoliciesController,
    PaymentsController,
    RefundsController,
  ],
  providers: [
    stripeProvider,
    PaymentsService,
    RefundsService,
    BookingPoliciesService,
    { provide: PAYMENTS_SERVICE, useExisting: PaymentsService },
    { provide: REFUNDS_SERVICE, useExisting: RefundsService },
  ],
  exports: [PAYMENTS_SERVICE, REFUNDS_SERVICE],
})
export class PaymentsModule {}
