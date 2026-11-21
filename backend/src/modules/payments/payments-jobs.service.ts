import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntervalJob, type JobTask } from '../../common/utils/interval-job';
import { type EnvironmentVariables } from '../../config/env.validation';
import { PaymentsService } from './payments.service';
import { RefundsServiceImpl } from './refunds.service';

/** How often expired holds' PaymentIntents are cancelled (same cadence as the hold expiry job). */
export const PAYMENT_JOBS_INTERVAL_MS = 60_000;

/**
 * PAY-01: cancels the PaymentIntent of every hold that expired. PAY-03: dispatches every PENDING refund
 * Stripe does not have yet (the outbox; any reason) once its back-off has passed. IntervalJob runs both
 * every minute (not in tests, which call the job with a fixed time).
 */
@Injectable()
export class PaymentsJobsService extends IntervalJob {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsServiceImpl,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    super(config, PAYMENT_JOBS_INTERVAL_MS, 'Payment job');
  }

  protected tasks(): JobTask[] {
    return [
      {
        name: 'cancel expired PaymentIntents',
        run: () => this.payments.cancelExpiredIntents(),
      },
      {
        name: 'dispatch pending refunds',
        run: () => this.refunds.dispatchPendingRefunds(),
      },
    ];
  }
}
