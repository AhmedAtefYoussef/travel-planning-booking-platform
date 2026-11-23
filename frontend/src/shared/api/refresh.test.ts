import { describe, expect, it, vi } from 'vitest';
import { refreshSession } from './refresh';

const respond = (status: number) => new Response(null, { status });

describe('ACC-19 refreshSession', () => {
  it('posts to /api/auth/refresh with credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200));
    await expect(refreshSession(fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('treats 409 (refresh superseded by another tab) as success', async () => {
    await expect(
      refreshSession(vi.fn().mockResolvedValue(respond(409))),
    ).resolves.toBe(true);
  });

  it('resolves false when the refresh is rejected', async () => {
    await expect(
      refreshSession(vi.fn().mockResolvedValue(respond(401))),
    ).resolves.toBe(false);
  });

  it('resolves false on a network error', async () => {
    await expect(
      refreshSession(vi.fn().mockRejectedValue(new TypeError('offline'))),
    ).resolves.toBe(false);
  });

  it('shares one request between concurrent callers', async () => {
    let resolve!: (r: Response) => void;
    const fetchImpl = vi.fn(
      () => new Promise<Response>((r) => (resolve = r)),
    ) as unknown as typeof fetch;
    const calls = [
      refreshSession(fetchImpl),
      refreshSession(fetchImpl),
      refreshSession(fetchImpl),
    ];
    resolve(respond(200));
    await expect(Promise.all(calls)).resolves.toEqual([true, true, true]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('issues a new request once the previous one has settled', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(respond(200)));
    await refreshSession(fetchImpl);
    await refreshSession(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
