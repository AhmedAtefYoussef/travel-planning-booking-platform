import type { CookieOptions, Response } from 'express';
import { AUTH_COOKIE } from '../swagger/swagger.setup';
import { AuthUser, MODERATOR_PROVIDER, ProviderType, Role } from './auth.types';

/**
 * ACC-19: tokens live only in httpOnly cookies, never in a response body, so browser JavaScript can
 * never read them (no localStorage/sessionStorage). The access cookie is sent on every path so the
 * Next.js frontend can render private pages on the server (brief section 9, ADR-0001 amendment);
 * the refresh cookie is sent only to /api/auth.
 */
export const ACCESS_COOKIE = AUTH_COOKIE;
export const REFRESH_COOKIE = 'refresh_token';
export const ACCESS_COOKIE_PATH = '/';
export const REFRESH_COOKIE_PATH = '/api/auth';
/**
 * Milestone 1 issued the access cookie on /api. A browser holding both copies would send the
 * more specific (stale) one first on /api requests, so every write also expires the old copy.
 */
export const LEGACY_ACCESS_COOKIE_PATH = '/api';

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "15m", "7d", "900s" -> milliseconds. The format is validated at startup (env.validation.ts). */
export function durationToMs(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
  if (!match) throw new Error(`Invalid duration "${duration}"`);
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}

/**
 * httpOnly + SameSite=Lax always; Secure from COOKIE_SECURE (true behind HTTPS, required in
 * production by env validation; false only for local http://localhost).
 */
export function authCookieOptions(
  secure: boolean,
  path: string,
  maxAgeMs: number,
): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path, maxAge: maxAgeMs };
}

/** Options for clearing a cookie: must repeat the same name, path and flags it was set with. */
export function clearCookieOptions(
  secure: boolean,
  path: string,
): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path };
}

/** The token pair written by login and refresh. */
export interface AuthCookieTokens {
  accessToken: string;
  refreshToken: string;
  accessTtlMs: number;
  refreshTtlMs: number;
}

/** ACC-19: writes both cookies and expires the legacy /api access cookie. */
export function setAuthCookies(
  res: Response,
  secure: boolean,
  tokens: AuthCookieTokens,
): void {
  res.cookie(
    ACCESS_COOKIE,
    tokens.accessToken,
    authCookieOptions(secure, ACCESS_COOKIE_PATH, tokens.accessTtlMs),
  );
  res.cookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    authCookieOptions(secure, REFRESH_COOKIE_PATH, tokens.refreshTtlMs),
  );
  clearLegacyAccessCookie(res, secure);
}

/** ACC-06: clears both cookies (and the legacy copy) with the same paths and flags they were set with. */
export function clearAuthCookies(res: Response, secure: boolean): void {
  res.clearCookie(
    ACCESS_COOKIE,
    clearCookieOptions(secure, ACCESS_COOKIE_PATH),
  );
  res.clearCookie(
    REFRESH_COOKIE,
    clearCookieOptions(secure, REFRESH_COOKIE_PATH),
  );
  clearLegacyAccessCookie(res, secure);
}

function clearLegacyAccessCookie(res: Response, secure: boolean): void {
  res.clearCookie(
    ACCESS_COOKIE,
    clearCookieOptions(secure, LEGACY_ACCESS_COOKIE_PATH),
  );
}

/** Claims inside the signed access token (HS256, JWT_SECRET, JWT_ACCESS_TTL). */
export interface AccessTokenClaims {
  /** user id */
  sub: string;
  /** session id, so logout and idle expiry (ACC-06) can end this exact login */
  sid: string;
  role: Role;
  /** moderators only: the one provider they manage */
  prov?: { type: ProviderType; id: string };
}

export function claimsFor(
  user: AuthUser,
  sessionId: string,
): AccessTokenClaims {
  return {
    sub: user.id,
    sid: sessionId,
    role: user.role,
    ...(user.assignedProvider
      ? {
          prov: {
            type: user.assignedProvider.type,
            id: user.assignedProvider.providerId,
          },
        }
      : {}),
  };
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Rebuilds the AuthUser contract from verified claims; null when the claims are malformed. */
export function authUserFromClaims(claims: unknown): AuthUser | null {
  const c = claims as Partial<AccessTokenClaims> | null;
  if (!c || typeof c.sub !== 'string' || !OBJECT_ID.test(c.sub)) return null;
  if (typeof c.sid !== 'string' || !OBJECT_ID.test(c.sid)) return null;
  if (!Object.values(Role).includes(c.role as Role)) return null;
  const role = c.role as Role;
  const expected = MODERATOR_PROVIDER[role];
  if (!expected) return c.prov ? null : { id: c.sub, role };
  if (c.prov?.type !== expected || !OBJECT_ID.test(c.prov.id)) return null;
  return {
    id: c.sub,
    role,
    assignedProvider: { type: expected, providerId: c.prov.id },
  };
}
