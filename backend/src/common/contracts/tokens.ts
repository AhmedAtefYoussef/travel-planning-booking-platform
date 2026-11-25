/**
 * Injection tokens for cross-module contracts (TRVL-132). Modules depend on these tokens and the
 * interfaces next to them, never on each other's services or schemas (enforced by dependency-cruiser).
 *
 * Provider (owner)                 ->  consumers
 *   FLIGHT_PAYABLE_BOOKING (Karim)  ->  payments
 *   HOTEL_PAYABLE_BOOKING (Karim)   ->  payments
 *   REFUNDS_SERVICE (Ahmed)         ->  flight/hotel cancellations, FLT-06
 *   FLIGHTS_SEARCH (Joudy)          ->  itineraries (ITN-26)
 *   FLIGHT_INVENTORY (flights)      ->  bookings (FLT-22 seat holds)
 *   HOTEL_INVENTORY (hotels)        ->  bookings (HTL-18 room holds)
 *   HOTELS_SEARCH (Sandra)          ->  itineraries (ITN-25)
 *   CURRENCY_SERVICE (Ahmed)        ->  budgets (ITN-18)
 *   REFERENCE_SERVICE (Joudy)       ->  all
 *   AUDIT_SERVICE (Ahmed)           ->  admin, moderation
 *   NOTIFICATIONS_SERVICE (Ahmed)   ->  bookings, payments, admin, flights
 *   FLIGHT_BOOKINGS_LOOKUP (bookings) ->  flights (FLT-05 schedule-change notifications)
 *   FLIGHT_BOOKING_CANCELLATIONS (bookings) -> flights (FLT-06 flight cancellation)
 *   UPLOADS_SERVICE (Ahmed)         ->  blog, itineraries, hotels, airlines
 *   SESSION_VALIDATOR (Abdelrahman) ->  common/auth AuthGuard (ACC-06 idle expiry, logout)
 *   UPCOMING_BOOKINGS (bookings)    ->  users (ACC-12 self-deactivation)
 *   ACCOUNT_ADMIN (users)           ->  admin (ACC-15, ACC-16 suspensions)
 *   AIRLINE_STATUS (flights)        ->  admin (ACC-15 deactivation), bookings (409 PROVIDER_INACTIVE)
 *   HOTEL_STATUS (hotels)           ->  admin (ACC-15 deactivation)
 *   ITINERARY_BUDGETS (budgets)     ->  itineraries (ITN-07, ITN-09, ITN-21; optional until ITN-14)
 *   CONTENT_MODERATION (moderation) ->  posts, comments, reviews, itineraries register adapters (GEN-09, GEN-10)
 *   PUBLIC_ITINERARIES (itineraries) ->  blog (BLG-12 author page)
 *   MAIL_SERVICE, EMAIL_NOTIFICATIONS (mail) -> notifications (GEN-01-B), users (ACC-13 invitation)
 *   USER_CONTACTS (users)           ->  mail (GEN-01-B recipient lookup)
 *
 * Usage:  constructor(@Inject(AUDIT_SERVICE) private readonly audit: AuditService) {}
 * The providing module exports `{ provide: AUDIT_SERVICE, useExisting: AuditLogService }`.
 */
export const FLIGHT_PAYABLE_BOOKING = Symbol('FLIGHT_PAYABLE_BOOKING');
export const HOTEL_PAYABLE_BOOKING = Symbol('HOTEL_PAYABLE_BOOKING');
export const REFUNDS_SERVICE = Symbol('REFUNDS_SERVICE');
export const FLIGHTS_SEARCH = Symbol('FLIGHTS_SEARCH');
export const FLIGHT_INVENTORY = Symbol('FLIGHT_INVENTORY');
export const HOTEL_INVENTORY = Symbol('HOTEL_INVENTORY');
export const HOTELS_SEARCH = Symbol('HOTELS_SEARCH');
export const CURRENCY_SERVICE = Symbol('CURRENCY_SERVICE');
export const REFERENCE_SERVICE = Symbol('REFERENCE_SERVICE');
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');
export const NOTIFICATIONS_SERVICE = Symbol('NOTIFICATIONS_SERVICE');
export const UPLOADS_SERVICE = Symbol('UPLOADS_SERVICE');
export const FLIGHT_BOOKINGS_LOOKUP = Symbol('FLIGHT_BOOKINGS_LOOKUP');
export const FLIGHT_BOOKING_CANCELLATIONS = Symbol(
  'FLIGHT_BOOKING_CANCELLATIONS',
);
export const SESSION_VALIDATOR = Symbol('SESSION_VALIDATOR');
export const UPCOMING_BOOKINGS = Symbol('UPCOMING_BOOKINGS');
export const ACCOUNT_ADMIN = Symbol('ACCOUNT_ADMIN');
export const AIRLINE_STATUS = Symbol('AIRLINE_STATUS');
export const HOTEL_STATUS = Symbol('HOTEL_STATUS');
export const ITINERARY_BUDGETS = Symbol('ITINERARY_BUDGETS');
export const CONTENT_MODERATION = Symbol('CONTENT_MODERATION');
export const PUBLIC_ITINERARIES = Symbol('PUBLIC_ITINERARIES');
export const MAIL_SERVICE = Symbol('MAIL_SERVICE');
export const EMAIL_NOTIFICATIONS = Symbol('EMAIL_NOTIFICATIONS');
export const USER_CONTACTS = Symbol('USER_CONTACTS');
