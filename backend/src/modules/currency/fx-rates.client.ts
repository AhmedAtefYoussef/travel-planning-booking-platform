import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';

/** Injection token of the exchange-rate source; e2e tests replace it with a fake. */
export const FX_RATES_CLIENT = Symbol('FX_RATES_CLIENT');

export interface FxRates {
  /** Day the rates are for, YYYY-MM-DD (UTC). */
  date: string;
  /** Units of each code per one unit of the requested base; only requested codes. */
  rates: Record<string, number>;
}

export interface FxRatesClient {
  latest(base: string, symbols: readonly string[]): Promise<FxRates>;
}

/** Any failure to get usable rates. Messages never contain FX_API_KEY. */
export class FxRatesError extends Error {
  override readonly name = 'FxRatesError';
}

const TIMEOUT_MS = 10_000;

/**
 * Removes FX_API_KEY from text that may be logged or thrown: the raw key, its URL-encoded forms, and the
 * whole value of any `api_key=` query parameter whatever its encoding.
 */
export function redactFxKey(text: string, key: string | undefined): string {
  let out = text.replace(/(api_key=)[^&\s"'<>)]*/gi, '$1[redacted]');
  if (key) {
    const forms = new Set([
      key,
      encodeURIComponent(key),
      new URLSearchParams({ k: key }).toString().slice(2),
    ]);
    for (const form of forms) out = out.split(form).join('[redacted]');
  }
  return out;
}
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** "2026-11-15T21:24:00.000Z" or "2026-11-15" -> "2026-11-15"; null for anything else. */
function toDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = DAY.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d)
    ? `${y}-${mo}-${d}`
    : null;
}

/**
 * Validates a rate payload before it is cached (ITN-18): a real day, and every returned rate a finite
 * number above 0. One bad rate rejects the whole payload, so a broken answer never replaces good cached
 * rates. A requested code the API did not return is simply absent (conversion then answers 503).
 */
export function validateFxRates(
  payload: unknown,
  symbols: readonly string[],
): FxRates {
  if (!isRecord(payload))
    throw new FxRatesError('Exchange-rate payload is not an object');
  const date = toDay(payload.date);
  if (!date)
    throw new FxRatesError('Exchange-rate payload has no valid rate date');
  if (!isRecord(payload.rates))
    throw new FxRatesError('Exchange-rate payload has no rates');
  const rates: Record<string, number> = {};
  for (const code of symbols) {
    if (!(code in payload.rates)) continue;
    const rate = payload.rates[code];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
      throw new FxRatesError(
        `Exchange rate for ${code} is not a positive number`,
      );
    rates[code] = rate;
  }
  if (Object.keys(rates).length === 0)
    throw new FxRatesError('Exchange-rate payload has none of the currencies');
  return { date, rates };
}

/**
 * FX_RATES_CLIENT over FXRatesAPI (`GET {FX_API_BASE_URL}/latest`), with Node's fetch and a 10 s timeout.
 * FX_API_KEY goes only into the outgoing query string: it is redacted from every error message, and
 * nothing from this client is ever returned to API clients except the validated rates.
 */
@Injectable()
export class HttpFxRatesClient implements FxRatesClient {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async latest(base: string, symbols: readonly string[]): Promise<FxRates> {
    const key = this.config.get('FX_API_KEY', { infer: true });
    const root = this.config
      .get('FX_API_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
    const url = new URL(`${root}/latest`);
    url.searchParams.set('base', base);
    url.searchParams.set('currencies', symbols.join(','));
    url.searchParams.set('api_key', key);

    const redact = (text: string) => redactFxKey(text, key);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const reason = e instanceof Error ? `${e.name}: ${e.message}` : 'error';
      throw new FxRatesError(redact(`FXRatesAPI request failed (${reason})`));
    }
    if (!res.ok)
      throw new FxRatesError(`FXRatesAPI answered HTTP ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new FxRatesError('FXRatesAPI answered with something not JSON');
    }
    if (!isRecord(body) || body.success !== true) {
      const code =
        isRecord(body) && typeof body.error === 'string' ? body.error : '?';
      throw new FxRatesError(redact(`FXRatesAPI reported failure (${code})`));
    }
    if (body.base !== undefined && body.base !== base)
      throw new FxRatesError(
        `FXRatesAPI answered for base ${JSON.stringify(body.base)}, not ${base}`,
      );
    return validateFxRates(body, symbols);
  }
}
