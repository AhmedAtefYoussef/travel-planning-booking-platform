import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import type { UserProfile } from '@/lib/api/types';

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  path: '/admin',
  serverFetch: vi.fn(),
}));

vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ has: (name: string) => state.cookies.has(name) }),
  headers: async () => new Headers({ 'x-pathname': state.path }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/api/server', () => ({ serverFetch: state.serverFetch }));

const { getCurrentUser, requireRole, requireUser } = await import('./session');

const user = (over: Partial<UserProfile> = {}): UserProfile => ({
  id: 'u1',
  name: 'Mona',
  email: 'mona@example.com',
  role: 'USER',
  status: 'ACTIVE',
  mustChangePassword: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  state.cookies = new Map([['access_token', 'x']]);
  state.path = '/admin';
  state.serverFetch.mockReset();
});

describe('getCurrentUser (ACC-19)', () => {
  it('asks the API who is signed in', async () => {
    state.serverFetch.mockResolvedValue(user());
    await expect(getCurrentUser()).resolves.toMatchObject({ id: 'u1' });
    expect(state.serverFetch).toHaveBeenCalledWith('/auth/me');
  });

  it('skips the call without an access cookie', async () => {
    state.cookies.clear();
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(state.serverFetch).not.toHaveBeenCalled();
  });

  it('treats expired sessions and suspended accounts as signed out', async () => {
    state.serverFetch.mockRejectedValueOnce(
      new ApiError(401, 'UNAUTHENTICATED', ''),
    );
    await expect(getCurrentUser()).resolves.toBeNull();
    state.serverFetch.mockRejectedValueOnce(
      new ApiError(403, 'ACCOUNT_SUSPENDED', ''),
    );
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('surfaces other failures to the error boundary', async () => {
    state.serverFetch.mockRejectedValueOnce(
      new ApiError(503, 'SERVICE_UNAVAILABLE', ''),
    );
    await expect(getCurrentUser()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('requireUser / requireRole (ACC-11)', () => {
  it('redirects guests through the session refresh page back to this page', async () => {
    state.cookies.clear();
    await expect(requireUser()).rejects.toThrow(
      `REDIRECT:/session/refresh?next=${encodeURIComponent('/admin')}`,
    );
  });

  it('returns the user for an allowed role', async () => {
    state.serverFetch.mockResolvedValue(user({ role: 'ADMIN' }));
    await expect(requireRole(['ADMIN'])).resolves.toMatchObject({
      role: 'ADMIN',
    });
  });

  it('hides sections of other roles behind a 404', async () => {
    state.serverFetch.mockResolvedValue(user({ role: 'USER' }));
    await expect(requireRole(['ADMIN'])).rejects.toThrow('NOT_FOUND');
  });

  it('forces a temporary password to be changed first (ACC-07a, ACC-13)', async () => {
    state.serverFetch.mockResolvedValue(
      user({ role: 'HOTEL_MODERATOR', mustChangePassword: true }),
    );
    await expect(requireRole(['HOTEL_MODERATOR'])).rejects.toThrow(
      'REDIRECT:/account/change-password',
    );
  });
});
