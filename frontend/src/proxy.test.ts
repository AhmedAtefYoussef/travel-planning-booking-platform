// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy } from './proxy';

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3001${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe('proxy (ACC-10, ACC-11)', () => {
  it('sends guests on private pages to the session refresh page with a return path', () => {
    const res = proxy(request('/bookings/flights/42?x=1'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/session/refresh');
    expect(location.searchParams.get('next')).toBe('/bookings/flights/42?x=1');
  });

  it('lets signed-in visitors through and passes the path to server layouts', () => {
    const res = proxy(request('/admin', 'access_token=abc'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe('/admin');
  });

  it('never blocks public pages', () => {
    for (const path of ['/', '/flights', '/hotels/1', '/blog', '/login']) {
      expect(proxy(request(path)).headers.get('location')).toBeNull();
    }
  });
});
