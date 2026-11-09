/**
 * Dependency-injection tokens for the cross-module contracts (plan
 * "Cross-module contracts"). Consumers inject by token and the interface,
 * never by the concrete class, so a stub can be swapped for the real
 * provider without touching callers:
 *
 *   constructor(@Inject(PAYABLE_BOOKING) private readonly bookings: PayableBooking) {}
 *
 * The owning module re-binds the token with `{ provide: TOKEN, useExisting: RealService }`.
 */
export const PAYABLE_BOOKING = 'PAYABLE_BOOKING';
export const POLICIES_PROVIDER = 'POLICIES_PROVIDER';
export const NOTIFICATIONS_SERVICE = 'NOTIFICATIONS_SERVICE';
export const PAYMENTS_SERVICE = 'PAYMENTS_SERVICE';
export const REFUNDS_SERVICE = 'REFUNDS_SERVICE';
export const CURRENCY_SERVICE = 'CURRENCY_SERVICE';
export const AUDIT_SERVICE = 'AUDIT_SERVICE';
export const UPLOADS_SERVICE = 'UPLOADS_SERVICE';
export const HOTEL_RESERVATIONS = 'HOTEL_RESERVATIONS';
