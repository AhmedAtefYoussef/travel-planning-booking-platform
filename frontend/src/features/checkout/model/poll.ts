/**
 * Polls until `done` holds or the deadline passes. Used after Stripe accepts the card: the booking
 * turns CONFIRMED only when the backend has verified the payment through Stripe's webhook (PAY-01),
 * which usually takes a second or two. Backs off from 1 s to 5 s so a slow webhook costs few requests.
 */
export async function pollUntil<T>(
  load: () => Promise<T>,
  done: (value: T) => boolean,
  {
    timeoutMs = 60_000,
    delays = [1000, 1000, 2000, 3000, 5000],
    signal,
    sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  }: {
    timeoutMs?: number;
    delays?: readonly number[];
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<
  { value: T; timedOut: false } | { value: T | undefined; timedOut: true }
> {
  const start = now();
  let last: T | undefined;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted)
      throw new DOMException('Polling aborted', 'AbortError');
    last = await load();
    if (done(last)) return { value: last, timedOut: false };
    const delay = delays[Math.min(attempt, delays.length - 1)];
    if (now() - start + delay > timeoutMs)
      return { value: last, timedOut: true };
    await sleep(delay);
  }
}
