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
| `FLIGHT_PAYABLE_BOOKING`, `HOTEL_PAYABLE_BOOKING` | `PayableBooking`: `getPayable`, `getPolicies`, `acceptPolicies`, `markConfirmed`, `markPaymentFailed` | flight-bookings (**implemented**, FLT-22), hotel-bookings (HTL-18) | payments (Ahmed) |
| `REFUNDS_SERVICE` | `RefundsService`: `quote`, `refundFor` (returns null for a 0 refund) | payments (Ahmed, **implemented**, PAY-03) | cancellations (Karim), FLT-06 |
| `FLIGHTS_SEARCH` | `FlightsSearch.search` | flights (Joudy, Ahmed for FLT-12) | itineraries ITN-26 (Sarah) |
| `HOTELS_SEARCH` | `HotelsSearch.search` | hotels (Sandra) | itineraries ITN-25 (Sarah) |
| `CURRENCY_SERVICE` | `CurrencyService`: `convert(amountMinor, from, to)` returns `{amountMinor, rate, rateDate}`; `supportedCurrencies()` | currency (Ahmed, TRVL-133, **implemented**) | budgets ITN-18 (Malak) |
| `REFERENCE_SERVICE` | `ReferenceService` (airports, cities, countries, attractions) | reference (Joudy, GEN-12) | everyone |
| `AUDIT_SERVICE` | `AuditService.record` | audit (Ahmed, **implemented**) | admin, moderation |
| `NOTIFICATIONS_SERVICE` | `NotificationsService.notify` | notifications (Karim, GEN-01) | bookings, payments, admin, flights |
| `FLIGHT_BOOKINGS_LOOKUP` | `FlightBookingsLookup.confirmedBookings(flightId)` returns `{bookingId, userId}[]` | flight-bookings (**implemented**, FLT-22) | flights FLT-05 schedule-change notifications (`FlightScheduleNotifier`, injected `@Optional()`) |
| `UPLOADS_SERVICE` | `UploadsService`: `saveImages(files, {entityType, entityId, existingCount})`, `deleteImage(url)` (GEN-08 limits in `UPLOAD_LIMITS`) | uploads (Ahmed, **implemented**) | blog, itineraries, hotels, airlines |

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

## Implemented in Sprint 1
- `modules/currency` (TRVL-133, ITN-18): `CurrencyRatesService` behind `CURRENCY_SERVICE`. Rates come from FXRatesAPI once per UTC day with `PLATFORM_CURRENCY` as the base and are cached in `exchange_rates`; the newest document serves every conversion, so an API outage falls back to the last cached rates. Rules for consumers:
  - `convert` throws 400 for a currency outside `supportedCurrencies()` (the seeded currencies) and 503 `EXCHANGE_RATE_UNAVAILABLE` when a rate is missing. Never catch the 503 and show a total anyway.
  - Show the returned `rateDate` next to converted totals.
  - Booking prices are never converted (PAY-04).
- `modules/uploads` (GEN-08): `ImageUploadsService` behind `UPLOADS_SERVICE`. It checks the format from the file's first bytes (JPG or PNG only), the 5 MB size and the per-entity count, rejects the whole batch on any problem, and stores files under `UPLOAD_DIR`, served read-only at `/uploads/<folder>/<file>`. How to add an image endpoint in your module (see `PUT /api/airlines/:id/logo` in `flights/airlines.controller.ts`):
  - Use `FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.maxBytes, files: 1 } })` or `FilesInterceptor('files', UPLOAD_LIMITS.maxImagesPerEntity, ...)`, with `@ApiConsumes('multipart/form-data')` and `@ApiErrorResponses(400, 404, 413)`.
  - Check ownership first, then call `saveImages` with `existingCount` = the images the entity already has, and store the returned `url` (and `imageId`) on your document.
  - Call `deleteImage(url)` when an image is removed or its entity is deleted. If saving your document fails after `saveImages`, delete the new files again.
- `modules/audit` (GEN-07): `GET /api/admin/audit-logs` (admins only) reads the log newest first with optional `action`, `targetType`, `targetId`, `actorId` and `from`/`to` filters. Admin and moderation modules (ACC-13, ACC-07a, ACC-15, ACC-16, GEN-10) must call `AUDIT_SERVICE.record` with their transaction's session, so an action and its audit entry commit or roll back together.
- `common/contracts/passengers.contract.ts` (FLT-12): `PassengerType`, `passengerTypeFor(dateOfBirth, travelDate)` (adult 12+, child 2-11, infant under 2, by whole years on the travel date), `passengerMixErrors` (at least one adult, no more infants than adults), `seatsFor`, `infantFareMinor` (10%, rounded down) and `partyFareMinor`. Flight search uses them now and booking (FLT-19, FLT-22) must use the same functions, so the price shown in search is the price charged.
- `flights` search (FLT-12): `GET /api/flights/search` takes `adults` (`passengers` is kept as its older name), `children`, `infants`, `cabinClass`, and `returnDate` with `returnPage` for round trips; the response then adds `returnFlights`. `FLIGHTS_SEARCH.search` applies the same party rules and infant pricing and returns the outbound leg.
- `modules/flight-bookings` (FLT-22, GEN-11): `POST /api/flight-bookings/hold` validates and prices on the server, then takes the seats of every segment and creates the PENDING_PAYMENT booking in one transaction. Each seat grab is conditional on the seats AND the quoted fare (ADR-0002). The lifecycle job expires unpaid holds (seats back, then `PAYMENT_HOLD_RELEASE.cancelForBooking`) and completes finished trips. Karim's FLT-21/FLT-25/FLT-26/FLT-29 work extends this module: list and cancel endpoints go in `flight-bookings.controller.ts`; a cancellation must give seats back with the same `$inc` on `cabins.$.seatsAvailable` inside a transaction with the status change, and use the booking's `segments[0].cancellationTiers` (FLT-12: outbound tier).
- `PAYMENT_HOLD_RELEASE` (`booking.contract.ts`): payments implements `cancelForBooking(type, id)` in PAY-01; the hold-expiry jobs call it after the expiry commits.
- PAY-02 (`payments/booking-policies.*`): `GET /api/bookings/:type/:id/policies` and `POST .../accept-policies` dispatch to the booking module through `PayableBooking.getPolicies` / `acceptPolicies`. Policies come from the booking's snapshot (`BookingPolicies` in `booking.contract.ts`): airline bookings fill `baggage`, hotel reservations fill `checkInOut`. The hotel-bookings module (HTL-18) must implement both methods the same way: owner only, unpaid and unexpired only, first timestamp kept.
- `modules/payments` (PAY-01, ADR-0003): `POST /api/payments`, `POST /api/payments/:id/retry`, `GET /api/payments/:id`, `POST /api/payments/webhook`. Stripe is reached only through `StripeGateway` (`STRIPE_GATEWAY` token, real SDK in `StripeSdkGateway`); e2e tests override it with a fake and sign webhook events with Stripe's own helper. Only the webhook confirms a booking, through `PayableBooking.markConfirmed` in the same transaction as the event id. `PaymentsService` also provides `PAYMENT_HOLD_RELEASE`. Local webhooks: `stripe listen --forward-to localhost:3000/api/payments/webhook`, then put the printed `whsec_...` in `STRIPE_WEBHOOK_SECRET`.
- `modules/payments` refunds (PAY-03): how a cancellation (FLT-26, HTL-21, FLT-06) uses `REFUNDS_SERVICE`, inside one transaction with the status change and the seat or room release:
  1. `const quote = refunds.quote({ paidMinor: booking.totalMinor, currency, eventStartUtc: segments[0].departureUtc, tiers: segments[0].cancellationTiers, reason })` (snapshot tiers; provider cancellations pass `RefundReason.ProviderCancellation` for 100%).
  2. `const record = await refunds.refundFor({ bookingType, bookingId, userId, paymentId: booking.paymentId, quote, reason }, session)`, then `$set: { refundId: record?.refundId }` on the booking in the same session.
  The refund is sent to Stripe after the commit (within a minute, retried until accepted); `GET /api/refunds/:id` shows Pending, Refunded or Failed.
