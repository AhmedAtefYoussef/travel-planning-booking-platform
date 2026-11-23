import { describe, expect, it } from 'vitest';
import {
  checkoutReducer,
  countdownAnnouncement,
  formatCountdown,
  initialStep,
  pollOutcome,
  secondsLeft,
  type CheckoutEvent,
  type CheckoutStep,
} from './flow';

const base = { policiesAccepted: false, holdExpired: false };

describe('initialStep', () => {
  it.each(['CONFIRMED', 'COMPLETED'] as const)(
    '%s with a reference is confirmed',
    (status) => {
      expect(initialStep({ ...base, status, reference: 'BK-1' })).toEqual({
        name: 'confirmed',
        reference: 'BK-1',
      });
    },
  );

  it.each(['CONFIRMED', 'COMPLETED'] as const)(
    '%s without a reference keeps confirming',
    (status) => {
      expect(initialStep({ ...base, status })).toEqual({ name: 'confirming' });
      expect(initialStep({ ...base, status, reference: null })).toEqual({
        name: 'confirming',
      });
    },
  );

  it('EXPIRED is expired', () => {
    expect(initialStep({ ...base, status: 'EXPIRED' })).toEqual({
      name: 'expired',
    });
  });

  it('CANCELLED is unavailable', () => {
    expect(initialStep({ ...base, status: 'CANCELLED' })).toEqual({
      name: 'unavailable',
      status: 'CANCELLED',
    });
  });

  it('PENDING_PAYMENT with an expired hold is expired', () => {
    expect(
      initialStep({
        status: 'PENDING_PAYMENT',
        policiesAccepted: true,
        holdExpired: true,
      }),
    ).toEqual({ name: 'expired' });
  });

  it('PENDING_PAYMENT resumes at payment once policies are accepted', () => {
    expect(
      initialStep({
        status: 'PENDING_PAYMENT',
        policiesAccepted: true,
        holdExpired: false,
      }),
    ).toEqual({ name: 'payment' });
  });

  it('PENDING_PAYMENT starts at policies otherwise', () => {
    expect(initialStep({ ...base, status: 'PENDING_PAYMENT' })).toEqual({
      name: 'policies',
    });
  });
});

const events: CheckoutEvent[] = [
  { type: 'POLICIES_ACCEPTED' },
  { type: 'PAYMENT_STARTED' },
  { type: 'PAYMENT_SUBMITTED' },
  { type: 'PAYMENT_FAILED', message: 'declined' },
  { type: 'CONFIRMATION_TIMED_OUT' },
  { type: 'CHECK_AGAIN' },
  { type: 'BOOKING_CONFIRMED', reference: 'BK-9' },
  { type: 'BOOKING_ENDED', status: 'EXPIRED' },
  { type: 'HOLD_EXPIRED' },
];

describe('checkoutReducer', () => {
  it('policies -> payment on POLICIES_ACCEPTED', () => {
    expect(
      checkoutReducer({ name: 'policies' }, { type: 'POLICIES_ACCEPTED' }),
    ).toEqual({ name: 'payment' });
  });

  it('policies ignores payment events', () => {
    const step: CheckoutStep = { name: 'policies' };
    expect(checkoutReducer(step, { type: 'PAYMENT_SUBMITTED' })).toBe(step);
    expect(
      checkoutReducer(step, { type: 'PAYMENT_FAILED', message: 'x' }),
    ).toBe(step);
  });

  it('payment -> confirming on PAYMENT_SUBMITTED', () => {
    expect(
      checkoutReducer({ name: 'payment' }, { type: 'PAYMENT_SUBMITTED' }),
    ).toEqual({ name: 'confirming' });
  });

  it('PAYMENT_FAILED keeps payment with the error', () => {
    expect(
      checkoutReducer(
        { name: 'payment' },
        { type: 'PAYMENT_FAILED', message: 'Card declined' },
      ),
    ).toEqual({ name: 'payment', error: 'Card declined' });
  });

  it('payment ignores POLICIES_ACCEPTED', () => {
    const step: CheckoutStep = { name: 'payment' };
    expect(checkoutReducer(step, { type: 'POLICIES_ACCEPTED' })).toBe(step);
  });

  it('confirming never goes back to the card form: a charged card is not offered again', () => {
    expect(
      checkoutReducer(
        { name: 'confirming' },
        { type: 'PAYMENT_FAILED', message: 'Timed out' },
      ),
    ).toEqual({ name: 'confirming' });
  });

  it('confirming + CONFIRMATION_TIMED_OUT -> pending, and CHECK_AGAIN polls again', () => {
    const pending = checkoutReducer(
      { name: 'confirming' },
      { type: 'CONFIRMATION_TIMED_OUT' },
    );
    expect(pending).toEqual({ name: 'pending' });
    expect(checkoutReducer(pending, { type: 'CHECK_AGAIN' })).toEqual({
      name: 'confirming',
    });
  });

  it('PAYMENT_STARTED locks the payment step and clears the last error', () => {
    expect(
      checkoutReducer(
        { name: 'payment', error: 'Declined' },
        { type: 'PAYMENT_STARTED' },
      ),
    ).toEqual({ name: 'payment', paying: true });
  });

  it('ignores HOLD_EXPIRED while the card is with Stripe or the payment is pending', () => {
    const paying = { name: 'payment', paying: true } as const;
    expect(checkoutReducer(paying, { type: 'HOLD_EXPIRED' })).toBe(paying);
    const pending = { name: 'pending' } as const;
    expect(checkoutReducer(pending, { type: 'HOLD_EXPIRED' })).toBe(pending);
  });

  it('a failed payment after the hold ran out -> expired', () => {
    expect(
      checkoutReducer(
        { name: 'payment', paying: true },
        { type: 'PAYMENT_FAILED', message: 'Declined', holdExpired: true },
      ),
    ).toEqual({ name: 'expired' });
  });

  it('BOOKING_ENDED -> expired or unavailable, but never undoes a confirmation', () => {
    expect(
      checkoutReducer(
        { name: 'confirming' },
        { type: 'BOOKING_ENDED', status: 'EXPIRED' },
      ),
    ).toEqual({ name: 'expired' });
    expect(
      checkoutReducer(
        { name: 'pending' },
        { type: 'BOOKING_ENDED', status: 'CANCELLED' },
      ),
    ).toEqual({ name: 'unavailable', status: 'CANCELLED' });
    const confirmed = { name: 'confirmed', reference: 'FL-1' } as const;
    expect(
      checkoutReducer(confirmed, { type: 'BOOKING_ENDED', status: 'EXPIRED' }),
    ).toBe(confirmed);
  });
});

describe('pollOutcome', () => {
  it('confirms only with a reference, for CONFIRMED and COMPLETED', () => {
    expect(pollOutcome({ status: 'CONFIRMED', reference: 'FL-1' })).toEqual({
      type: 'BOOKING_CONFIRMED',
      reference: 'FL-1',
    });
    expect(pollOutcome({ status: 'COMPLETED', reference: 'HT-1' })).toEqual({
      type: 'BOOKING_CONFIRMED',
      reference: 'HT-1',
    });
    expect(pollOutcome({ status: 'CONFIRMED', reference: null })).toBeNull();
  });

  it('stops on EXPIRED and CANCELLED, keeps polling on PENDING_PAYMENT', () => {
    expect(pollOutcome({ status: 'EXPIRED' })).toEqual({
      type: 'BOOKING_ENDED',
      status: 'EXPIRED',
    });
    expect(pollOutcome({ status: 'CANCELLED' })).toEqual({
      type: 'BOOKING_ENDED',
      status: 'CANCELLED',
    });
    expect(pollOutcome({ status: 'PENDING_PAYMENT' })).toBeNull();
  });
});

describe('countdownAnnouncement', () => {
  it('changes only at the 5, 2 and 1 minute thresholds and at expiry', () => {
    expect(countdownAnnouncement(301)).toBe('');
    expect(countdownAnnouncement(300)).toBe('Less than 5 minutes left to pay.');
    expect(countdownAnnouncement(121)).toBe('Less than 5 minutes left to pay.');
    expect(countdownAnnouncement(120)).toBe('Less than 2 minutes left to pay.');
    expect(countdownAnnouncement(60)).toBe('Less than 1 minute left to pay.');
    expect(countdownAnnouncement(0)).toBe('The hold has expired.');
  });
});

describe('checkoutReducer (terminal and in-flight steps)', () => {
  it('confirming ignores other events', () => {
    const step: CheckoutStep = { name: 'confirming' };
    expect(checkoutReducer(step, { type: 'POLICIES_ACCEPTED' })).toBe(step);
    expect(checkoutReducer(step, { type: 'PAYMENT_SUBMITTED' })).toBe(step);
  });

  it.each<CheckoutStep>([
    { name: 'policies' },
    { name: 'payment' },
    { name: 'payment', error: 'bad' },
    { name: 'confirming' },
    { name: 'expired' },
    { name: 'unavailable', status: 'CANCELLED' },
  ])('BOOKING_CONFIRMED confirms from $name', (step) => {
    expect(
      checkoutReducer(step, { type: 'BOOKING_CONFIRMED', reference: 'BK-2' }),
    ).toEqual({ name: 'confirmed', reference: 'BK-2' });
  });

  it('confirmed never changes on any event', () => {
    const step: CheckoutStep = { name: 'confirmed', reference: 'BK-1' };
    for (const event of events) {
      expect(checkoutReducer(step, event)).toBe(step);
    }
  });

  it.each<CheckoutStep>([
    { name: 'policies' },
    { name: 'payment' },
    { name: 'expired' },
  ])('HOLD_EXPIRED expires from $name', (step) => {
    expect(checkoutReducer(step, { type: 'HOLD_EXPIRED' })).toEqual({
      name: 'expired',
    });
  });

  it('HOLD_EXPIRED does not interrupt confirming', () => {
    const step: CheckoutStep = { name: 'confirming' };
    expect(checkoutReducer(step, { type: 'HOLD_EXPIRED' })).toBe(step);
  });
});

describe('secondsLeft', () => {
  const at = '2026-01-01T00:10:00.000Z';
  const start = Date.parse('2026-01-01T00:00:00.000Z');

  it('returns whole seconds', () => {
    expect(secondsLeft(at, start)).toBe(600);
  });

  it('floors partial seconds', () => {
    expect(secondsLeft(at, start + 1500)).toBe(598);
    expect(secondsLeft(at, start + 999)).toBe(599);
  });

  it('is never negative', () => {
    expect(secondsLeft(at, Date.parse(at) + 5000)).toBe(0);
    expect(secondsLeft(at, Date.parse(at))).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('formats m:ss', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(600)).toBe('10:00');
  });
});
