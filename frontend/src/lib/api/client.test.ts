import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, apiFetch, refreshSession, setNavigate } from './client';
import { ApiError } from './errors';
import { withQuery } from './url';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();
const navigate = vi.fn<(url: string) => void>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  setNavigate(navigate);
  window.history.replaceState(null, '', '/bookings?tab=past');
});

afterEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  vi.unstubAllGlobals();
});

const urlOf = (call: number) => String(fetchMock.mock.calls[call][0]);

describe('withQuery', () => {
  it('skips empty values and repeats arrays', () => {
    expect(
      withQuery('/flights/search', {
        from: 'CAI',
        page: 2,
        cabinClass: undefined,
        q: '',
        tag: ['a', 'b'],
      }),
    ).toBe('/flights/search?from=CAI&page=2&tag=a&tag=b');
    expect(withQuery('/x', {})).toBe('/x');
  });
});

describe('apiFetch (ACC-19)', () => {
  it('calls the same-origin API with cookies and JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { id: '1' }));
    await expect(api.post('/itineraries', { title: 'Trip' })).resolves.toEqual({
      id: '1',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/itineraries');
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBe('{"title":"Trip"}');
    expect(new Headers(init?.headers).get('content-type')).toBe(
      'application/json',
    );
  });

  it('sends FormData untouched (uploads)', async () => {
    fetchMock.mockResolvedValueOnce(json(201, {}));
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.png');
    await api.post('/posts/1/images', form);
    const init = fetchMock.mock.calls[0][1];
    expect(init?.body).toBe(form);
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.delete('/posts/1/like')).resolves.toBeUndefined();
  });

  it('turns API errors into ApiError with grouped field errors (GEN-02)', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fieldErrors: [
          { field: 'passengers[0].dateOfBirth', message: 'must be a date' },
          { field: 'passengers[0].dateOfBirth', message: 'is required' },
        ],
      }),
    );
    const error = (await api
      .post('/flight-bookings/hold', {})
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors['passengers[0].dateOfBirth']).toEqual([
      'must be a date',
      'is required',
    ]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.get('/hotels/1')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });
});

describe('session refresh on 401', () => {
  it('refreshes once and replays the request', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }))
      .mockResolvedValueOnce(json(200, { user: {} }))
      .mockResolvedValueOnce(json(200, { items: [] }));
    await expect(api.get('/flight-bookings')).resolves.toEqual({ items: [] });
    expect(urlOf(1)).toBe('/api/auth/refresh');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
    expect(urlOf(2)).toBe('/api/flight-bookings');
  });

  it('shares one refresh between parallel requests (single flight)', async () => {
    let finishRefresh: (r: Response) => void = () => {};
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/auth/refresh') {
        return new Promise<Response>((resolve) => (finishRefresh = resolve));
      }
      const calls = fetchMock.mock.calls.filter((c) => String(c[0]) === url);
      return Promise.resolve(
        calls.length === 1
          ? json(401, { code: 'UNAUTHENTICATED' })
          : json(200, { url }),
      );
    });
    const both = Promise.all([api.get('/a'), api.get('/b')]);
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          (c) => String(c[0]) === '/api/auth/refresh',
        ),
      ).toHaveLength(1),
    );
    finishRefresh(json(200, {}));
    await expect(both).resolves.toEqual([{ url: '/api/a' }, { url: '/api/b' }]);
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/auth/refresh'),
    ).toHaveLength(1);
  });

  it('treats 409 REFRESH_SUPERSEDED as refreshed (another tab won)', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { code: 'REFRESH_SUPERSEDED' }));
    await expect(refreshSession()).resolves.toBe(true);
  });

  it('sends the user to login with the current page when refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }))
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }));
    await expect(api.get('/flight-bookings')).rejects.toMatchObject({
      status: 401,
    });
    expect(navigate).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent('/bookings?tab=past')}`,
    );
  });

  it("does not redirect with auth: 'silent'", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(401, {}));
    await expect(
      apiFetch('/auth/me', { auth: 'silent' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('never tries to refresh for the login call itself', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      }),
    );
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends accounts with a temporary password to change it (ACC-07a)', async () => {
    fetchMock.mockResolvedValueOnce(
      json(403, { code: 'PASSWORD_CHANGE_REQUIRED' }),
    );
    await expect(api.get('/flight-bookings')).rejects.toBeInstanceOf(ApiError);
    expect(navigate).toHaveBeenCalledWith('/account/change-password');
  });
});
