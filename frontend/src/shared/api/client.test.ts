import type { Middleware } from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { refreshOn401, unwrap } from './client';
import { isApiError } from './errors';

type ReqCtx = Parameters<NonNullable<Middleware['onRequest']>>[0];
type RespCtx = Parameters<NonNullable<Middleware['onResponse']>>[0];

async function run(
  middleware: Middleware,
  request: Request,
  response: Response,
): Promise<Response | undefined> {
  await middleware.onRequest!({ request } as unknown as ReqCtx);
  return (await middleware.onResponse!({
    request,
    response,
  } as unknown as RespCtx)) as Response | undefined;
}

const make = (path: string, init?: RequestInit) =>
  new Request(`http://localhost:3001${path}`, init);

describe('ACC-19 refreshOn401', () => {
  it('refreshes once and replays the cloned request on 401', async () => {
    const replayed = new Response('ok', { status: 200 });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      input instanceof Request ? replayed : new Response(null, { status: 200 }),
    );
    const mw = refreshOn401(fetchImpl as unknown as typeof fetch);
    const request = make('/api/bookings', { method: 'POST', body: '{"a":1}' });

    const result = await run(mw, request, new Response(null, { status: 401 }));

    expect(result).toBe(replayed);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/auth/refresh');
    const replay = fetchImpl.mock.calls[1][0] as unknown as Request;
    expect(replay).not.toBe(request);
    expect(replay.url).toBe(request.url);
    expect(await replay.text()).toBe('{"a":1}');
  });

  it('passes non-401 responses through without refreshing', async () => {
    const fetchImpl = vi.fn();
    const response = new Response(null, { status: 500 });
    const result = await run(
      refreshOn401(fetchImpl),
      make('/api/bookings'),
      response,
    );
    expect(result).toBe(response);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['login', 'refresh', 'logout', 'register'])(
    'never replays /api/auth/%s',
    async (name) => {
      const fetchImpl = vi.fn();
      const response = new Response(null, { status: 401 });
      const result = await run(
        refreshOn401(fetchImpl),
        make(`/api/auth/${name}`, { method: 'POST' }),
        response,
      );
      expect(result).toBe(response);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('returns the original 401 when the refresh fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const response = new Response(null, { status: 401 });
    const result = await run(
      refreshOn401(fetchImpl as unknown as typeof fetch),
      make('/api/bookings'),
      response,
    );
    expect(result).toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the refresh call, no replay
  });

  it('does not refresh for a request it never saw', async () => {
    const fetchImpl = vi.fn();
    const response = new Response(null, { status: 401 });
    const result = await refreshOn401(fetchImpl).onResponse!({
      request: make('/api/x'),
      response,
    } as unknown as RespCtx);
    expect(result).toBe(response);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GEN-02 unwrap', () => {
  it('returns data for an ok response', async () => {
    const data = await unwrap(
      Promise.resolve({
        data: { id: 1 },
        response: new Response(null, { status: 200 }),
      }),
    );
    expect(data).toEqual({ id: 1 });
  });

  it('throws an ApiError with code and fieldErrors from the body', async () => {
    const error = {
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      fieldErrors: [{ field: 'email', message: 'Invalid email' }],
    };
    const err = await unwrap(
      Promise.resolve({ error, response: new Response(null, { status: 400 }) }),
    ).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      fieldErrors: { email: 'Invalid email' },
    });
  });

  it('throws UNKNOWN for a failed response without an error body', async () => {
    const err = await unwrap(
      Promise.resolve({ response: new Response(null, { status: 502 }) }),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('maps a thrown fetch to NETWORK_ERROR', async () => {
    const err = await unwrap(
      Promise.reject(new TypeError('Failed to fetch')),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
