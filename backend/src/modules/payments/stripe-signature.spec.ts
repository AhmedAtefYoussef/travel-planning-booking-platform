import { createHmac } from 'node:crypto';
import {
  signStripePayload,
  STRIPE_SIGNATURE_TOLERANCE_S,
  verifyStripeSignature,
} from './stripe-signature';

const SECRET = 'whsec_placeholder';
const BODY = Buffer.from('{"id":"evt_1","type":"payment_intent.succeeded"}');
const NOW = new Date('2027-11-01T08:00:00Z');
const T = Math.floor(NOW.getTime() / 1000);

/** The exact scheme Stripe documents: v1 = HMAC-SHA256(secret, `${t}.${payload}`). */
const stripeHeader = (t: number, body: Buffer, secret = SECRET) =>
  `t=${t},v1=${createHmac('sha256', secret)
    .update(`${t}.${body.toString('utf8')}`)
    .digest('hex')}`;

describe('verifyStripeSignature (PAY-01, ADR-0003)', () => {
  it('accepts a payload signed with the webhook secret', () => {
    expect(
      verifyStripeSignature(BODY, stripeHeader(T, BODY), SECRET, NOW),
    ).toBe(true);
  });

  it('accepts when any v1 signature matches (Stripe sends several while rotating secrets)', () => {
    const header = `t=${T},v1=${'0'.repeat(64)},${stripeHeader(T, BODY).split(',')[1]}`;
    expect(verifyStripeSignature(BODY, header, SECRET, NOW)).toBe(true);
  });

  it.each([
    [
      'a body changed after signing',
      stripeHeader(T, BODY),
      Buffer.from(`${BODY.toString()} `),
    ],
    ['another secret', stripeHeader(T, BODY, 'whsec_other'), BODY],
    ['no header', '', BODY],
    ['no timestamp', `v1=${'a'.repeat(64)}`, BODY],
    ['a malformed signature', `t=${T},v1=zz`, BODY],
    ['a v0 signature only', `t=${T},v0=${'a'.repeat(64)}`, BODY],
  ])('rejects %s', (_name, header, body) => {
    expect(verifyStripeSignature(body, header, SECRET, NOW)).toBe(false);
  });

  it('rejects a timestamp outside the 5-minute tolerance (replay of an old capture), at the boundary', () => {
    const edge = T - STRIPE_SIGNATURE_TOLERANCE_S;
    expect(
      verifyStripeSignature(BODY, stripeHeader(edge, BODY), SECRET, NOW),
    ).toBe(true);
    expect(
      verifyStripeSignature(BODY, stripeHeader(edge - 1, BODY), SECRET, NOW),
    ).toBe(false);
    expect(
      verifyStripeSignature(BODY, stripeHeader(T + 400, BODY), SECRET, NOW),
    ).toBe(false);
  });

  it('signStripePayload produces a header the verifier accepts (used by tests and local tools)', () => {
    expect(
      verifyStripeSignature(
        BODY,
        signStripePayload(BODY, SECRET, NOW),
        SECRET,
        NOW,
      ),
    ).toBe(true);
  });
});
