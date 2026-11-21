import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntervalJob, type JobTask } from '../../common/utils/interval-job';
import { type EnvironmentVariables } from '../../config/env.validation';
import { ExchangeRatesService } from './currency.service';
import { redactFxKey } from './fx-rates.client';

/** How often the daily-rates check runs; it only calls the API when today's rates are missing. */
export const CURRENCY_JOB_INTERVAL_MS = 60 * 60 * 1000;

/**
 * ITN-18 daily exchange rates (TRVL-133). At startup it fetches only when nothing is cached, so a fresh
 * database has rates without waiting a day; then an hourly tick fetches when the newest fetch (`fetchedAt`)
 * was on an earlier UTC day than today, whatever date the API reported for the rates (`rateDate`). That
 * gives at most one successful fetch per UTC day and survives restarts. IntervalJob runs it (not in
 * tests, which call the methods with `now`).
 */
@Injectable()
export class CurrencyJobsService extends IntervalJob {
  constructor(
    private readonly rates: ExchangeRatesService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    super(config, CURRENCY_JOB_INTERVAL_MS, 'Currency job');
  }

  /** At startup: fetch only when nothing is cached. */
  protected startupTasks(): JobTask[] {
    return [
      {
        name: 'fetch rates at startup',
        run: () => this.bootstrapRefresh(new Date()),
      },
    ];
  }

  protected tasks(): JobTask[] {
    return [{ name: 'daily rates', run: () => this.tick(new Date()) }];
  }

  /** FX_API_KEY is redacted from a failure's message and stack: an error may echo the request URL. */
  protected redact(text: string): string {
    return redactFxKey(text, this.config.get('FX_API_KEY', { infer: true }));
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
