// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';

const COOKIE = 'access_token=abc';

function req(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3001${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function stubMe(user: Record<string, unknown> | number | Error) {
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >(async () => {
    if (user instanceof Error) throw user;
    if (typeof user === 'number') return new Response(null, { status: user });
    return Response.json(user);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const isNext = (res: Response) => res.headers.get('x-middleware-next') === '1';
const locationOf = (res: Response) => new URL(res.headers.get('location')!);

afterEach(() => vi.unstubAllGlobals());

describe('ACC-10 proxy authentication', () => {
  it('lets public paths through without calling the API', async () => {
    const fetchMock = stubMe({ role: 'USER' });
    const res = await proxy(req('/flights'));
    expect(isNext(res)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects a protected path without an access cookie to the refresh page', async () => {
    const fetchMock = stubMe({ role: 'USER' });
    const res = await proxy(req('/bookings'));
    expect(res.status).toBe(307);
    const location = locationOf(res);
    expect(location.pathname + location.search).toBe(
      '/session/refresh?next=%2Fbookings',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects to the refresh page when /me answers 401', async () => {
    stubMe(401);
    const res = await proxy(req('/bookings', COOKIE));
    expect(res.status).toBe(307);
    const location = locationOf(res);
    expect(location.pathname + location.search).toBe(
      '/session/refresh?next=%2Fbookings',
    );
  });

  it('lets the page render its own error when /me answers 500', async () => {
    stubMe(500);
    expect(isNext(await proxy(req('/bookings', COOKIE)))).toBe(true);
  });

  it('lets the page render its own error when fetch throws', async () => {
    stubMe(new TypeError('connection refused'));
    expect(isNext(await proxy(req('/bookings', COOKIE)))).toBe(true);
  });

  it('asks /me at the default BACKEND_URL with the cookie forwarded', async () => {
    const fetchMock = stubMe({ role: 'USER', mustChangePassword: false });
    await proxy(req('/bookings', COOKIE));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/auth/me');
    expect((init.headers as Record<string, string>).cookie).toBe(COOKIE);
  });
});

describe('ACC-11 proxy authorisation', () => {
  it('answers 404 through a rewrite when a USER opens /admin', async () => {
    stubMe({ role: 'USER', mustChangePassword: false });
    const res = await proxy(req('/admin', COOKIE));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-middleware-rewrite')).toContain(
      '/_forbidden-section',
    );
  });

  it('lets an ADMIN open /admin', async () => {
    stubMe({ role: 'ADMIN', mustChangePassword: false });
    expect(isNext(await proxy(req('/admin', COOKIE)))).toBe(true);
  });
});

describe('ACC-07a proxy forced password change', () => {
  it('redirects to the change-password page from other protected paths', async () => {
    stubMe({ role: 'USER', mustChangePassword: true });
    const res = await proxy(req('/bookings', COOKIE));
    expect(res.status).toBe(307);
    expect(locationOf(res).pathname).toBe('/account/change-password');
  });

  it('lets the change-password page itself render', async () => {
    stubMe({ role: 'USER', mustChangePassword: true });
    expect(isNext(await proxy(req('/account/change-password', COOKIE)))).toBe(
      true,
    );
  });
});
