/**
 * Injection tokens for cross-module contracts (TRVL-132). Modules depend on these tokens and the
 * interfaces next to them, never on each other's services or schemas (enforced by dependency-cruiser).
 *
 * Provider (owner)                 ->  consumers
 *   FLIGHT_PAYABLE_BOOKING (Karim)  ->  payments
 *   HOTEL_PAYABLE_BOOKING (Karim)   ->  payments
 *   REFUNDS_SERVICE (Ahmed)         ->  flight/hotel cancellations, FLT-06
 *   FLIGHTS_SEARCH (Joudy)          ->  itineraries (ITN-26)
 *   HOTELS_SEARCH (Sandra)          ->  itineraries (ITN-25)
 *   CURRENCY_SERVICE (Ahmed)        ->  budgets (ITN-18)
 *   REFERENCE_SERVICE (Joudy)       ->  all
 *   AUDIT_SERVICE (Ahmed)           ->  admin, moderation
 *   NOTIFICATIONS_SERVICE (Karim)   ->  bookings, payments, admin, flights
 *   FLIGHT_BOOKINGS_LOOKUP (Karim)  ->  flights (FLT-05 schedule-change notifications)
 *   UPLOADS_SERVICE (Ahmed)         ->  blog, itineraries, hotels, airlines
 *
 * Usage:  constructor(@Inject(AUDIT_SERVICE) private readonly audit: AuditService) {}
 * The providing module exports `{ provide: AUDIT_SERVICE, useExisting: AuditLogService }`.
 */
export const FLIGHT_PAYABLE_BOOKING = Symbol('FLIGHT_PAYABLE_BOOKING');
export const HOTEL_PAYABLE_BOOKING = Symbol('HOTEL_PAYABLE_BOOKING');
export const REFUNDS_SERVICE = Symbol('REFUNDS_SERVICE');
export const FLIGHTS_SEARCH = Symbol('FLIGHTS_SEARCH');
export const HOTELS_SEARCH = Symbol('HOTELS_SEARCH');
export const CURRENCY_SERVICE = Symbol('CURRENCY_SERVICE');
export const REFERENCE_SERVICE = Symbol('REFERENCE_SERVICE');
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');
export const NOTIFICATIONS_SERVICE = Symbol('NOTIFICATIONS_SERVICE');
export const UPLOADS_SERVICE = Symbol('UPLOADS_SERVICE');
export const FLIGHT_BOOKINGS_LOOKUP = Symbol('FLIGHT_BOOKINGS_LOOKUP');
