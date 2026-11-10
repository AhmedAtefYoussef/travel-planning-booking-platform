import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { FxRatesApiError, FxRatesClient } from './fx-rates.client';

const KEY = 'unit-test-fx-key';

function client(): FxRatesClient {
  const values: Record<string, string> = {
    FX_API_BASE_URL: 'https://fx.example.test/',
    FX_API_KEY: KEY,
  };
  return new FxRatesClient({
    get: (name: string) => values[name],
  } as unknown as ConfigService<EnvironmentVariables, true>);
}

function respondWith(body: unknown, status = 200): jest.Mock {
  const mock = jest.fn(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      }),
    ),
  );
  global.fetch = mock;
  return mock;
}

const OK = {
  success: true,
  base: 'USD',
  date: '2026-11-10T00:00:00.000Z',
  rates: { EUR: 0.92, EGP: 49.3 },
};

describe('FxRatesClient (TRVL-133)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('asks for the latest daily rates of the given currencies and keeps the key out of the URL', async () => {
    const fetchMock = respondWith(OK);
    const snapshot = await client().fetchLatest('USD', ['EUR', 'EGP']);

    expect(snapshot).toEqual({
      base: 'USD',
      rateDate: '2026-11-10',
      rates: { EUR: 0.92, EGP: 49.3 },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toBe(
      'https://fx.example.test/latest?base=USD&currencies=EUR%2CEGP&resolution=1d',
    );
    expect(url.toString()).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
  });

  it('drops rates that are not positive finite numbers', async () => {
    respondWith({
      ...OK,
      rates: { EUR: 0.92, EGP: 0, GBP: -1, JPY: 'x', SAR: null, aed: 3.67 },
    });
    const snapshot = await client().fetchLatest('USD', ['EUR']);
    expect(snapshot.rates).toEqual({ EUR: 0.92 });
  });

  it.each([
    ['an HTTP error', { ...OK }, 500, 'HTTP 500'],
    ['success: false', { ...OK, success: false }, 200, 'failed request'],
    ['another base', { ...OK, base: 'EUR' }, 200, 'another base currency'],
    ['no date', { ...OK, date: undefined }, 200, 'no usable rate date'],
    ['a bad date', { ...OK, date: '2026-13-45' }, 200, 'no usable rate date'],
    ['no rates', { ...OK, rates: undefined }, 200, 'no rates'],
    ['only unusable rates', { ...OK, rates: { EUR: 0 } }, 200, 'no usable'],
    ['a body without the expected fields', [1], 200, 'failed request'],
    ['a body that is not an object', 7, 200, 'unexpected body'],
    ['a body that is not JSON', '<html>', 200, 'not JSON'],
  ])('rejects %s', async (_name, body, status, message) => {
    respondWith(body, status);
    const attempt = client().fetchLatest('USD', ['EUR']);
    await expect(attempt).rejects.toBeInstanceOf(FxRatesApiError);
    await expect(attempt).rejects.toThrow(message);
  });

  it('reports a network failure without leaking the key', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error(`connect failed for key ${KEY}`)),
    );
    let message = '';
    try {
      await client().fetchLatest('USD', ['EUR']);
    } catch (e) {
      expect(e).toBeInstanceOf(FxRatesApiError);
      message = (e as Error).message;
    }
    expect(message).toBe(
      'FXRatesAPI is unreachable: the request could not be sent',
    );
    expect(message).not.toContain(KEY);
  });

  it('reports a timeout', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(
        Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
      ),
    );
    await expect(client().fetchLatest('USD', ['EUR'])).rejects.toThrow(
      'timed out after 10000 ms',
    );
  });
});
