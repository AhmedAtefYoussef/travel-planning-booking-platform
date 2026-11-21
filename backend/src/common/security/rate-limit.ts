import { SkipThrottle, Throttle } from '@nestjs/throttler';

/**
 * Request rate limits per client IP (ADR-0007). One window of a minute for every limit, so a 429's
 * Retry-After is never more than 60 seconds.
 */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Every route not listed below: generous enough for a person browsing, low enough to stop a script. */
export const DEFAULT_RATE_LIMIT = 120;

/** Login and registration: slows password guessing across many accounts (ACC-05 only locks one). */
export const CREDENTIALS_RATE_LIMIT = 10;

/** Creating or retrying a payment: each call reaches Stripe. */
export const PAYMENTS_RATE_LIMIT = 20;

/**
 * Whether rate limiting is on: RATE_LIMIT_ENABLED when it is set, otherwise everywhere except the test
 * environment (the e2e suites log in many times a minute from one address).
 */
export function isRateLimitEnabled(
  nodeEnv: string | undefined,
  flag: boolean | undefined,
): boolean {
  return flag ?? nodeEnv !== 'test';
}

/** Stricter limit for the login and registration endpoints. */
export const CredentialsRateLimit = (): MethodDecorator & ClassDecorator =>
  Throttle({
    default: { limit: CREDENTIALS_RATE_LIMIT, ttl: RATE_LIMIT_WINDOW_MS },
  });

/** Stricter limit for the endpoints that call Stripe on the user's behalf. */
export const PaymentsRateLimit = (): MethodDecorator & ClassDecorator =>
  Throttle({
    default: { limit: PAYMENTS_RATE_LIMIT, ttl: RATE_LIMIT_WINDOW_MS },
  });

/** No limit: callers that are not users (Stripe's webhook, uptime probes). */
export const NoRateLimit = (): MethodDecorator & ClassDecorator =>
  SkipThrottle();
