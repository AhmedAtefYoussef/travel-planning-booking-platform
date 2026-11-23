import { describe, expect, it } from 'vitest';
import { isCheckoutKind, KINDS, payPath } from './kinds';

describe('isCheckoutKind', () => {
  it('accepts flight and hotel', () => {
    expect(isCheckoutKind('flight')).toBe(true);
    expect(isCheckoutKind('hotel')).toBe(true);
  });

  it.each(['', 'Flight', 'HOTEL', 'car', 'flights'])('rejects %j', (v) => {
    expect(isCheckoutKind(v)).toBe(false);
  });
});

describe('payPath', () => {
  it('builds the checkout path', () => {
    expect(payPath('flight', 'abc123')).toBe('/checkout/flight/abc123');
  });

  it('encodes the booking id', () => {
    expect(payPath('hotel', 'a/b c?d')).toBe('/checkout/hotel/a%2Fb%20c%3Fd');
  });
});

describe('KINDS', () => {
  it('maps flight to FLIGHT with an e-ticket', () => {
    expect(KINDS.flight.paymentType).toBe('FLIGHT');
    expect(KINDS.flight.policiesType).toBe('flight');
    expect(KINDS.flight.hasETicket).toBe(true);
  });

  it('maps hotel to HOTEL without an e-ticket', () => {
    expect(KINDS.hotel.paymentType).toBe('HOTEL');
    expect(KINDS.hotel.policiesType).toBe('hotel');
    expect(KINDS.hotel.hasETicket).toBe(false);
  });
});
