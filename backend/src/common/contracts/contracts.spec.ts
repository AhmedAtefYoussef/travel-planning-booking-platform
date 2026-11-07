import {
  BOOKING_TRANSITIONS,
  BookingStatus,
  canTransition,
  HOLD_DURATION_MS,
} from './booking.contract';
import {
  cancellationTierErrors,
  selectCancellationTier,
} from './policies.contract';
import { computeRefundQuote, RefundReason } from './refunds.contract';

describe('booking lifecycle (GEN-11)', () => {
  it('allows exactly the documented transitions', () => {
    const allowed = Object.entries(BOOKING_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}->${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'CONFIRMED->CANCELLED',
        'CONFIRMED->COMPLETED',
        'PENDING_PAYMENT->CONFIRMED',
        'PENDING_PAYMENT->EXPIRED',
      ].sort(),
    );
  });

  it('rejects everything else', () => {
    expect(
      canTransition(BookingStatus.PendingPayment, BookingStatus.Confirmed),
    ).toBe(true);
    expect(
      canTransition(BookingStatus.PendingPayment, BookingStatus.Cancelled),
    ).toBe(false);
    expect(canTransition(BookingStatus.Expired, BookingStatus.Confirmed)).toBe(
      false,
    );
    expect(
      canTransition(BookingStatus.Cancelled, BookingStatus.Confirmed),
    ).toBe(false);
    expect(
      canTransition(BookingStatus.Completed, BookingStatus.Cancelled),
    ).toBe(false);
  });

  it('holds for 10 minutes (FLT-22, HTL-18)', () => {
    expect(HOLD_DURATION_MS).toBe(600_000);
  });
});

describe('cancellation tiers (FLT-09, HTL-10)', () => {
  const tiers = [
    { daysBefore: 0, refundPercent: 10 },
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
  ];

  it('picks the highest threshold not exceeding the days remaining', () => {
    expect(selectCancellationTier(tiers, 45)?.refundPercent).toBe(100);
    expect(selectCancellationTier(tiers, 30)?.refundPercent).toBe(100);
    expect(selectCancellationTier(tiers, 29)?.refundPercent).toBe(50);
    expect(selectCancellationTier(tiers, 7)?.refundPercent).toBe(50);
    expect(selectCancellationTier(tiers, 0)?.refundPercent).toBe(10);
  });

  it('returns null (0%) when no tier applies', () => {
    expect(
      selectCancellationTier([{ daysBefore: 3, refundPercent: 80 }], 2),
    ).toBeNull();
    expect(selectCancellationTier([], 100)).toBeNull();
  });

  it('validates unique integer thresholds and 0..100 percentages', () => {
    expect(cancellationTierErrors(tiers)).toEqual([]);
    expect(
      cancellationTierErrors([
        { daysBefore: -1, refundPercent: 50 },
        { daysBefore: 1.5, refundPercent: 101 },
        { daysBefore: 7, refundPercent: 10 },
        { daysBefore: 7, refundPercent: 20 },
      ]),
    ).toEqual([
      'tiers[0].daysBefore must be an integer >= 0',
      'tiers[1].daysBefore must be an integer >= 0',
      'tiers[1].refundPercent must be between 0 and 100',
      'tiers[3].daysBefore 7 is duplicated',
    ]);
  });
});

describe('computeRefundQuote (FLT-26, HTL-21, FLT-06)', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const tiers = [
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 30, refundPercent: 100 },
  ];
  const base = { paidMinor: 99_999, currency: 'USD', tiers, now };

  it('applies the tier and rounds down', () => {
    const quote = computeRefundQuote({
      ...base,
      eventStartUtc: new Date('2026-11-20T12:00:00Z'),
      reason: RefundReason.UserCancellation,
    });
    expect(quote).toEqual({
      amountMinor: 49_999,
      currency: 'USD',
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      daysBefore: 12,
    });
  });

  it('refunds 0% when no tier applies', () => {
    const quote = computeRefundQuote({
      ...base,
      eventStartUtc: new Date('2026-11-10T12:00:00Z'),
      reason: RefundReason.UserCancellation,
    });
    expect(quote).toMatchObject({
      amountMinor: 0,
      refundPercent: 0,
      tierApplied: null,
      daysBefore: 2,
    });
  });

  it('blocks user cancellation after departure or check-in', () => {
    expect(() =>
      computeRefundQuote({
        ...base,
        eventStartUtc: now,
        reason: RefundReason.UserCancellation,
      }),
    ).toThrow(/not allowed/);
  });

  it('always refunds 100% for provider cancellations', () => {
    const quote = computeRefundQuote({
      ...base,
      eventStartUtc: new Date('2026-11-09T00:00:00Z'),
      reason: RefundReason.ProviderCancellation,
    });
    expect(quote).toMatchObject({
      amountMinor: 99_999,
      refundPercent: 100,
      tierApplied: null,
    });
  });
});
