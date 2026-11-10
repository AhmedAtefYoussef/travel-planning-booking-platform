import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';

/** What the rest of the module needs from one successful FXRatesAPI call. */
export interface FxRatesSnapshot {
  base: string;
  /** YYYY-MM-DD (UTC) the rates are from. */
  rateDate: string;
  /** 1 unit of base = rate units of the key. Only finite, positive rates are kept. */
  rates: Record<string, number>;
}

/** Thrown for every failed fetch; the message never contains the API key. */
export class FxRatesApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxRatesApiError';
  }
}

export const FX_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The only place that talks to FXRatesAPI (brief section 6.5). The key stays on the server: it is sent
 * in the Authorization header, never in the URL, so it cannot leak through logs or error messages,
 * and no endpoint returns it.
 */
@Injectable()
export class FxRatesClient {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** GET {FX_API_BASE_URL}/latest?base=USD&currencies=EUR,EGP: the latest rates for `currencies`. */
  async fetchLatest(
    base: string,
    currencies: readonly string[],
  ): Promise<FxRatesSnapshot> {
    const baseUrl = this.config
      .get('FX_API_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
    const url = new URL(`${baseUrl}/latest`);
    url.searchParams.set('base', base);
    url.searchParams.set('currencies', currencies.join(','));
    url.searchParams.set('resolution', '1d');

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.get('FX_API_KEY', { infer: true })}`,
        },
        signal: AbortSignal.timeout(FX_REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      const reason =
        e instanceof Error && e.name === 'TimeoutError'
          ? `timed out after ${FX_REQUEST_TIMEOUT_MS} ms`
          : 'the request could not be sent';
      throw new FxRatesApiError(`FXRatesAPI is unreachable: ${reason}`);
    }
    if (!response.ok) {
      throw new FxRatesApiError(`FXRatesAPI answered HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new FxRatesApiError('FXRatesAPI returned a body that is not JSON');
    }
    return parseSnapshot(body, base);
  }
}

function parseSnapshot(body: unknown, requestedBase: string): FxRatesSnapshot {
  if (typeof body !== 'object' || body === null) {
    throw new FxRatesApiError('FXRatesAPI returned an unexpected body');
  }
  const { success, base, date, rates } = body as Record<string, unknown>;
  if (success !== true) {
    throw new FxRatesApiError('FXRatesAPI reported a failed request');
  }
  if (base !== requestedBase) {
    throw new FxRatesApiError(
      `FXRatesAPI returned rates for another base currency (asked for ${requestedBase})`,
    );
  }
  const rateDate = typeof date === 'string' ? date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate) || !isCalendarDate(rateDate)) {
    throw new FxRatesApiError('FXRatesAPI returned no usable rate date');
  }
  if (typeof rates !== 'object' || rates === null) {
    throw new FxRatesApiError('FXRatesAPI returned no rates');
  }
  const clean: Record<string, number> = {};
  for (const [code, rate] of Object.entries(rates)) {
    // A zero, negative or non-numeric rate must never be cached: it would produce a wrong total.
    if (
      /^[A-Z]{3}$/.test(code) &&
      typeof rate === 'number' &&
      Number.isFinite(rate) &&
      rate > 0
    ) {
      clean[code] = rate;
    }
  }
  if (Object.keys(clean).length === 0) {
    throw new FxRatesApiError('FXRatesAPI returned no usable rates');
  }
  return { base: requestedBase, rateDate, rates: clean };
}

/** 2026-02-30 parses in some runtimes; only a date that survives a round trip is real. */
function isCalendarDate(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
  );
}
