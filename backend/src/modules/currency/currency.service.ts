import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ConversionResult,
  CurrencyService as CurrencyServiceContract,
} from '../../common/contracts/currency.contract';
import { currencyExponent, isValidMinor } from '../../common/utils/money';
import { ExchangeRate } from './exchange-rate.schema';

export const SUPPORTED_CURRENCIES = [
  'EGP',
  'AED',
  'GBP',
  'USD',
  'EUR',
  'JPY',
  'SAR',
] as const;
const BASE = 'USD';
/** After a failed fetch, request-path refreshes pause for this long. */
export const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

interface RateSnapshot {
  rateDate: string;
  fetchedDate?: string;
  rates: Record<string, number>;
}

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class CurrencyService implements CurrencyServiceContract {
  private readonly logger = new Logger(CurrencyService.name);
  private inflight: Promise<void> | null = null;
  /** Time of the last failed fetch; gates request-path refreshes only. */
  private lastFailedAt = 0;

  constructor(
    @InjectModel(ExchangeRate.name) private readonly model: Model<ExchangeRate>,
    private readonly config: ConfigService,
  ) {}

  supportedCurrencies(): Promise<string[]> {
    return Promise.resolve([...SUPPORTED_CURRENCIES]);
  }

  /**
   * Converts minor units between supported currencies.
   * @throws BadRequestException (400) for an unsupported code or invalid amount
   * @throws ServiceUnavailableException (503) when no rates were ever fetched
   */
  async convert(
    amountMinor: number,
    from: string,
    to: string,
  ): Promise<ConversionResult> {
    const src = this.normalise(from);
    const dst = this.normalise(to);
    if (!isValidMinor(amountMinor)) {
      throw new BadRequestException(
        'amountMinor must be a non-negative integer',
      );
    }
    const snap = await this.getSnapshot();
    const rate = snap.rates[dst] / snap.rates[src];
    const major = amountMinor / 10 ** currencyExponent(src);
    return {
      amountMinor: Math.round(major * rate * 10 ** currencyExponent(dst)),
      rate,
      rateDate: snap.rateDate,
    };
  }

  async getRatesView(): Promise<{
    base: string;
    rateDate: string;
    rates: Record<string, number>;
  }> {
    const snap = await this.getSnapshot();
    const rates: Record<string, number> = {};
    for (const c of SUPPORTED_CURRENCIES) rates[c] = snap.rates[c];
    return { base: BASE, rateDate: snap.rateDate, rates };
  }

  /** Daily refresh; failures keep the last cached snapshot. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async refreshDaily(): Promise<void> {
    await this.refresh();
  }

  private normalise(code: string): string {
    const c = String(code ?? '').toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(c)) {
      throw new BadRequestException(`Unsupported currency code: ${code}`);
    }
    return c;
  }

  private async getSnapshot(): Promise<RateSnapshot> {
    let latest = await this.latest();
    const stale =
      !latest || (latest.fetchedDate ?? latest.rateDate) !== today();
    if (stale && Date.now() - this.lastFailedAt >= REFRESH_COOLDOWN_MS) {
      await this.refresh();
      latest = await this.latest();
    }
    if (!latest) {
      throw new ServiceUnavailableException(
        'Exchange rates are currently unavailable',
      );
    }
    return latest;
  }

  private latest(): Promise<RateSnapshot | null> {
    return this.model
      .findOne({ base: BASE })
      .sort({ rateDate: -1 })
      .lean()
      .exec();
  }

  private refresh(): Promise<void> {
    this.inflight ??= this.fetchAndStore()
      .catch((err: unknown) => {
        this.lastFailedAt = Date.now();
        this.logger.warn(
          `FX fetch failed, keeping cached rates: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async fetchAndStore(): Promise<void> {
    const baseUrl = this.config.get<string>('FX_API_BASE_URL') ?? '';
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/latest`);
    url.searchParams.set('base', BASE);
    const key = this.config.get<string>('FX_API_KEY');
    if (key) url.searchParams.set('api_key', key);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`FX API responded ${res.status}`);
    const body = (await res.json()) as {
      date?: string;
      rates?: Record<string, number>;
    };
    const rates: Record<string, number> = { [BASE]: 1 };
    for (const c of SUPPORTED_CURRENCIES) {
      const v = body.rates?.[c];
      if (c === BASE) continue;
      if (typeof v !== 'number' || !(v > 0)) {
        throw new Error(`FX API response is missing a rate for ${c}`);
      }
      rates[c] = v;
    }
    const rateDate = body.date?.slice(0, 10) || today();
    await this.model
      .updateOne(
        { base: BASE, rateDate },
        { $set: { base: BASE, rateDate, fetchedDate: today(), rates } },
        { upsert: true },
      )
      .exec();
  }
}
