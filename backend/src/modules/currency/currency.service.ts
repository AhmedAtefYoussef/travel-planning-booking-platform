import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  REFERENCE_SERVICE,
  type Conversion,
  type CurrencyInfo,
  type CurrencyService,
  type ReferenceService,
} from '../../common/contracts';
import {
  AppException,
  ValidationFailedException,
  type FieldError,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  FX_RATES_CLIENT,
  validateFxRates,
  type FxRatesClient,
} from './fx-rates.client';
import { ExchangeRate } from './schemas/exchange-rate.schema';

/** The newest cached rate day, as GET /api/currencies/rates returns it. */
export interface CachedRates {
  base: string;
  rateDate: string;
  fetchedAt: Date;
  rates: Record<string, number>;
}

const RATE_FIELDS = {
  _id: 0,
  base: 1,
  rateDate: 1,
  fetchedAt: 1,
  rates: 1,
} as const;

/** YYYY-MM-DD of `now` in UTC. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function isDuplicateKey(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}

/**
 * CURRENCY_SERVICE (ITN-18, PAY-04; TRVL-133). Rates come from FXRatesAPI once a day with the platform
 * currency as base and are cached in exchange_rates; conversion always uses the newest cached day, so an
 * API outage falls back to the last good rates. With no usable rate the answer is 503
 * EXCHANGE_RATE_UNAVAILABLE, never an amount built from a missing rate. Booking prices are never
 * converted (PAY-04): this is for itinerary budgets and display only.
 */
@Injectable()
export class ExchangeRatesService implements CurrencyService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly model: Model<ExchangeRate>,
    @Inject(FX_RATES_CLIENT) private readonly fx: FxRatesClient,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  private get base(): string {
    return this.config.get('PLATFORM_CURRENCY', { infer: true });
  }

  async supportedCurrencies(): Promise<string[]> {
    return (await this.reference.listCurrencies()).map((c) => c.code);
  }

  /** Newest cached day for the platform currency, or null when none was ever fetched. */
  private latest(): Promise<CachedRates | null> {
    return this.model
      .findOne({ base: this.base }, RATE_FIELDS)
      .sort({ rateDate: -1 })
      .lean<CachedRates>()
      .exec();
  }

  /** GET /api/currencies/rates: the newest cached rates and their day, or 503. */
  async currentRates(): Promise<CachedRates> {
    const cached = await this.latest();
    if (!cached) throw this.unavailable();
    return cached;
  }

  async hasCachedRates(): Promise<boolean> {
    return (await this.model.exists({ base: this.base }).exec()) !== null;
  }

  /** True when nothing is cached or the newest rate day is before today's UTC date. */
  async isStale(now: Date): Promise<boolean> {
    const cached = await this.latest();
    return !cached || cached.rateDate < utcDay(now);
  }

  /**
   * Fetches the latest rates for every seeded currency and upserts them under their rate day. On any
   * failure (API down, bad payload, database) it logs at error level, leaves the cache as it was and
   * returns false; callers keep serving the last cached day (ITN-18).
   */
  async refreshRates(now: Date): Promise<boolean> {
    const base = this.base;
    try {
      const symbols = (await this.supportedCurrencies()).filter(
        (c) => c !== base,
      );
      const { date, rates } = validateFxRates(
        await this.fx.latest(base, symbols),
        symbols,
      );
      const filter = { base, rateDate: date };
      const update = { $set: { rates, fetchedAt: now } };
      try {
        await this.model.updateOne(filter, update, { upsert: true }).exec();
      } catch (e) {
        // Two refreshes raced to insert the same day: the other one won, so update its document.
        if (!isDuplicateKey(e)) throw e;
        await this.model.updateOne(filter, update).exec();
      }
      this.logger.log(
        `Cached ${Object.keys(rates).length} exchange rates for ${base} on ${date}`,
      );
      return true;
    } catch (e) {
      this.logger.error(
        `Exchange-rate refresh failed; keeping the cached rates: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  async convert(
    amountMinor: number,
    from: string,
    to: string,
  ): Promise<Conversion> {
    const currencies = new Map<string, CurrencyInfo>(
      (await this.reference.listCurrencies()).map((c) => [c.code, c]),
    );
    const fromCode = String(from).trim().toUpperCase();
    const toCode = String(to).trim().toUpperCase();
    const fieldErrors: FieldError[] = [];
    if (!Number.isSafeInteger(amountMinor))
      fieldErrors.push({
        field: 'amountMinor',
        message: 'amountMinor must be a whole number of minor units',
      });
    for (const [field, code] of [
      ['from', fromCode],
      ['to', toCode],
    ] as const) {
      if (!currencies.has(code))
        fieldErrors.push({
          field,
          message: `${field} "${code}" is not a supported currency (see GET /api/currencies)`,
        });
    }
    if (fieldErrors.length) throw new ValidationFailedException(fieldErrors);

    const cached = await this.latest();
    if (fromCode === toCode)
      return {
        amountMinor,
        rate: 1,
        rateDate: cached?.rateDate ?? utcDay(new Date()),
      };
    if (!cached) throw this.unavailable();

    const rateFrom = this.rateOf(cached, fromCode);
    const rateTo = this.rateOf(cached, toCode);
    const rate = rateTo / rateFrom;
    const muFrom = currencies.get(fromCode)!.minorUnits;
    const muTo = currencies.get(toCode)!.minorUnits;
    const scaled = (amountMinor / 10 ** muFrom) * rate * 10 ** muTo;
    // Half away from zero, and never -0.
    const converted = Math.sign(scaled) * Math.round(Math.abs(scaled)) || 0;
    if (!Number.isSafeInteger(converted))
      throw new ValidationFailedException([
        {
          field: 'amountMinor',
          message: 'amountMinor is too large to convert exactly',
        },
      ]);
    return { amountMinor: converted, rate, rateDate: cached.rateDate };
  }

  /** Units of `code` per one unit of the base; 503 when the cached day has no usable rate for it. */
  private rateOf(cached: CachedRates, code: string): number {
    if (code === cached.base) return 1;
    const rate = cached.rates[code];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
      throw this.unavailable(
        `No exchange rate for ${code} is available (cached rates of ${cached.rateDate}); try again later`,
      );
    return rate;
  }

  private unavailable(
    message = 'No exchange rates are available yet: they have not been fetched from the exchange-rate API. Try again later.',
  ): AppException {
    return new AppException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.EXCHANGE_RATE_UNAVAILABLE,
      message,
    );
  }
}
