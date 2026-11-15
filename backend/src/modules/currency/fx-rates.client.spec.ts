import {
  FxRatesError,
  HttpFxRatesClient,
  validateFxRates,
} from './fx-rates.client';

const KEY = 'dummydummy';
const settings: Record<string, string> = {
  FX_API_KEY: KEY,
  FX_API_BASE_URL: 'https://api.fxratesapi.com/',
};
const config = { get: jest.fn((name: string) => settings[name]) };

function respond(status: number, body: unknown) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const LIVE_SHAPE = {
  success: true,
  terms: 'https://fxratesapi.com/legal/terms-conditions',
  timestamp: 1794777840,
  date: '2026-11-15T21:24:00.000Z',
  base: 'USD',
  rates: { EGP: 53.8000102412, JPY: 159.7000308478 },
};

describe('FXRatesAPI client: ITN-18 (TRVL-133)', () => {
  afterEach(() => jest.restoreAllMocks());
  const client = new HttpFxRatesClient(config as never);

  it('calls /latest with base, currencies and the key, under a 10 s timeout', async () => {
    const fetch = respond(200, LIVE_SHAPE);
    await expect(client.latest('USD', ['EGP', 'JPY'])).resolves.toEqual({
      date: '2026-11-15',
      rates: { EGP: 53.8000102412, JPY: 159.7000308478 },
    });
    const [url, init] = fetch.mock.calls[0];
    const parsed = new URL(url as URL);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://api.fxratesapi.com/latest',
    );
    expect(parsed.searchParams.get('base')).toBe('USD');
    expect(parsed.searchParams.get('currencies')).toBe('EGP,JPY');
    expect(parsed.searchParams.get('api_key')).toBe(KEY);
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects success:false, HTTP errors and non-JSON without the key in the message', async () => {
    respond(200, { success: false, error: 'invalid_currencies' });
    await expect(client.latest('USD', ['EGP'])).rejects.toThrow(FxRatesError);

    respond(500, { success: false });
    const http = await client.latest('USD', ['EGP']).catch((e: Error) => e);
    expect(http).toBeInstanceOf(FxRatesError);
    expect((http as Error).message).toContain('500');

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    await expect(client.latest('USD', ['EGP'])).rejects.toThrow(/JSON/);
  });

  it('redacts the key when the network error echoes the URL', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(
        new Error(
          `connect ETIMEDOUT https://api.fxratesapi.com/latest?api_key=${KEY}`,
        ),
      );
    const error = (await client
      .latest('USD', ['EGP'])
      .catch((e: Error) => e)) as Error;
    expect(error).toBeInstanceOf(FxRatesError);
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain('ETIMEDOUT');
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it('rejects a base other than the one requested', async () => {
    respond(200, { ...LIVE_SHAPE, base: 'EUR' });
    await expect(client.latest('USD', ['EGP'])).rejects.toThrow(/base/);
  });
});

describe('validateFxRates: ITN-18 (TRVL-133)', () => {
  it('keeps only requested codes and normalises the date to YYYY-MM-DD', () => {
    expect(
      validateFxRates(
        {
          date: '2026-11-15T21:24:00.000Z',
          rates: { EGP: 50, JPY: 150, XAU: 0.0004 },
        },
        ['EGP', 'JPY'],
      ),
    ).toEqual({ date: '2026-11-15', rates: { EGP: 50, JPY: 150 } });
  });

  it('accepts a payload that lacks some requested currencies', () => {
    expect(
      validateFxRates({ date: '2026-11-15', rates: { EGP: 50 } }, [
        'EGP',
        'SAR',
      ]),
    ).toEqual({ date: '2026-11-15', rates: { EGP: 50 } });
  });

  it.each([
    ['a negative rate', { date: '2026-11-15', rates: { EGP: -1 } }],
    ['a zero rate', { date: '2026-11-15', rates: { EGP: 0 } }],
    ['a NaN rate', { date: '2026-11-15', rates: { EGP: Number.NaN } }],
    ['an infinite rate', { date: '2026-11-15', rates: { EGP: Infinity } }],
    ['a text rate', { date: '2026-11-15', rates: { EGP: '50' } }],
    ['missing rates', { date: '2026-11-15' }],
    ['no requested rate at all', { date: '2026-11-15', rates: { XAU: 1 } }],
    ['rates as an array', { date: '2026-11-15', rates: [50] }],
    ['a missing date', { rates: { EGP: 50 } }],
    ['a malformed date', { date: 'yesterday', rates: { EGP: 50 } }],
    ['an impossible date', { date: '2026-02-30', rates: { EGP: 50 } }],
    ['null', null],
  ])('rejects %s', (_label, payload) => {
    expect(() => validateFxRates(payload, ['EGP'])).toThrow(FxRatesError);
  });
});
