import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { CURRENCY_SERVICE, CurrencyService } from '../src/common/contracts';
import {
  CurrencyRatesService,
  ExchangeRate,
  FxRatesClient,
} from '../src/modules/currency';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const SEEDED = ['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD'];

/** TRVL-133 / ITN-18: daily FXRatesAPI rates cached in the database, with a cached fallback. */
describe('Currency (e2e): TRVL-133, ITN-18', () => {
  let app: INestApplication<App>;
  let rates: Model<ExchangeRate>;
  let service: CurrencyRatesService;
  let fetchLatest: jest.SpyInstance;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    rates = app.get<Model<ExchangeRate>>(getModelToken(ExchangeRate.name));
    service = app.get(CurrencyRatesService);
    // The real FXRatesAPI is never called from tests.
    fetchLatest = jest.spyOn(app.get(FxRatesClient), 'fetchLatest');
  });

  beforeEach(async () => {
    await rates.deleteMany({});
    fetchLatest.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  const day1 = new Date('2026-11-10T06:00:00Z');
  const day2 = new Date('2026-11-11T06:00:00Z');
  const snapshot = (rateDate: string, egp: number) => ({
    base: 'USD',
    rateDate,
    rates: { AED: 3.6725, EGP: egp, EUR: 0.8, GBP: 0.75, JPY: 150, SAR: 3.75 },
  });

  it('answers 503 EXCHANGE_RATE_UNAVAILABLE while no rates were ever cached', async () => {
    const res = await http().get('/api/currencies/rates').expect(503);
    expect(res.body).toMatchObject({
      statusCode: 503,
      code: 'EXCHANGE_RATE_UNAVAILABLE',
    });
    const convert = await http()
      .get('/api/currencies/convert')
      .query({ amountMinor: 100, from: 'USD', to: 'EGP' })
      .expect(503);
    expect(convert.body.code).toBe('EXCHANGE_RATE_UNAVAILABLE');
  });

  it('fetches the seeded currencies once per day and serves them publicly with their date', async () => {
    fetchLatest.mockResolvedValue(snapshot('2026-11-10', 50));
    await expect(service.refresh(day1)).resolves.toBe('fetched');
    expect(fetchLatest).toHaveBeenCalledWith(
      'USD',
      SEEDED.filter((c) => c !== 'USD'),
    );

    // A second run on the same day does not call the API again.
    await expect(
      service.refresh(new Date('2026-11-10T23:59:00Z')),
    ).resolves.toBe('fresh');
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    const res = await http().get('/api/currencies/rates').expect(200);
    expect(res.body).toEqual({
      base: 'USD',
      rateDate: '2026-11-10',
      fetchedAt: day1.toISOString(),
      rates: {
        AED: 3.6725,
        EGP: 50,
        EUR: 0.8,
        GBP: 0.75,
        JPY: 150,
        SAR: 3.75,
        USD: 1,
      },
      supportedCurrencies: SEEDED,
    });
    expect(JSON.stringify(res.body)).not.toContain(
      process.env.FX_API_KEY as string,
    );
  });

  it('keeps one document per rate day and reads the newest', async () => {
    fetchLatest.mockResolvedValueOnce(snapshot('2026-11-10', 50));
    await service.refresh(day1);
    fetchLatest.mockResolvedValueOnce(snapshot('2026-11-11', 51));
    await expect(service.refresh(day2)).resolves.toBe('fetched');
    expect(await rates.countDocuments()).toBe(2);

    const res = await http()
      .get('/api/currencies/convert')
      .query({ amountMinor: 12500, from: 'USD', to: 'EGP' })
      .expect(200);
    expect(res.body).toEqual({
      amountMinor: 12500,
      from: 'USD',
      convertedMinor: 637500,
      to: 'EGP',
      rate: 51,
      rateDate: '2026-11-11',
    });
  });

  it('a refetch that reports the same rate day updates that document instead of adding one', async () => {
    fetchLatest.mockResolvedValueOnce(snapshot('2026-11-10', 50));
    await service.refresh(day1);
    fetchLatest.mockResolvedValueOnce(snapshot('2026-11-10', 50.5));
    await expect(service.refresh(day2)).resolves.toBe('fetched');
    expect(await rates.countDocuments()).toBe(1);
    await expect(service.convert(100, 'USD', 'EGP')).resolves.toMatchObject({
      amountMinor: 5050,
    });
  });

  it('the database refuses a second document for the same base and rate day', async () => {
    const doc = {
      base: 'USD',
      rateDate: '2026-11-10',
      rates: { EUR: 0.8 },
      fetchedAt: day1,
    };
    await rates.create(doc);
    await expect(rates.create(doc)).rejects.toMatchObject({ code: 11000 });
  });

  it('uses the last cached rates when the API is unavailable', async () => {
    fetchLatest.mockResolvedValueOnce(snapshot('2026-11-10', 50));
    await service.refresh(day1);
    fetchLatest.mockRejectedValueOnce(
      new Error('FXRatesAPI answered HTTP 500'),
    );
    await expect(service.refresh(day2)).resolves.toBe('failed');

    const res = await http().get('/api/currencies/rates').expect(200);
    expect(res.body.rateDate).toBe('2026-11-10');
    const convert = await http()
      .get('/api/currencies/convert')
      .query({ amountMinor: 10000, from: 'EUR', to: 'EGP' })
      .expect(200);
    // 100.00 EUR = 125.00 USD = 6250.00 EGP
    expect(convert.body).toMatchObject({
      convertedMinor: 625000,
      rateDate: '2026-11-10',
    });
  });

  it('never converts with a missing rate: a currency the API did not return is a 503', async () => {
    const partial = snapshot('2026-11-10', 50);
    delete (partial.rates as Record<string, number>).JPY;
    fetchLatest.mockResolvedValueOnce(partial);
    await service.refresh(day1);

    const res = await http()
      .get('/api/currencies/convert')
      .query({ amountMinor: 1000, from: 'USD', to: 'JPY' })
      .expect(503);
    expect(res.body).toMatchObject({
      code: 'EXCHANGE_RATE_UNAVAILABLE',
      message:
        'No exchange rate is available for JPY (rates of 2026-11-10). Please try again later.',
    });
    const listed = await http().get('/api/currencies/rates').expect(200);
    expect(listed.body.rates).not.toHaveProperty('JPY');
    expect(listed.body.supportedCurrencies).toContain('JPY');
  });

  describe('GET /api/currencies/convert input rules', () => {
    beforeEach(async () => {
      fetchLatest.mockResolvedValueOnce(snapshot('2026-11-10', 50));
      await service.refresh(day1);
    });

    const convert = (query: Record<string, unknown>) =>
      http().get('/api/currencies/convert').query(query);

    it('is public, case-insensitive and respects minor units (JPY has none)', async () => {
      const res = await convert({
        amountMinor: 1000,
        from: 'usd',
        to: 'jpy',
      }).expect(200);
      expect(res.body).toMatchObject({
        from: 'USD',
        to: 'JPY',
        convertedMinor: 1500,
      });
    });

    it('rejects a currency outside the supported list with 400', async () => {
      const res = await convert({
        amountMinor: 100,
        from: 'USD',
        to: 'CHF',
      }).expect(400);
      expect(res.body.message).toBe(
        'Unsupported currency "CHF". Supported currencies: AED, EGP, EUR, GBP, JPY, SAR, USD',
      );
    });

    it.each([
      ['a missing amount', { from: 'USD', to: 'EGP' }, 'amountMinor'],
      [
        'a decimal amount',
        { amountMinor: '10.5', from: 'USD', to: 'EGP' },
        'amountMinor',
      ],
      [
        'a negative amount',
        { amountMinor: -1, from: 'USD', to: 'EGP' },
        'amountMinor',
      ],
      [
        'an unsafe integer',
        { amountMinor: '99999999999999999999', from: 'USD', to: 'EGP' },
        'amountMinor',
      ],
      ['a malformed code', { amountMinor: 1, from: 'US', to: 'EGP' }, 'from'],
      ['a missing target', { amountMinor: 1, from: 'USD' }, 'to'],
    ])('rejects %s with a field error', async (_name, query, field) => {
      const res = await convert(query).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(
        res.body.fieldErrors.map((e: { field: string }) => e.field),
      ).toContain(field);
    });

    it('rejects a page-size parameter like every other route (GEN-05)', async () => {
      await convert({
        amountMinor: 1,
        from: 'USD',
        to: 'EGP',
        limit: 50,
      }).expect(400);
    });
  });

  it('other modules reach the same service through CURRENCY_SERVICE', async () => {
    fetchLatest.mockResolvedValueOnce(snapshot('2026-11-10', 50));
    await service.refresh(day1);
    const contract = app.get<CurrencyService>(CURRENCY_SERVICE);
    await expect(contract.supportedCurrencies()).resolves.toEqual(SEEDED);
    await expect(contract.convert(200, 'USD', 'EGP')).resolves.toEqual({
      amountMinor: 10000,
      rate: 50,
      rateDate: '2026-11-10',
    });
  });
});
