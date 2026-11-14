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

/** How often expired holds' PaymentIntents are cancelled (same cadence as the hold expiry job). */
export const PAYMENT_JOBS_INTERVAL_MS = 60_000;

/**
 * PAY-01: cancels the PaymentIntent of every hold that expired. Same pattern as the booking lifecycle
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
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    const run = () =>
      this.payments
        .cancelExpiredIntents()
        .catch((e: unknown) =>
          this.logger.error(
            `Payment job "cancel expired PaymentIntents" failed: ${e instanceof Error ? e.message : String(e)}`,
            e instanceof Error ? e.stack : undefined,
          ),
        );
    void run();
    this.timer = setInterval(() => void run(), PAYMENT_JOBS_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
