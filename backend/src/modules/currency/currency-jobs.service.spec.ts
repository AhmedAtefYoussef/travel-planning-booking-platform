import { Logger } from '@nestjs/common';
import {
  CURRENCY_JOB_INTERVAL_MS,
  CurrencyJobsService,
} from './currency-jobs.service';
import type { ExchangeRatesService } from './currency.service';

function setup(nodeEnv = 'production') {
  const rates = {
    hasCachedRates: jest.fn().mockResolvedValue(false),
    isStale: jest.fn().mockResolvedValue(false),
    refreshRates: jest.fn().mockResolvedValue(true),
  };
  const config = { get: jest.fn().mockReturnValue(nodeEnv) };
  const jobs = new CurrencyJobsService(
    rates as unknown as ExchangeRatesService,
    config as never,
  );
  return { rates, jobs };
}

describe('CurrencyJobsService: ITN-18 daily rates (TRVL-133)', () => {
  const now = new Date('2026-11-15T09:00:00Z');
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('bootstrap refreshes only when no rates are cached', async () => {
    const { rates, jobs } = setup();
    await expect(jobs.bootstrapRefresh(now)).resolves.toBe(true);
    expect(rates.refreshRates).toHaveBeenCalledWith(now);

    rates.hasCachedRates.mockResolvedValue(true);
    rates.refreshRates.mockClear();
    await expect(jobs.bootstrapRefresh(now)).resolves.toBe(false);
    expect(rates.refreshRates).not.toHaveBeenCalled();
  });

  it('the tick refreshes only when the cache is stale', async () => {
    const { rates, jobs } = setup();
    await expect(jobs.tick(now)).resolves.toBe(false);
    expect(rates.refreshRates).not.toHaveBeenCalled();
    rates.isStale.mockResolvedValue(true);
    await expect(jobs.tick(now)).resolves.toBe(true);
    expect(rates.refreshRates).toHaveBeenCalledWith(now);
  });

  it('is not started in tests', () => {
    jest.useFakeTimers();
    const { rates, jobs } = setup('test');
    jobs.onApplicationBootstrap();
    jest.advanceTimersByTime(CURRENCY_JOB_INTERVAL_MS * 3);
    expect(rates.hasCachedRates).not.toHaveBeenCalled();
    expect(rates.isStale).not.toHaveBeenCalled();
    jobs.onApplicationShutdown();
  });

  it('runs the bootstrap check at start and the stale check every hour, on an unref’d timer', async () => {
    jest.useFakeTimers();
    const { rates, jobs } = setup();
    jobs.onApplicationBootstrap();
    await Promise.resolve();
    expect(rates.hasCachedRates).toHaveBeenCalledTimes(1);
    expect(rates.isStale).not.toHaveBeenCalled();
    jest.advanceTimersByTime(CURRENCY_JOB_INTERVAL_MS);
    expect(rates.isStale).toHaveBeenCalledTimes(1);
    jobs.onApplicationShutdown();
    jest.advanceTimersByTime(CURRENCY_JOB_INTERVAL_MS);
    expect(rates.isStale).toHaveBeenCalledTimes(1);
    expect(CURRENCY_JOB_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it('redacts FX_API_KEY (raw and URL-encoded) from a logged job failure and its stack', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const key = 'job-K3y+/=';
    const { rates, jobs } = setup();
    Object.assign(jobs, {
      config: {
        get: (n: string) => (n === 'FX_API_KEY' ? key : 'production'),
      },
    });
    rates.hasCachedRates.mockRejectedValue(
      new Error(
        `boom ?api_key=${encodeURIComponent(key)} raw ${key} ${encodeURIComponent(key)}`,
      ),
    );
    jobs.onApplicationBootstrap();
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).toHaveBeenCalledTimes(1);
    const [message, stack] = log.mock.calls[0] as [string, string];
    expect(message).toContain('boom');
    for (const text of [message, stack]) {
      expect(text).not.toContain(key);
      expect(text).not.toContain(encodeURIComponent(key));
    }
    jobs.onApplicationShutdown();
  });

  it('logs a job failure instead of crashing the process', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { rates, jobs } = setup();
    rates.hasCachedRates.mockRejectedValue(new Error('db down'));
    jobs.onApplicationBootstrap();
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('db down'),
      expect.anything(),
    );
    jobs.onApplicationShutdown();
  });
});
