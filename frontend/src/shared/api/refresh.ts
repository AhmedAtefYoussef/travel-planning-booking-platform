/**
 * Single-flight session refresh (ACC-06, ACC-19). The access cookie lives 15 minutes; when a request
 * gets 401 the client calls POST /api/auth/refresh once, however many requests failed at the same
 * time, and they all retry after it settles. The refresh cookie is httpOnly and sent only to
 * /api/auth, so JavaScript never sees a token.
 */
let inFlight: Promise<boolean> | null = null;

/** Resolves true when the session was renewed, false when the user must log in again. */
export function refreshSession(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  inFlight ??= (async () => {
    try {
      const res = await fetchImpl('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      // 409 REFRESH_SUPERSEDED: another tab rotated the refresh token a moment ago and the browser
      // already holds its new cookies, so the session is valid; just retry.
      return res.ok || res.status === 409;
    } catch {
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
