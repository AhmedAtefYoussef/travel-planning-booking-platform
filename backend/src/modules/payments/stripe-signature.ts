import { createHmac, timingSafeEqual } from 'node:crypto';

/** Stripe's default: a signed event older (or newer) than 5 minutes is refused, so old captures can't be replayed. */
export const STRIPE_SIGNATURE_TOLERANCE_S = 300;

/**
 * Verifies a `Stripe-Signature` header (ADR-0003) the way Stripe documents it:
 * `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>[,v1=...]`. Any v1 may match
 * (Stripe sends several while a secret is rotated). The comparison is constant-time, and the body must
 * be the exact bytes received, so `rawBody` is used, never re-serialised JSON.
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  now: Date = new Date(),
  toleranceS: number = STRIPE_SIGNATURE_TOLERANCE_S,
): boolean {
  if (!header) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > toleranceS) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  return signatures.some((s) =>
    timingSafeEqual(Buffer.from(s, 'hex'), expected),
  );
}

/** A valid header for `rawBody` (e2e tests and local tooling; Stripe signs real events itself). */
export function signStripePayload(
  rawBody: Buffer,
  secret: string,
  now: Date = new Date(),
): string {
  const t = Math.floor(now.getTime() / 1000);
  const v1 = createHmac('sha256', secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}
