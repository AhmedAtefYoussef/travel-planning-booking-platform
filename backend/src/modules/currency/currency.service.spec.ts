/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CurrencyService } from './currency.service';

const TODAY = new Date().toISOString().slice(0, 10);
const RATES = {
  USD: 1,
  EUR: 0.9,
  EGP: 50,
  JPY: 150,
  GBP: 0.8,
  AED: 3.67,
  SAR: 3.75,
};

/** In-memory stand-in for the exchange_rates collection. */
function fakeModel(initial: any[] = []) {
  const docs = [...initial];
  return {
    docs,
    findOne: (filter: any = {}) => ({
      sort: () => ({
        lean: () => ({
          exec: () =>
            Promise.resolve(
              [...docs]
                .filter(
                  (d) => !filter.rateDate || d.rateDate === filter.rateDate,
                )
                .sort((a, b) => b.rateDate.localeCompare(a.rateDate))[0] ??
                null,
            ),
        }),
      }),
      lean: () => ({
        exec: () =>
          Promise.resolve(
            docs.find((d) => d.rateDate === filter.rateDate) ?? null,
          ),
      }),
    }),
    updateOne: (filter: any, update: any) => ({
      exec: () => {
        const i = docs.findIndex((d) => d.rateDate === filter.rateDate);
        const doc = { ...update.$set };
        if (i >= 0) docs[i] = doc;
        else docs.push(doc);
        return Promise.resolve();
      },
    }),
  };
}

function config(key: string) {
  return (
    { FX_API_BASE_URL: 'https://fx.test', FX_API_KEY: 'k' } as Record<
      string,
      string
    >
  )[key];
}

function fetchOk(rates: Record<string, number> = RATES, date = TODAY) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ date, rates }),
  });
}

describe('CurrencyService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function make(model = fakeModel()) {
    return {
      model,
      service: new CurrencyService(model as any, { get: config } as any),
    };
  }

  it('fetches rates from FX_API_BASE_URL and converts minor units', async () => {
    const fx = fetchOk();
    global.fetch = fx as any;
    const { service } = make();
    // 100.00 USD -> EGP at 50
    const r = await service.convert(10000, 'USD', 'EGP');
    expect(r).toEqual({ amountMinor: 500000, rate: 50, rateDate: TODAY });
    const url = new URL(fx.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://fx.test/latest');
    expect(url.searchParams.get('base')).toBe('USD');
    expect(url.searchParams.get('api_key')).toBe('k');
  });

  it('handles cross rates and zero-decimal currencies', async () => {
    global.fetch = fetchOk() as any;
    const { service } = make();
    // 10.00 EUR -> JPY: 10 / 0.9 * 150 = 1666.67 -> 1667 yen
    const r = await service.convert(1000, 'EUR', 'JPY');
    expect(r.amountMinor).toBe(1667);
    expect(r.rate).toBeCloseTo(150 / 0.9);
    // JPY -> USD: 1500 yen = 10.00 USD = 1000 cents
    expect((await service.convert(1500, 'JPY', 'USD')).amountMinor).toBe(1000);
  });

  it('uses cached rates when the fetch fails', async () => {
    const old = { base: 'USD', rateDate: '2020-01-01', rates: RATES };
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
    const { service } = make(fakeModel([old]));
    const r = await service.convert(100, 'USD', 'EUR');
    expect(r).toEqual({ amountMinor: 90, rate: 0.9, rateDate: '2020-01-01' });
  });

  it('uses cached rates when the API answers with a non-2xx status', async () => {
    const old = { base: 'USD', rateDate: '2020-01-01', rates: RATES };
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: () => ({}) }) as any;
    const { service } = make(fakeModel([old]));
    expect((await service.convert(100, 'USD', 'EUR')).rateDate).toBe(
      '2020-01-01',
    );
  });

  it('pauses request-path refreshes for 30 minutes after a failed fetch', async () => {
    const old = { base: 'USD', rateDate: '2020-01-01', rates: RATES };
    const fx = jest.fn().mockRejectedValue(new Error('down'));
    global.fetch = fx as any;
    const { service } = make(fakeModel([old]));
    await service.convert(100, 'USD', 'EUR');
    const r = await service.convert(100, 'USD', 'EUR');
    expect(r.rateDate).toBe('2020-01-01');
    expect(fx).toHaveBeenCalledTimes(1);

    const realNow = Date.now;
    Date.now = () => realNow() + 31 * 60 * 1000;
    try {
      await service.convert(100, 'USD', 'EUR');
    } finally {
      Date.now = realNow;
    }
    expect(fx).toHaveBeenCalledTimes(2);
  });

  it('does not refetch when today is already cached', async () => {
    const fx = fetchOk();
    global.fetch = fx as any;
    const today = { base: 'USD', rateDate: TODAY, rates: RATES };
    const { service } = make(fakeModel([today]));
    await service.convert(100, 'USD', 'EUR');
    expect(fx).not.toHaveBeenCalled();
  });

  it('persists fetched rates', async () => {
    global.fetch = fetchOk() as any;
    const { service, model } = make();
    await service.convert(100, 'USD', 'EUR');
    expect(model.docs).toHaveLength(1);
    expect(model.docs[0].rateDate).toBe(TODAY);
  });

  it('answers 503 when no rates were ever cached and fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
    const { service } = make();
    await expect(service.convert(100, 'USD', 'EUR')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 400 for unsupported codes', async () => {
    global.fetch = fetchOk() as any;
    const { service } = make();
    await expect(service.convert(100, 'USD', 'XYZ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.convert(100, 'CHF', 'USD')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('is case-insensitive and rejects bad amounts', async () => {
    global.fetch = fetchOk() as any;
    const { service } = make();
    expect((await service.convert(100, 'usd', 'eur')).amountMinor).toBe(90);
    await expect(service.convert(1.5, 'USD', 'EUR')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lists supported currencies and rates', async () => {
    global.fetch = fetchOk() as any;
    const { service } = make();
    expect(await service.supportedCurrencies()).toEqual([
      'EGP',
      'AED',
      'GBP',
      'USD',
      'EUR',
      'JPY',
      'SAR',
    ]);
    expect(await service.getRatesView()).toEqual({
      base: 'USD',
      rateDate: TODAY,
      rates: RATES,
    });
  });
});
