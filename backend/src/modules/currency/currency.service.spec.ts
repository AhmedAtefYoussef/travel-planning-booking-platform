import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';
import type { CurrencyInfo, ReferenceService } from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ExchangeRatesService } from './currency.service';
import type { ExchangeRate } from './schemas/exchange-rate.schema';

const CURRENCIES: CurrencyInfo[] = [
  { code: 'EGP', name: 'Egyptian Pound', minorUnits: 2 },
  { code: 'JPY', name: 'Japanese Yen', minorUnits: 0 },
  { code: 'KWD', name: 'Kuwaiti Dinar', minorUnits: 3 },
  { code: 'USD', name: 'US Dollar', minorUnits: 2 },
];

const CACHED = {
  base: 'USD',
  rateDate: '2026-11-14',
  rates: { EGP: 50, JPY: 150, KWD: 0.3 },
  fetchedAt: new Date('2026-11-14T09:00:00Z'),
};

function query<T>(value: T) {
  const q = {
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  q.sort.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  return q;
}

function setup(cached: unknown = CACHED) {
  const model = {
    findOne: jest.fn(() => query(cached)),
    exists: jest.fn(() => query(cached ? { _id: 'x' } : null)),
    updateOne: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue({ acknowledged: true }),
    })),
  };
  const fx = { latest: jest.fn() };
  const reference = {
    listCurrencies: jest.fn().mockResolvedValue(CURRENCIES),
  };
  const config = { get: jest.fn().mockReturnValue('USD') };
  const service = new ExchangeRatesService(
    model as unknown as Model<ExchangeRate>,
    fx,
    reference as unknown as ReferenceService,
    config as never,
  );
  return { model, fx, reference, service };
}

async function caught(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('ExchangeRatesService.convert: ITN-18 / PAY-04 (TRVL-133)', () => {
  it('converts with each currency’s minor units (EGP 2, JPY 0, KWD 3)', async () => {
    const { service } = setup();
    await expect(service.convert(1000, 'EGP', 'JPY')).resolves.toEqual({
      amountMinor: 30,
      rate: 3,
      rateDate: '2026-11-14',
    });
    await expect(service.convert(1000, 'jpy', 'egp')).resolves.toMatchObject({
      amountMinor: 33333,
    });
    // 100.00 USD -> 30.000 KWD
    await expect(service.convert(10000, 'USD', 'KWD')).resolves.toMatchObject({
      amountMinor: 30000,
      rate: 0.3,
    });
  });

  it('same currency returns the amount with rate 1, even before any rate is cached', async () => {
    await expect(setup().service.convert(1234, 'JPY', 'JPY')).resolves.toEqual({
      amountMinor: 1234,
      rate: 1,
      rateDate: '2026-11-14',
    });
    const empty = await setup(null).service.convert(5, 'EGP', 'EGP');
    expect(empty).toMatchObject({ amountMinor: 5, rate: 1 });
    expect(empty.rateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reports every unsupported or malformed input as 400 fieldErrors', async () => {
    const { service } = setup();
    const both = await caught(service.convert(1000, 'XYZ', 'ABC'));
    expect(both.getStatus()).toBe(400);
    expect(both.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(both.fieldErrors?.map((f) => f.field)).toEqual(['from', 'to']);

    const amount = await caught(service.convert(1.5, 'EGP', 'JPY'));
    expect(amount.fieldErrors?.map((f) => f.field)).toEqual(['amountMinor']);
  });

  it('503 EXCHANGE_RATE_UNAVAILABLE when nothing is cached', async () => {
    const error = await caught(setup(null).service.convert(1000, 'EGP', 'JPY'));
    expect(error.getStatus()).toBe(503);
    expect(error.code).toBe(ErrorCode.EXCHANGE_RATE_UNAVAILABLE);
  });

  it('503 when the cache lacks one of the two currencies (never NaN or 0)', async () => {
    const { service } = setup({ ...CACHED, rates: { EGP: 50 } });
    const error = await caught(service.convert(1000, 'EGP', 'JPY'));
    expect(error.getStatus()).toBe(503);
    expect(error.message).toContain('JPY');
    const corrupt = setup({ ...CACHED, rates: { EGP: 50, JPY: 0 } });
    await expect(
      corrupt.service.convert(1000, 'EGP', 'JPY'),
    ).rejects.toMatchObject({ code: ErrorCode.EXCHANGE_RATE_UNAVAILABLE });
  });

  it('400 when the converted amount is too large to count exactly', async () => {
    const error = await caught(
      setup().service.convert(Number.MAX_SAFE_INTEGER, 'USD', 'JPY'),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.fieldErrors?.[0].field).toBe('amountMinor');
  });

  it('503, never 0, when the rate data makes the result non-finite (denormal rate)', async () => {
    const { service } = setup({
      ...CACHED,
      rates: { EGP: 5e-324, JPY: 150 },
    });
    const error = await caught(service.convert(1000, 'EGP', 'JPY'));
    expect(error.getStatus()).toBe(503);
    expect(error.code).toBe(ErrorCode.EXCHANGE_RATE_UNAVAILABLE);
  });

  it('0 converts to 0 (never -0) and tiny amounts round half away from zero', async () => {
    const { service } = setup();
    const zero = await service.convert(0, 'EGP', 'JPY');
    expect(Object.is(zero.amountMinor, 0)).toBe(true);
    // 0.01 EGP = 0.03 JPY -> 0 yen; -0.01 EGP -> 0, not -0
    const negative = await service.convert(-1, 'EGP', 'JPY');
    expect(Object.is(negative.amountMinor, 0)).toBe(true);
    await expect(service.convert(-50, 'EGP', 'JPY')).resolves.toMatchObject({
      amountMinor: -2,
    });
  });
});

describe('ExchangeRatesService rates and refresh: ITN-18 (TRVL-133)', () => {
  const now = new Date('2026-11-15T09:00:00Z');
  afterEach(() => jest.restoreAllMocks());

  it('currentRates returns the newest cached day or 503', async () => {
    await expect(setup().service.currentRates()).resolves.toEqual(CACHED);
    await expect(setup(null).service.currentRates()).rejects.toMatchObject({
      code: ErrorCode.EXCHANGE_RATE_UNAVAILABLE,
    });
  });

  it('asks for the supported codes except the base and upserts that day', async () => {
    const { service, fx, model } = setup();
    fx.latest.mockResolvedValue({
      date: '2026-11-15',
      rates: { EGP: 51, JPY: 151, KWD: 0.31 },
    });
    await expect(service.refreshRates(now)).resolves.toBe(true);
    expect(fx.latest).toHaveBeenCalledWith('USD', ['EGP', 'JPY', 'KWD']);
    expect(model.updateOne).toHaveBeenCalledWith(
      { base: 'USD', rateDate: '2026-11-15' },
      {
        $set: { rates: { EGP: 51, JPY: 151, KWD: 0.31 }, fetchedAt: now },
      },
      { upsert: true },
    );
  });

  it('retries once without upsert when a concurrent refresh inserted the day first', async () => {
    const { service, fx, model } = setup();
    fx.latest.mockResolvedValue({ date: '2026-11-15', rates: { EGP: 51 } });
    const duplicate = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
    });
    model.updateOne
      .mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(duplicate) })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({ acknowledged: true }),
      });
    await expect(service.refreshRates(now)).resolves.toBe(true);
    expect(model.updateOne).toHaveBeenCalledTimes(2);
    expect(model.updateOne.mock.calls[1]).toHaveLength(2);
  });

  it('on failure logs at error level, keeps the cache and returns false', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service, fx, model } = setup();
    fx.latest.mockRejectedValue(new Error('FXRatesAPI answered HTTP 503'));
    await expect(service.refreshRates(now)).resolves.toBe(false);
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('FXRatesAPI answered HTTP 503'),
    );

    fx.latest.mockResolvedValue({ date: '2026-11-15', rates: { EGP: -5 } });
    await expect(service.refreshRates(now)).resolves.toBe(false);
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('redacts FX_API_KEY from the logged error, raw or URL-encoded', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const key = 'k3y+with/special=chars';
    const { service, fx } = setup();
    const config = {
      get: jest.fn((n: string) => (n === 'FX_API_KEY' ? key : 'USD')),
    };
    Object.assign(service, { config });
    fx.latest.mockRejectedValue(
      new Error(
        `ETIMEDOUT https://x/latest?api_key=${encodeURIComponent(key)} raw ${key}`,
      ),
    );
    await expect(service.refreshRates(now)).resolves.toBe(false);
    const message = String(log.mock.calls[0][0]);
    expect(message).toContain('ETIMEDOUT');
    expect(message).not.toContain(key);
    expect(message).not.toContain(encodeURIComponent(key));
  });

  it('is stale when nothing is cached or the newest fetch was before today (UTC), whatever the API date', async () => {
    await expect(setup(null).service.isStale(now)).resolves.toBe(true);
    // fetched yesterday
    await expect(setup().service.isStale(now)).resolves.toBe(true);
    // fetched today, even though the API reported yesterday's rateDate: no new fetch today
    const lagging = setup({
      ...CACHED,
      rateDate: '2026-11-14',
      fetchedAt: new Date('2026-11-15T00:30:00Z'),
    });
    await expect(lagging.service.isStale(now)).resolves.toBe(false);
    expect(lagging.model.findOne).toHaveBeenCalledWith(
      { base: 'USD' },
      { _id: 0, fetchedAt: 1 },
    );
    await expect(
      lagging.service.isStale(new Date('2026-11-16T00:00:00Z')),
    ).resolves.toBe(true);
    await expect(setup().service.hasCachedRates()).resolves.toBe(true);
    await expect(setup(null).service.hasCachedRates()).resolves.toBe(false);
  });

  it('supportedCurrencies are the seeded codes', async () => {
    await expect(setup().service.supportedCurrencies()).resolves.toEqual([
      'EGP',
      'JPY',
      'KWD',
      'USD',
    ]);
  });
});
