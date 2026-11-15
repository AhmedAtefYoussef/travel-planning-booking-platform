import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  CURRENCY_SERVICE,
  type CurrencyService,
} from '../src/common/contracts';
import { CurrencyJobsService } from '../src/modules/currency/currency-jobs.service';
import { ExchangeRatesService } from '../src/modules/currency/currency.service';
import {
  FX_RATES_CLIENT,
  type FxRates,
} from '../src/modules/currency/fx-rates.client';
import { ExchangeRate } from '../src/modules/currency/schemas/exchange-rate.schema';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';
import { TEST_ENV } from './support/test-env';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const FX_KEY = TEST_ENV.FX_API_KEY;
const TODAY = new Date('2026-11-15T09:00:00Z');
const YESTERDAY = new Date('2026-11-14T09:00:00Z');

/** Base USD (the test PLATFORM_CURRENCY): 1 USD = 50 EGP = 150 JPY = 0.9 EUR ... */
const RATES: Record<string, number> = {
  AED: 3.6725,
  EGP: 50,
  EUR: 0.9,
  GBP: 0.8,
  JPY: 150,
  SAR: 3.75,
};

/**
 * TRVL-133 (ITN-18, PAY-04): daily FXRatesAPI rates cached in exchange_rates, used through
 * CURRENCY_SERVICE. FX_RATES_CLIENT is a fake, so no test reaches the real API.
 */
describe('Currency rates and conversion (e2e): ITN-18 / PAY-04 (TRVL-133)', () => {
  let app: INestApplication<App>;
  let rates: Model<ExchangeRate>;
  const fx = { latest: jest.fn<Promise<FxRates>, [string, string[]]>() };
  const http = () => request(app.getHttpServer());
  const service = () => app.get<CurrencyService>(CURRENCY_SERVICE);
  const exchange = () => app.get(ExchangeRatesService);
  const jobs = () => app.get(CurrencyJobsService);

  const apiReturns = (date: string, values = RATES) =>
    fx.latest.mockResolvedValue({ date, rates: { ...values } });
  const apiDown = () =>
    fx.latest.mockRejectedValue(new Error('FXRatesAPI request timed out'));

  beforeAll(async () => {
    app = await createTestApp([], [{ provide: FX_RATES_CLIENT, useValue: fx }]);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    rates = app.get<Model<ExchangeRate>>(getModelToken(ExchangeRate.name));
  });

  beforeEach(async () => {
    fx.latest.mockReset();
    await rates.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('asks the API for every seeded currency against the platform currency', async () => {
    apiReturns('2026-11-15');
    await expect(exchange().refreshRates(TODAY)).resolves.toBe(true);
    expect(fx.latest).toHaveBeenCalledTimes(1);
    const [base, symbols] = fx.latest.mock.calls[0];
    expect(base).toBe('USD');
    expect([...symbols].sort()).toEqual([
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
    ]);
    const stored = await rates.find({}).lean().exec();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ base: 'USD', rateDate: '2026-11-15' });
    expect(stored[0].fetchedAt).toEqual(TODAY);
  });

  it('TRVL-133 converts 1000 EGP minor to JPY using minor units', async () => {
    apiReturns('2026-11-15');
    await exchange().refreshRates(TODAY);

    // 10.00 EGP (2 decimals) -> 30 JPY (0 decimals): rate 150 / 50 = 3.
    await expect(service().convert(1000, 'EGP', 'JPY')).resolves.toEqual({
      amountMinor: 30,
      rate: 3,
      rateDate: '2026-11-15',
    });
    // 1000 JPY -> 333.33 EGP = 33333 minor, never 3 or 333333.
    const back = await service().convert(1000, 'JPY', 'EGP');
    expect(back.amountMinor).toBe(33333);
    expect(back.rate).toBeCloseTo(1 / 3, 10);

    const res = await http()
      .get('/api/currencies/convert?amountMinor=1000&from=egp&to=JPY')
      .expect(200);
    expect(res.body).toEqual({
      amountMinor: 30,
      rate: 3,
      rateDate: '2026-11-15',
    });
  });

  it('converts to and from the base currency with its fixed rate of 1', async () => {
    apiReturns('2026-11-15');
    await exchange().refreshRates(TODAY);
    await expect(service().convert(250, 'USD', 'EGP')).resolves.toEqual({
      amountMinor: 12500,
      rate: 50,
      rateDate: '2026-11-15',
    });
    await expect(service().convert(150, 'JPY', 'USD')).resolves.toMatchObject({
      amountMinor: 100,
    });
  });

  it('same currency returns rate 1', async () => {
    apiReturns('2026-11-15');
    await exchange().refreshRates(TODAY);
    await expect(service().convert(1234, 'EGP', 'EGP')).resolves.toEqual({
      amountMinor: 1234,
      rate: 1,
      rateDate: '2026-11-15',
    });
  });

  it("API failure keeps yesterday's rates and rateDate", async () => {
    apiReturns('2026-11-14');
    await expect(exchange().refreshRates(YESTERDAY)).resolves.toBe(true);
    apiDown();
    await expect(exchange().refreshRates(TODAY)).resolves.toBe(false);

    const res = await http().get('/api/currencies/rates').expect(200);
    expect(res.body).toEqual({
      base: 'USD',
      rateDate: '2026-11-14',
      fetchedAt: YESTERDAY.toISOString(),
      rates: RATES,
    });
    await expect(service().convert(1000, 'EGP', 'JPY')).resolves.toEqual({
      amountMinor: 30,
      rate: 3,
      rateDate: '2026-11-14',
    });
  });

  it('empty cache and API down → 503 EXCHANGE_RATE_UNAVAILABLE', async () => {
    apiDown();
    await expect(jobs().bootstrapRefresh(TODAY)).resolves.toBe(false);

    const rateRes = await http().get('/api/currencies/rates').expect(503);
    expect(rateRes.body).toMatchObject({
      statusCode: 503,
      code: 'EXCHANGE_RATE_UNAVAILABLE',
    });
    expect(rateRes.body.message).toMatch(/exchange rates/i);

    const conv = await http()
      .get('/api/currencies/convert?amountMinor=1000&from=EGP&to=JPY')
      .expect(503);
    expect(conv.body.code).toBe('EXCHANGE_RATE_UNAVAILABLE');
    expect(conv.body).not.toHaveProperty('amountMinor');
    await expect(service().convert(1000, 'EGP', 'JPY')).rejects.toMatchObject({
      status: 503,
      code: 'EXCHANGE_RATE_UNAVAILABLE',
    });
  });

  it('a supported currency the API did not return → 503, never a NaN or 0 total', async () => {
    const withoutSar = { ...RATES };
    delete withoutSar.SAR;
    apiReturns('2026-11-15', withoutSar);
    await exchange().refreshRates(TODAY);

    const res = await http()
      .get('/api/currencies/convert?amountMinor=1000&from=SAR&to=EGP')
      .expect(503);
    expect(res.body.code).toBe('EXCHANGE_RATE_UNAVAILABLE');
    expect(res.body.message).toContain('SAR');
    await expect(service().convert(1000, 'EGP', 'SAR')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('unsupported code XYZ → 400 fieldErrors.to', async () => {
    apiReturns('2026-11-15');
    await exchange().refreshRates(TODAY);

    const res = await http()
      .get('/api/currencies/convert?amountMinor=1000&from=EGP&to=XYZ')
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fieldErrors).toEqual([
      { field: 'to', message: expect.stringContaining('XYZ') },
    ]);
    await expect(service().convert(1000, 'ABC', 'EGP')).rejects.toMatchObject({
      status: 400,
    });

    const malformed = await http()
      .get('/api/currencies/convert?amountMinor=1.5&from=eg&to=JPY')
      .expect(400);
    expect(
      malformed.body.fieldErrors.map((e: { field: string }) => e.field).sort(),
    ).toEqual(['amountMinor', 'from']);
  });

  it('lists the supported currencies from the seeded reference data', async () => {
    await expect(service().supportedCurrencies()).resolves.toEqual([
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
      'USD',
    ]);
  });

  it('fetches at bootstrap only when cache empty', async () => {
    apiReturns('2026-11-15');
    await expect(jobs().bootstrapRefresh(TODAY)).resolves.toBe(true);
    expect(fx.latest).toHaveBeenCalledTimes(1);
    await expect(jobs().bootstrapRefresh(TODAY)).resolves.toBe(false);
    expect(fx.latest).toHaveBeenCalledTimes(1);
  });

  it('the hourly tick fetches once per UTC day, only when the newest rateDate is before today', async () => {
    apiReturns('2026-11-14');
    await exchange().refreshRates(YESTERDAY);
    fx.latest.mockClear();

    await expect(jobs().tick(new Date('2026-11-14T23:00:00Z'))).resolves.toBe(
      false,
    );
    expect(fx.latest).not.toHaveBeenCalled();

    apiReturns('2026-11-15');
    await expect(jobs().tick(new Date('2026-11-15T00:30:00Z'))).resolves.toBe(
      true,
    );
    await expect(jobs().tick(new Date('2026-11-15T01:30:00Z'))).resolves.toBe(
      false,
    );
    expect(fx.latest).toHaveBeenCalledTimes(1);
    const res = await http().get('/api/currencies/rates').expect(200);
    expect(res.body.rateDate).toBe('2026-11-15');
  });

  it('rejects payload with negative or missing rates', async () => {
    apiReturns('2026-11-14');
    await exchange().refreshRates(YESTERDAY);

    apiReturns('2026-11-15', { ...RATES, JPY: -150 });
    await expect(exchange().refreshRates(TODAY)).resolves.toBe(false);
    fx.latest.mockResolvedValue({ date: '2026-11-15' } as FxRates);
    await expect(exchange().refreshRates(TODAY)).resolves.toBe(false);
    apiReturns('2026-11-15', { ...RATES, EGP: Number.NaN });
    await expect(exchange().refreshRates(TODAY)).resolves.toBe(false);

    const stored = await rates.find({}).lean().exec();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ rateDate: '2026-11-14', rates: RATES });
  });

  it('response never contains FX_API_KEY', async () => {
    apiReturns('2026-11-15');
    await exchange().refreshRates(TODAY);
    const ok = [
      await http().get('/api/currencies/rates').expect(200),
      await http()
        .get('/api/currencies/convert?amountMinor=1000&from=EGP&to=JPY')
        .expect(200),
    ];
    await rates.deleteMany({});
    const failed = [
      await http().get('/api/currencies/rates').expect(503),
      await http()
        .get('/api/currencies/convert?amountMinor=1000&from=EGP&to=JPY')
        .expect(503),
    ];
    for (const res of [...ok, ...failed]) {
      expect(res.text).not.toContain(FX_KEY);
      expect(JSON.stringify(res.headers)).not.toContain(FX_KEY);
    }
  });

  it('the rate routes are public and do not shadow GET /api/currencies', async () => {
    const list = await http().get('/api/currencies').expect(200);
    expect(list.body.total).toBe(7);
    await http().get('/api/currencies/rates').expect(503);
  });
});
