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
import { ExchangeRatesService } from './currency.service';
import { redactFxKey } from './fx-rates.client';

/** How often the daily-rates check runs; it only calls the API when today's rates are missing. */
export const CURRENCY_JOB_INTERVAL_MS = 60 * 60 * 1000;

/**
 * ITN-18 daily exchange rates (TRVL-133). At startup it fetches only when nothing is cached, so a fresh
 * database has rates without waiting a day; then an hourly tick fetches when the newest fetch (`fetchedAt`)
 * was on an earlier UTC day than today, whatever date the API reported for the rates (`rateDate`). That
 * gives at most one successful fetch per UTC day and survives restarts. Same pattern as the
 * booking and payment jobs: an unref'd timer, not started in tests (which call the methods with `now`).
 */
@Injectable()
export class CurrencyJobsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CurrencyJobsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly rates: ExchangeRatesService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    // FX_API_KEY is redacted from the message and stack: an error may echo the request URL.
    const redact = (text: string) =>
      redactFxKey(text, this.config.get('FX_API_KEY', { infer: true }));
    const job = (name: string, work: () => Promise<unknown>) =>
      work().catch((e: unknown) =>
        this.logger.error(
          redact(
            `Currency job "${name}" failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
          e instanceof Error && e.stack ? redact(e.stack) : undefined,
        ),
      );
    void job('fetch rates at startup', () => this.bootstrapRefresh(new Date()));
    this.timer = setInterval(
      () => void job('daily rates', () => this.tick(new Date())),
      CURRENCY_JOB_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Fetches once when no rates are cached at all; true when it fetched and cached rates. */
  async bootstrapRefresh(now: Date): Promise<boolean> {
    if (await this.rates.hasCachedRates()) return false;
    return this.rates.refreshRates(now);
  }

  /**
   * Fetches when the newest fetch (`fetchedAt`) was on an earlier UTC day than `now`, or nothing is
   * cached; true when it fetched and cached rates.
   */
  async tick(now: Date): Promise<boolean> {
    if (!(await this.rates.isStale(now))) return false;
    return this.rates.refreshRates(now);
  }
}
