import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../config/env.validation';
import { PaymentsService } from './payments.service';
import { RefundsServiceImpl } from './refunds.service';

/** How often expired holds' PaymentIntents are cancelled (same cadence as the hold expiry job). */
export const PAYMENT_JOBS_INTERVAL_MS = 60_000;

/**
 * PAY-01: cancels the PaymentIntent of every hold that expired. PAY-03: dispatches every PENDING refund
 * Stripe does not have yet (the outbox; any reason) once its back-off has passed. Same pattern as the booking lifecycle
 * jobs: an unref'd timer, not started in tests (which call the job with a fixed time).
 */
@Injectable()
export class PaymentsJobsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PaymentsJobsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsServiceImpl,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    const job = (name: string, work: () => Promise<unknown>) =>
      work().catch((e: unknown) =>
        this.logger.error(
          `Payment job "${name}" failed: ${e instanceof Error ? e.message : String(e)}`,
          e instanceof Error ? e.stack : undefined,
        ),
      );
    const run = () =>
      Promise.all([
        job('cancel expired PaymentIntents', () =>
          this.payments.cancelExpiredIntents(),
        ),
        job('dispatch pending refunds', () =>
          this.refunds.dispatchPendingRefunds(),
        ),
      ]);
    void run();
    this.timer = setInterval(() => void run(), PAYMENT_JOBS_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
