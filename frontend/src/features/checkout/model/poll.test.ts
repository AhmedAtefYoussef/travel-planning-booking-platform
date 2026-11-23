import { describe, expect, it, vi } from 'vitest';
import { pollUntil } from './poll';

function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
  };
}

describe('pollUntil', () => {
  it('resolves on the first done value without sleeping', async () => {
    const clock = fakeClock();
    const load = vi.fn().mockResolvedValue('ok');
    const result = await pollUntil(load, (v) => v === 'ok', clock);
    expect(result).toEqual({ value: 'ok', timedOut: false });
    expect(load).toHaveBeenCalledTimes(1);
    expect(clock.slept).toEqual([]);
  });

  it('uses delays in order and repeats the last one', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil(
      async () => ++calls,
      (n) => n === 6,
      { ...clock, delays: [10, 20, 30], timeoutMs: 10_000 },
    );
    expect(result).toEqual({ value: 6, timedOut: false });
    expect(clock.slept).toEqual([10, 20, 30, 30, 30]);
  });

  it('times out with the last value when the next delay would exceed the timeout', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil(
      async () => ++calls,
      () => false,
      { ...clock, delays: [100], timeoutMs: 250 },
    );
    // elapsed 0 -> sleep 100, 100 -> sleep 100, 200 + 100 > 250 -> stop
    expect(clock.slept).toEqual([100, 100]);
    expect(result).toEqual({ value: 3, timedOut: true });
  });

  it('throws AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const load = vi.fn().mockResolvedValue(1);
    const clock = fakeClock();
    await expect(
      pollUntil(load, () => true, { ...clock, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).not.toHaveBeenCalled();
  });

  it('throws AbortError when aborted between attempts', async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    const load = vi.fn().mockResolvedValue(0);
    const sleep = async (ms: number) => {
      await clock.sleep(ms);
      controller.abort();
    };
    await expect(
      pollUntil(load, () => false, {
        now: clock.now,
        sleep,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
