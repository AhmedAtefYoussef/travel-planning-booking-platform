import { randomBytes } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so a reference read over the phone is not misheard. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 8;
const PREFIX = { FLIGHT: 'FL', HOTEL: 'HT' } as const;

export const BOOKING_REFERENCE_PATTERN = /^(FL|HT)-[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * FLT-23, HTL-17: the booking reference shown on the confirmation and the e-ticket, e.g. FL-7K3M9QX2.
 * 40 random bits (about 10^12 values); uniqueness is still guaranteed by the unique `reference` index,
 * and callers retry on the (very unlikely) duplicate-key error.
 */
export function generateBookingReference(
  type: keyof typeof PREFIX,
  random: (bytes: number) => Buffer = randomBytes,
): string {
  let value = BigInt(`0x${random(5).subarray(0, 5).toString('hex')}`);
  let body = '';
  for (let i = 0; i < LENGTH; i++) {
    body = ALPHABET[Number(value & 31n)] + body;
    value >>= 5n;
  }
  return `${PREFIX[type]}-${body}`;
}
