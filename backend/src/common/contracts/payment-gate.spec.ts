import {
  BookingStatus,
  BookingType,
  type PayableSnapshot,
} from './booking.contract';
import { assertPayable } from './payment-gate';
import { policiesVersion } from './policies.contract';

const NOW = new Date('2027-11-01T08:00:00Z');

function snapshot(over: Partial<PayableSnapshot> = {}): PayableSnapshot {
  return {
    bookingType: BookingType.Hotel,
    bookingId: '6af0f0b1c77901aa9f2286f0',
    userId: '6af0f0b1c77901aa9f2286f1',
    status: BookingStatus.PendingPayment,
    amountMinor: 15_000,
    currency: 'USD',
    holdExpiresAt: new Date(NOW.getTime() + 60_000),
    policiesAcceptedAt: new Date(NOW.getTime() - 1_000),
    policiesVersion: '0123456789abcdef',
    reference: null,
    ...over,
  };
}

const outcome = (s: PayableSnapshot, platformCurrency = 'USD') => {
  try {
    assertPayable(s, { now: NOW, platformCurrency });
    return 'payable';
  } catch (e) {
    return (e as { code?: string }).code ?? 'DEFECT';
  }
};

/**
 * PAY-01 calls this gate before creating or retrying a PaymentIntent. Decision table over status,
 * hold time, policy acceptance (PAY-02) and currency (PAY-04): each column is one case.
 */
describe('assertPayable (decision table): PAY-02, PAY-04', () => {
  it.each([
    ['pending, unexpired, accepted, platform currency', snapshot(), 'payable'],
    [
      'policies not accepted yet (PAY-02)',
      snapshot({ policiesAcceptedAt: null }),
      'POLICIES_NOT_ACCEPTED',
    ],
    [
      'timestamp set but no stored terms (data defect)',
      snapshot({ policiesVersion: null }),
      'POLICIES_NOT_ACCEPTED',
    ],
    [
      'hold over: holdExpiresAt equals now (boundary)',
      snapshot({ holdExpiresAt: NOW }),
      'HOLD_EXPIRED',
    ],
    [
      'already expired by the job',
      snapshot({ status: BookingStatus.Expired }),
      'HOLD_EXPIRED',
    ],
    [
      'already confirmed (paid)',
      snapshot({ status: BookingStatus.Confirmed }),
      'INVALID_STATE_TRANSITION',
    ],
    [
      'cancelled',
      snapshot({ status: BookingStatus.Cancelled }),
      'INVALID_STATE_TRANSITION',
    ],
  ])('%s -> %s', (_name, s, expected) => {
    expect(outcome(s)).toBe(expected);
  });

  it('never charges another currency than PLATFORM_CURRENCY or a bad amount: a loud defect (PAY-04)', () => {
    expect(outcome(snapshot({ currency: 'EGP' }), 'USD')).toBe('DEFECT');
    for (const amountMinor of [0, -1, 1.5, Number.NaN]) {
      expect(outcome(snapshot({ amountMinor }))).toBe('DEFECT');
    }
  });

  it('checks the hold before the policies, so an expired hold never asks for acceptance', () => {
    expect(
      outcome(snapshot({ holdExpiresAt: NOW, policiesAcceptedAt: null })),
    ).toBe('HOLD_EXPIRED');
  });
});

describe('policiesVersion (PAY-02)', () => {
  const hotel = {
    hotelId: 'h1',
    hotelName: 'Nile View',
    cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
    checkInTime: '14:00',
    checkOutTime: '12:00',
  };

  it('is stable for the same policies and changes when any term changes', () => {
    const v = policiesVersion({ hotel });
    expect(v).toMatch(/^[0-9a-f]{16}$/);
    expect(policiesVersion({ hotel: { ...hotel } })).toBe(v);
    expect(
      policiesVersion({ hotel: { ...hotel, checkInTime: '15:00' } }),
    ).not.toBe(v);
    expect(
      policiesVersion({
        hotel: {
          ...hotel,
          cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        },
      }),
    ).not.toBe(v);
  });

  it('does not depend on key order', () => {
    const reordered = {
      checkOutTime: '12:00',
      checkInTime: '14:00',
      cancellationTiers: [{ refundPercent: 100, daysBefore: 7 }],
      hotelName: 'Nile View',
      hotelId: 'h1',
    };
    expect(policiesVersion({ hotel: reordered })).toBe(
      policiesVersion({ hotel }),
    );
  });
});
