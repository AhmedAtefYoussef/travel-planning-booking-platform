import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type { Country, ReferenceService } from '../../common/contracts';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  CurrencyRatesService,
  RATES_CHECK_INTERVAL_MS,
} from './currency.service';
import { FxRatesApiError, type FxRatesClient } from './fx-rates.client';
import type { ExchangeRate } from './schemas/exchange-rate.schema';

const COUNTRIES: Country[] = [
  { code: 'EG', name: 'Egypt', currency: 'EGP' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'US', name: 'United States', currency: 'USD' },
];

interface Stored {
  base: string;
  rateDate: string;
  fetchedAt: Date;
  rates: Record<string, number>;
}

function setup(
  options: {
    cached?: Stored | null;
    countries?: Country[];
    nodeEnv?: string;
    platformCurrency?: string;
  } = {},
) {
  const cached =
    options.cached === undefined
      ? {
          base: 'USD',
          rateDate: '2026-11-09',
          fetchedAt: new Date('2026-11-09T06:00:00Z'),
          rates: { EUR: 0.8, EGP: 50, JPY: 150 },
        }
      : options.cached;
  const updateOne = jest.fn(() => ({ exec: () => Promise.resolve({}) }));
  const model = {
    findOne: jest.fn(() => ({
      sort: () => ({ lean: () => ({ exec: () => Promise.resolve(cached) }) }),
    })),
    updateOne,
  };
  const reference = {
    listCountries: jest.fn(() =>
      Promise.resolve(options.countries ?? COUNTRIES),
    ),
  };
  const client = { fetchLatest: jest.fn() };
  const values: Record<string, string> = {
    PLATFORM_CURRENCY: options.platformCurrency ?? 'USD',
    NODE_ENV: options.nodeEnv ?? 'test',
  };
  const service = new CurrencyRatesService(
    model as unknown as Model<ExchangeRate>,
    reference as unknown as ReferenceService,
    client as unknown as FxRatesClient,
    {
      get: (name: string) => values[name],
    } as unknown as ConfigService<EnvironmentVariables, true>,
  );
  return { service, model, updateOne, client, reference };
}

describe('CurrencyRatesService (TRVL-133, ITN-18)', () => {
  afterEach(() => jest.useRealTimers());

  describe('supportedCurrencies', () => {
    it('is the distinct seeded currencies plus the platform currency, sorted', async () => {
      const { service } = setup();
      await expect(service.supportedCurrencies()).resolves.toEqual([
        'EGP',
        'EUR',
        'JPY',
        'USD',
      ]);
    });

    it('still contains the platform currency before the reference data is seeded', async () => {
      const { service } = setup({ countries: [] });
      await expect(service.supportedCurrencies()).resolves.toEqual(['USD']);
    });
  });

  describe('convert', () => {
    it('converts from the platform currency with the cached rate and reports the rate date', async () => {
      const { service } = setup();
      await expect(service.convert(12_500, 'USD', 'EGP')).resolves.toEqual({
        amountMinor: 625_000,
        rate: 50,
        rateDate: '2026-11-09',
      });
    });

    it('converts to the platform currency with the inverse rate', async () => {
      const { service } = setup();
      const result = await service.convert(625_000, 'EGP', 'USD');
      expect(result.amountMinor).toBe(12_500);
      expect(result.rate).toBeCloseTo(0.02, 10);
    });

    it('converts between two other currencies through the platform currency', async () => {
      const { service } = setup();
      // 100.00 EUR = 125.00 USD = 6250.00 EGP
      const result = await service.convert(10_000, 'EUR', 'EGP');
      expect(result.amountMinor).toBe(625_000);
      expect(result.rate).toBeCloseTo(62.5, 10);
    });

    it('respects minor units: yen has none', async () => {
      const { service } = setup();
      // 10.00 USD = 1500 JPY (not 150000)
      await expect(service.convert(1_000, 'USD', 'JPY')).resolves.toMatchObject(
        { amountMinor: 1_500 },
      );
      // 1500 JPY = 10.00 USD
      await expect(service.convert(1_500, 'JPY', 'USD')).resolves.toMatchObject(
        { amountMinor: 1_000 },
      );
    });

    it('rounds half away from zero to the target minor unit', async () => {
      const { service } = setup({
        cached: {
          base: 'USD',
          rateDate: '2026-11-09',
          fetchedAt: new Date('2026-11-09T06:00:00Z'),
          rates: { EUR: 0.925 },
        },
      });
      // 0.01 USD * 0.925 = 0.00925 EUR -> 0.01 EUR; 0.03 USD -> 0.02775 EUR -> 0.03 EUR
      await expect(service.convert(1, 'USD', 'EUR')).resolves.toMatchObject({
        amountMinor: 1,
      });
      await expect(service.convert(3, 'USD', 'EUR')).resolves.toMatchObject({
        amountMinor: 3,
      });
      await expect(service.convert(0, 'USD', 'EUR')).resolves.toMatchObject({
        amountMinor: 0,
      });
    });

    it('accepts lower-case codes and surrounding spaces', async () => {
      const { service } = setup();
      await expect(service.convert(100, ' usd ', 'egp')).resolves.toMatchObject(
        { amountMinor: 5_000 },
      );
    });

    it('returns the same amount with rate 1 for the same currency, even with no cached rates', async () => {
      const { service } = setup({ cached: null });
      const result = await service.convert(4_200, 'EUR', 'EUR');
      expect(result.amountMinor).toBe(4_200);
      expect(result.rate).toBe(1);
      expect(result.rateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects a currency outside the supported list with 400', async () => {
      const { service } = setup();
      await expect(service.convert(100, 'USD', 'GBP')).rejects.toMatchObject({
        status: 400,
        code: 'BAD_REQUEST',
        message:
          'Unsupported currency "GBP". Supported currencies: EGP, EUR, JPY, USD',
      });
      await expect(service.convert(100, 'ZZZ', 'USD')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('answers 503 EXCHANGE_RATE_UNAVAILABLE when nothing is cached', async () => {
      const { service } = setup({ cached: null });
      await expect(service.convert(100, 'USD', 'EGP')).rejects.toMatchObject({
        status: 503,
        code: 'EXCHANGE_RATE_UNAVAILABLE',
      });
    });

    it('answers 503 when the cache has no rate for one of the currencies, never a guessed total', async () => {
      const { service } = setup({
        cached: {
          base: 'USD',
          rateDate: '2026-11-09',
          fetchedAt: new Date('2026-11-09T06:00:00Z'),
          rates: { EUR: 0.8 },
        },
      });
      await expect(service.convert(100, 'USD', 'EGP')).rejects.toMatchObject({
        status: 503,
        code: 'EXCHANGE_RATE_UNAVAILABLE',
        message:
          'No exchange rate is available for EGP (rates of 2026-11-09). Please try again later.',
      });
      await expect(service.convert(100, 'EGP', 'EUR')).rejects.toMatchObject({
        status: 503,
      });
    });

    it('rejects an amount that is not a whole number of minor units', async () => {
      const { service } = setup();
      await expect(service.convert(10.5, 'USD', 'EGP')).rejects.toThrow(
        'amountMinor must be an integer number of minor units',
      );
    });

    it('rejects an amount whose converted value is too large to be exact', async () => {
      const { service } = setup();
      await expect(
        service.convert(Number.MAX_SAFE_INTEGER, 'USD', 'EGP'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'amountMinor is too large to convert from USD to EGP',
      });
    });
  });

  describe('refresh', () => {
    const NOW = new Date('2026-11-10T08:00:00Z');

    it('fetches the supported currencies against the platform currency and upserts by rate day', async () => {
      const { service, client, updateOne } = setup();
      client.fetchLatest.mockResolvedValue({
        base: 'USD',
        rateDate: '2026-11-10',
        rates: { EUR: 0.81, EGP: 50.2, JPY: 151 },
      });
      await expect(service.refresh(NOW)).resolves.toBe('fetched');
      expect(client.fetchLatest).toHaveBeenCalledWith('USD', [
        'EGP',
        'EUR',
        'JPY',
      ]);
      expect(updateOne).toHaveBeenCalledWith(
        { base: 'USD', rateDate: '2026-11-10' },
        {
          $set: { rates: { EUR: 0.81, EGP: 50.2, JPY: 151 }, fetchedAt: NOW },
        },
        { upsert: true, runValidators: true },
      );
    });

    it('does not call the API again on the day it already fetched', async () => {
      const { service, client } = setup({
        cached: {
          base: 'USD',
          rateDate: '2026-11-09',
          fetchedAt: new Date('2026-11-10T00:00:05Z'),
          rates: { EUR: 0.8 },
        },
      });
      await expect(service.refresh(NOW)).resolves.toBe('fresh');
      expect(client.fetchLatest).not.toHaveBeenCalled();
    });

    it('fetches when nothing is cached yet', async () => {
      const { service, client } = setup({ cached: null });
      client.fetchLatest.mockResolvedValue({
        base: 'USD',
        rateDate: '2026-11-10',
        rates: { EUR: 0.81 },
      });
      await expect(service.refresh(NOW)).resolves.toBe('fetched');
    });

    it('keeps the cache untouched when the API fails', async () => {
      const { service, client, updateOne } = setup();
      client.fetchLatest.mockRejectedValue(new FxRatesApiError('HTTP 500'));
      await expect(service.refresh(NOW)).resolves.toBe('failed');
      expect(updateOne).not.toHaveBeenCalled();
      await expect(service.convert(100, 'USD', 'EGP')).resolves.toMatchObject({
        amountMinor: 5_000,
        rateDate: '2026-11-09',
      });
    });

    it('does not call the API when only the platform currency is known', async () => {
      const { service, client } = setup({ countries: [], cached: null });
      await expect(service.refresh(NOW)).resolves.toBe('failed');
      expect(client.fetchLatest).not.toHaveBeenCalled();
    });
  });

  describe('startup', () => {
    it('refuses to start when the platform currency is not a seeded currency (PAY-04)', async () => {
      const { service } = setup({ platformCurrency: 'CHF' });
      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        'PLATFORM_CURRENCY=CHF is not one of the seeded currencies (EGP, EUR, JPY, USD) (PAY-04)',
      );
    });

    it('starts before the reference data is seeded, so the seed can run', async () => {
      const { service } = setup({ countries: [], platformCurrency: 'CHF' });
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('does not fetch or start a timer in tests', async () => {
      jest.useFakeTimers();
      const { service, client } = setup({ nodeEnv: 'test', cached: null });
      await service.onApplicationBootstrap();
      jest.advanceTimersByTime(RATES_CHECK_INTERVAL_MS * 2);
      expect(client.fetchLatest).not.toHaveBeenCalled();
    });

    it('fetches at startup and checks again every hour outside tests, until shutdown', async () => {
      jest.useFakeTimers();
      const { service, client } = setup({
        nodeEnv: 'development',
        cached: null,
      });
      client.fetchLatest.mockResolvedValue({
        base: 'USD',
        rateDate: '2026-11-10',
        rates: { EUR: 0.81 },
      });
      await service.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);
      expect(client.fetchLatest).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(RATES_CHECK_INTERVAL_MS);
      expect(client.fetchLatest).toHaveBeenCalledTimes(2);
      service.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(RATES_CHECK_INTERVAL_MS * 3);
      expect(client.fetchLatest).toHaveBeenCalledTimes(2);
    });
  });
});
