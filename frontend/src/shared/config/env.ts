import { z } from 'zod';

/**
 * Typed, validated environment. Defaults keep `next build` working with no env file (CI builds
 * without secrets); a value that is present but malformed fails fast instead of surfacing later
 * as a confusing network error.
 */
const serverSchema = z.object({
  BACKEND_URL: z
    .url({ protocol: /^https?$/ })
    .default('http://localhost:3000')
    .transform((url) => url.replace(/\/+$/, '')),
});

const publicSchema = z.object({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_(test|live)_\w+$/, 'must be a Stripe publishable key (pk_...)')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * The API prices everything in one currency (backend PLATFORM_CURRENCY, PAY-04). Used to show
   * room and fare prices before a booking exists; bookings and quotes carry their own `currency`.
   */
  NEXT_PUBLIC_PLATFORM_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO currency code')
    .default('USD')
    .or(z.literal('').transform(() => 'USD')),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

/** Server-only values (never import this from a Client Component). */
export function readServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  return serverSchema.parse({ BACKEND_URL: source.BACKEND_URL || undefined });
}

/**
 * Browser-safe values. NEXT_PUBLIC_* must be read with literal property access so Next.js can
 * inline them at build time.
 */
export const publicEnv: PublicEnv = publicSchema.parse({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_PLATFORM_CURRENCY: process.env.NEXT_PUBLIC_PLATFORM_CURRENCY,
});
