import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  REFERENCE_SERVICE,
  type Conversion,
  type CurrencyService,
  type ReferenceService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { InvalidInputError } from '../../common/errors/invalid-input.error';
import { convertMinor, isMinorUnits } from '../../common/utils/money';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../config/env.validation';
import { FxRatesClient } from './fx-rates.client';
import { ExchangeRate } from './schemas/exchange-rate.schema';

/** How often the job checks whether today's rates still have to be fetched. */
export const RATES_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The cached rates as other code reads them. */
export interface CachedRates {
  base: string;
  rateDate: string;
  fetchedAt: Date;
  rates: Record<string, number>;
}

export type RefreshOutcome = 'fetched' | 'fresh' | 'failed';

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (instant: Date): string => instant.toISOString().slice(0, 10);

/**
 * Exchange rates and conversion (TRVL-133, ITN-18), exposed to other modules as CURRENCY_SERVICE.
 *
 * Rates are fetched from FXRatesAPI once per UTC day with PLATFORM_CURRENCY as the base and cached in
 * `exchange_rates`. The job runs at startup (so a fresh database has rates at once) and then checks
 * every hour whether today's fetch is still missing, which also retries a failed fetch. When the API
 * is down the newest cached document keeps serving conversions. A conversion is never built from a
 * missing rate: that is a 503 EXCHANGE_RATE_UNAVAILABLE (brief section 6.5).
 *
 * Booking prices are not converted (PAY-04); this is for itinerary budgets only.
 * Like the flight status job, the timer is unref'd and not started in tests.
 */
@Injectable()
export class CurrencyRatesService
  implements CurrencyService, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CurrencyRatesService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<RefreshOutcome>;

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly exchangeRates: Model<ExchangeRate>,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    private readonly client: FxRatesClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** PLATFORM_CURRENCY: the base of every cached rate (PAY-04). */
  get baseCurrency(): string {
    return this.config.get('PLATFORM_CURRENCY', { infer: true }).toUpperCase();
  }

  /**
   * The supported currency list: the seeded currencies of the reference dataset (GEN-12) plus the
   * platform currency, sorted. Budgets may only use these (ITN-18).
   */
  async supportedCurrencies(): Promise<string[]> {
    const countries = await this.reference.listCountries();
    const codes = new Set(countries.map((c) => c.currency.toUpperCase()));
    codes.add(this.baseCurrency);
    return [...codes].sort();
  }

  /** The newest cached rates for the platform currency, or null when nothing was ever fetched. */
  async latestRates(): Promise<CachedRates | null> {
    const doc = await this.exchangeRates
      .findOne({ base: this.baseCurrency })
      .sort({ rateDate: -1 })
      .lean<{
        base: string;
        rateDate: string;
        fetchedAt: Date;
        rates: Record<string, number>;
      }>()
      .exec();
    if (!doc) return null;
    return {
      base: doc.base,
      rateDate: doc.rateDate,
      fetchedAt: doc.fetchedAt,
      rates: { ...doc.rates, [doc.base]: 1 },
    };
  }

  /** Same as latestRates, but a missing cache is the 503 the API contract promises. */
  async requireLatestRates(): Promise<CachedRates> {
    const latest = await this.latestRates();
    if (!latest) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.EXCHANGE_RATE_UNAVAILABLE,
        'Exchange rates are not available yet. Please try again later.',
      );
    }
    return latest;
  }

  /**
   * CURRENCY_SERVICE.convert. `rate` means 1 unit of `from` = rate units of `to`. The amount is
   * rounded half away from zero to the target currency's minor unit (convertMinor).
   */
  async convert(
    amountMinor: number,
    from: string,
    to: string,
  ): Promise<Conversion> {
    // Input is checked before anything else, so a bad amount is a 400 even while rates are missing.
    if (!isMinorUnits(amountMinor)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'amountMinor must be an integer number of minor units',
      );
    }
    const source = from.trim().toUpperCase();
    const target = to.trim().toUpperCase();
    const supported = await this.supportedCurrencies();
    for (const code of [source, target]) {
      if (!supported.includes(code)) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.BAD_REQUEST,
          `Unsupported currency "${code}". Supported currencies: ${supported.join(', ')}`,
        );
      }
    }
    if (source === target) {
      const latest = await this.latestRates();
      return {
        amountMinor,
        rate: 1,
        rateDate: latest?.rateDate ?? utcDay(new Date()),
      };
    }
    const latest = await this.requireLatestRates();
    const fromRate = latest.rates[source];
    const toRate = latest.rates[target];
    for (const [code, rate] of [
      [source, fromRate],
      [target, toRate],
    ] as const) {
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        throw new AppException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ErrorCode.EXCHANGE_RATE_UNAVAILABLE,
          `No exchange rate is available for ${code} (rates of ${latest.rateDate}). Please try again later.`,
        );
      }
    }
    // Both rates are quoted against the platform currency, so the cross rate is their ratio.
    const rate = toRate / fromRate;
    return {
      amountMinor: this.convertOrReject(amountMinor, source, target, rate),
      rate,
      rateDate: latest.rateDate,
    };
  }

  /** convertMinor, with a clear 400 when the result is too large to be an exact integer. */
  private convertOrReject(
    amountMinor: number,
    from: string,
    to: string,
    rate: number,
  ): number {
    try {
      return convertMinor(amountMinor, from, to, rate);
    } catch (e) {
      if (!(e instanceof InvalidInputError)) throw e;
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `amountMinor is too large to convert from ${from} to ${to}`,
      );
    }
  }

  /**
   * Fetches today's rates unless they were already fetched today (UTC) and cover every supported
   * currency. A failed fetch is logged and reported as 'failed'; the cache is left untouched so the
   * last good rates keep being used. Never throws: it runs unattended from a timer.
   */
  async refresh(now: Date = new Date()): Promise<RefreshOutcome> {
    const base = this.baseCurrency;
    let latest: CachedRates | null = null;
    try {
      latest = await this.latestRates();
      const currencies = (await this.supportedCurrencies()).filter(
        (code) => code !== base,
      );
      // Nothing to ask for before the reference data is seeded (startup already warned about that).
      if (currencies.length === 0) return 'failed';
      const cached = latest;
      const fetchedToday = await this.fetchedOn(base, utcDay(now));
      const complete =
        cached !== null &&
        currencies.every((code) => typeof cached.rates[code] === 'number');
      if (fetchedToday && complete) return 'fresh';

      const snapshot = await this.client.fetchLatest(base, currencies);
      // A rate day in the future would stay "newest" for ever; the API reports today or earlier.
      if (snapshot.rateDate > utcDay(new Date(now.getTime() + DAY_MS))) {
        throw new Error(
          `FXRatesAPI returned a rate date in the future (${snapshot.rateDate})`,
        );
      }
      try {
        await this.exchangeRates
          .updateOne(
            { base, rateDate: snapshot.rateDate },
            { $set: { rates: snapshot.rates, fetchedAt: now } },
            { upsert: true, runValidators: true },
          )
          .exec();
      } catch (e) {
        // Another API instance stored the same rate day a moment earlier: its document is the cache.
        if ((e as { code?: number }).code === 11000) return 'fresh';
        throw e;
      }
      this.logger.log(
        `Exchange rates of ${snapshot.rateDate} cached (base ${base}, ${Object.keys(snapshot.rates).length} currencies)`,
      );
      return 'fetched';
    } catch (e) {
      this.logger.warn(
        `Exchange rate fetch failed, ${latest ? `using cached rates of ${latest.rateDate}` : 'and no rates are cached yet'}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 'failed';
    }
  }

  /** True when any rate document of `base` was stored on the given UTC day. */
  private async fetchedOn(base: string, day: string): Promise<boolean> {
    const start = new Date(`${day}T00:00:00.000Z`);
    const found = await this.exchangeRates
      .exists({
        base,
        fetchedAt: { $gte: start, $lt: new Date(start.getTime() + DAY_MS) },
      })
      .exec();
    return found !== null;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.assertPlatformCurrencyIsSeeded();
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    const run = () => {
      this.running = this.refresh();
    };
    run();
    this.timer = setInterval(run, RATES_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  /** Lets a fetch that is in flight finish, so a short-lived process (the seed script) closes cleanly. */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /**
   * PAY-04: the platform currency must be one of the seeded currencies, otherwise prices would be in
   * a currency the platform does not list. Checked once the reference data exists; an empty database
   * (before the first `npm run seed`) only warns so the seed itself can run.
   */
  private async assertPlatformCurrencyIsSeeded(): Promise<void> {
    const countries = await this.reference.listCountries();
    if (countries.length === 0) {
      this.logger.warn(
        'Reference data is not seeded yet; PLATFORM_CURRENCY cannot be checked against it (GEN-12)',
      );
      return;
    }
    const seeded = new Set(countries.map((c) => c.currency.toUpperCase()));
    if (!seeded.has(this.baseCurrency)) {
      throw new Error(
        `PLATFORM_CURRENCY=${this.baseCurrency} is not one of the seeded currencies (${[...seeded].sort().join(', ')}) (PAY-04)`,
      );
    }
  }
}
