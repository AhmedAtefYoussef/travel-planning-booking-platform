/**
 * The `next` query parameter carries the page to return to after login or a session refresh
 * (ACC-10). Only same-site relative paths are accepted, so a crafted link can never redirect a user
 * to another site (open redirect).
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback = '/',
): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }
  try {
    const url = new URL(value, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** `/login?next=/bookings%3Fpage%3D2` style URL for a page that needs a signed-in user. */
export function withNext(path: string, next: string): string {
  return `${path}?${new URLSearchParams({ next: safeNextPath(next) })}`;
}
