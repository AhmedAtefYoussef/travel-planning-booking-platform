import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { IntervalJob, type JobTask } from './interval-job';

const INTERVAL = 1_000;

class TestJob extends IntervalJob {
  readonly tick = jest.fn(() => Promise.resolve());
  readonly other = jest.fn(() => Promise.resolve());
  readonly startup = jest.fn(() => Promise.resolve());
  useStartup = false;

  constructor(env: string) {
    super(
      { get: () => env } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >,
      INTERVAL,
      'Test job',
    );
  }

  protected tasks(): JobTask[] {
    return [
      { name: 'tick', run: this.tick },
      { name: 'other', run: this.other },
    ];
  }

  protected startupTasks(): JobTask[] {
    return this.useStartup
      ? [{ name: 'startup', run: this.startup }]
      : super.startupTasks();
  }

  protected redact(text: string): string {
    return text.replaceAll('secret', '***');
  }
}

describe('IntervalJob', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('starts nothing under NODE_ENV=test', () => {
    const job = new TestJob('test');
    job.onApplicationBootstrap();
    jest.advanceTimersByTime(INTERVAL * 3);
    expect(job.tick).not.toHaveBeenCalled();
  });

  it('runs the tasks at startup and on every tick until shutdown', () => {
    const job = new TestJob('development');
    job.onApplicationBootstrap();
    expect(job.tick).toHaveBeenCalledTimes(1);
    expect(job.other).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(INTERVAL * 2);
    expect(job.tick).toHaveBeenCalledTimes(3);
    job.onApplicationShutdown();
    jest.advanceTimersByTime(INTERVAL * 2);
    expect(job.tick).toHaveBeenCalledTimes(3);
  });

  it('runs the startup tasks once, then only the tick tasks', () => {
    const job = new TestJob('development');
    job.useStartup = true;
    job.onApplicationBootstrap();
    expect(job.startup).toHaveBeenCalledTimes(1);
    expect(job.tick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(INTERVAL);
    expect(job.startup).toHaveBeenCalledTimes(1);
    expect(job.tick).toHaveBeenCalledTimes(1);
    job.onApplicationShutdown();
  });

  it('logs a failed task, redacted and with its stack, and still runs the others', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const job = new TestJob('development');
    job.tick.mockRejectedValueOnce(new Error('boom secret'));
    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(job.other).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    const [message, stack] = log.mock.calls[0] as [string, string];
    expect(message).toBe('Test job "tick" failed: boom ***');
    expect(stack).toContain('boom ***');
    expect(stack).not.toContain('secret');
    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(job.tick).toHaveBeenCalledTimes(2);
    job.onApplicationShutdown();
  });
});
