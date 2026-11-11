# Cross-module contracts (TRVL-132)

Modules never import each other's internals. dependency-cruiser enforces this in CI: a module may import another only through its public `index.ts` (which may export schemas, e.g. `flights/index.ts`, so a consumer can register a read model) or through a token below. A module that needs another module's behaviour injects a **token** from `backend/src/common/contracts` and codes against the **interface** next to it. The owner provides the implementation:

```ts
// consumer
constructor(@Inject(AUDIT_SERVICE) private readonly audit: AuditService) {}

// owner module
providers: [AuditLogService, { provide: AUDIT_SERVICE, useExisting: AuditLogService }],
exports: [AUDIT_SERVICE],
```

| Token | Interface | Implemented by | Used by |
|---|---|---|---|
| `FLIGHT_PAYABLE_BOOKING`, `HOTEL_PAYABLE_BOOKING` | `PayableBooking`: `getPayable`, `markConfirmed`, `markPaymentFailed` | flight-bookings, hotel-bookings (Karim) | payments (Ahmed) |
| `REFUNDS_SERVICE` | `RefundsService`: `quote`, `refundFor` | payments (Ahmed) | cancellations (Karim), FLT-06 |
| `FLIGHTS_SEARCH` | `FlightsSearch.search` | flights (Joudy, Ahmed for FLT-12) | itineraries ITN-26 (Sarah) |
| `HOTELS_SEARCH` | `HotelsSearch.search` | hotels (Sandra) | itineraries ITN-25 (Sarah) |
| `CURRENCY_SERVICE` | `CurrencyService.convert` | currency (Ahmed, TRVL-133) | budgets ITN-18 (Malak) |
| `REFERENCE_SERVICE` | `ReferenceService` (airports, cities, countries, attractions) | reference (Joudy, GEN-12) | everyone |
| `AUDIT_SERVICE` | `AuditService.record` | audit (Ahmed, **implemented**) | admin, moderation |
| `NOTIFICATIONS_SERVICE` | `NotificationsService.notify` | notifications (Karim, GEN-01) | bookings, payments, admin, flights |
| `FLIGHT_BOOKINGS_LOOKUP` | `FlightBookingsLookup.confirmedBookings(flightId)` returns `{bookingId, userId}[]` | flight-bookings (Karim) | flights FLT-05 schedule-change notifications (`FlightScheduleNotifier`, injected `@Optional()`) |
| `UPLOADS_SERVICE` | `UploadsService.saveImages` (GEN-08 limits in `UPLOAD_LIMITS`) | uploads (Ahmed) | blog, itineraries, hotels, airlines |
| `SESSION_VALIDATOR` | `SessionValidator.touch(sessionId, userId)`: atomically checks the session is not revoked, expired or idle and records the request | users (Abdelrahman, ACC-06, **implemented**) | the global `AuthGuard` in common/auth, on every cookie-authenticated request |

## Shared rules that live in the contracts
- **Booking lifecycle (GEN-11):** `BookingStatus`, `BOOKING_TRANSITIONS` and `canTransition()`. Check transitions with `canTransition` and update with a status-conditioned query (`{ _id, status: from }`) so concurrent updates cannot skip a state.
- **Holds:** `HOLD_DURATION_MS` = 10 minutes (FLT-22, HTL-18).
- **Cancellation tiers (FLT-09, HTL-10):** `selectCancellationTier()` picks the highest threshold that does not exceed the days remaining, or 0% when none applies. `cancellationTierErrors()` validates policy input.
- **Refunds:** `computeRefundQuote()` blocks user cancellation after departure or check-in, refunds 100% for provider cancellations, and rounds down. Use the booking's **policy snapshot**, not the provider's current policy.
- **Flags:** providers have `isActive` (`ACTIVE_PROVIDER_FILTER` in search and booking, ACC-15). Community content has `isHidden` (`VISIBLE_CONTENT_FILTER` in public reads, GEN-10).
- **Schemas:** spread `SCHEMA_OPTIONS` (timestamps, `id` in JSON). Reference fields **must** use `@Prop({ type: MongooseSchema.Types.ObjectId })` (`import { Schema as MongooseSchema } from 'mongoose'`). `Types.ObjectId` stores values but breaks query casting, so `find({ userId: '<hex>' })` silently matches nothing.

## Implemented in Sprint 0
- `modules/audit`: `audit_logs` schema and `AuditLogService` (TRVL-162). The log is append-only at the model level (update/delete hooks throw). Secret-looking metadata keys are stripped. Entries join the caller's transaction when a session is passed.
- `modules/payments`: `payments`, `refunds` and `stripe_events` schemas (TRVL-161) with these indexes:
  - unique PaymentIntent id
  - at most one SUCCEEDED payment per booking
  - one refund per booking
  - unique Stripe refund id when present
  - unique Stripe event id, kept for 30 days through a TTL index
