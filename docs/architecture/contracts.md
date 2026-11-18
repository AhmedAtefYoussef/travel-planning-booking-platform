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
| `FLIGHT_PAYABLE_BOOKING`, `HOTEL_PAYABLE_BOOKING` | `PayableBooking`: `getPayable`, `markConfirmed`, `markPaymentFailed` | bookings (FLT-22, HTL-18) | payments (Ahmed) |
| `REFUNDS_SERVICE` | `RefundsService`: `quote`, `refundFor`, `summaryFor` | payments (`RefundsServiceImpl`, PAY-03, **implemented**) | booking details (refund block), cancellations FLT-26/HTL-21 (Ahmed), FLT-06 |
| `FLIGHTS_SEARCH` | `FlightsSearch.search` | flights (Joudy, Ahmed for FLT-12) | itineraries ITN-26 (Sarah) |
| `HOTELS_SEARCH` | `HotelsSearch.search` | hotels (Sandra) | itineraries ITN-25 (Sarah) |
| `CURRENCY_SERVICE` | `CurrencyService.convert`, `supportedCurrencies` | currency (`ExchangeRatesService`, Ahmed, TRVL-133), **implemented** | budgets ITN-18 (Malak) |
| `REFERENCE_SERVICE` | `ReferenceService` (airports, cities, countries, attractions, currencies with minor units) | reference (Joudy, GEN-12) | everyone |
| `AUDIT_SERVICE` | `AuditService.record` | audit (Ahmed, **implemented**) | admin, moderation |
| `CONTENT_MODERATION` | `ContentModeration.register(adapter)`, `get(type)`; adapter interface `ModeratableContentAdapter` (see below) | moderation (`ContentModerationRegistry`, Ahmed, GEN-09, **implemented**, #106) | content modules register one adapter each: blog posts (`PostModerationAdapter`) and itineraries (`ItineraryModerationAdapter`) are registered; comments and reviews are not yet; reports (GEN-09), hide and delete (GEN-10) |
| `NOTIFICATIONS_SERVICE` | `NotificationsService.notify` | notifications (Ahmed, GEN-01) | bookings, payments, admin, flights |
| `FLIGHT_BOOKINGS_LOOKUP` | `FlightBookingsLookup.confirmedBookings(flightId)` returns `{bookingId, userId}[]` | bookings (`BookingQueriesService`, TRVL-139), **implemented** | flights FLT-05 schedule-change notifications (`FlightScheduleNotifier`, injected `@Optional()`) |
| `UPLOADS_SERVICE` | `UploadsService.saveImages`, `deleteImage` (GEN-08 limits in `UPLOAD_LIMITS`) | uploads (`LocalDiskUploadsService`, Ahmed, **implemented**) | hotels HTL-01, airlines FLT-01; blog BLG-10 (Malak), itineraries ITN-12 (Sarah) |
| `UPCOMING_BOOKINGS` | `UpcomingBookings.countUpcomingConfirmed(userId, now)`: Confirmed flight bookings not yet departed plus Confirmed hotel reservations not yet checked in (one provider for both) | bookings (`BookingQueriesService`, TRVL-139), **implemented** | users ACC-12 self-deactivation (`DeactivationService`, injected `@Optional()`; until it is provided nobody can hold a booking) |
| `SESSION_VALIDATOR` | `SessionValidator.touch(sessionId, userId)` returns `SessionCheck`: atomically checks the session is not revoked, expired or idle and records the request (ACC-06), then returns the account's current `AuthUser`, status (ACC-11) and `mustChangePassword` (ACC-07a, ACC-13) | users (Abdelrahman, **implemented**) | the global `AuthGuard` in common/auth, on every cookie-authenticated request |
| `ACCOUNT_ADMIN` | `AccountAdmin`: `find`, `changeStatus(userId, from, to, session)` (status-conditioned, `false` when another admin changed it first), `revokeAllSessions(userId, session)`, `moderatorsOf(type, providerId)` | users (`AccountAdminService`, ACC-15/16, **implemented**) | admin ACC-15/16 suspensions and provider notices (`AccountSuspensionsService`, `ProviderActivationService`) |
| `AIRLINE_STATUS`, `HOTEL_STATUS` | `ProviderStatus`: `find(id)` returns `{id, name, isActive}`; `setActive(id, active, session)` flips `isActive` only from the other value (`false` when it already had it) | flights (`AirlineStatusService`) and hotels (`HotelStatusService`), ACC-15, **implemented** | admin ACC-15 deactivation; bookings, so a hold on a deactivated airline is 409 `PROVIDER_INACTIVE` (a deactivated hotel is already known from `BookableStay.unavailableReason`) |
| `ITINERARY_BUDGETS` | `ItineraryBudgets`: `dayTotals(itineraryId)` returns per-day `{dayId, amounts: {currency, amountMinor}[]}`; `deleteForDays`, `deleteForItinerary`, `cloneForItinerary(sourceId, targetId, dayIdMap)` | budgets (Malak, ITN-14/ITN-16), not provided yet | itineraries (Sarah): ITN-01 delete, ITN-07 day delete, ITN-09 group subtotals, ITN-21 clone. Injected `@Optional()`: until it is provided, subtotals count activity costs only and there are no budget rows to delete or copy |

## Shared rules that live in the contracts
- **Booking lifecycle (GEN-11):** `BookingStatus`, `BOOKING_TRANSITIONS` and `canTransition()`. Change a status only through `transitionBooking(model, id, from, to, { set, where, session })` (`common/contracts/booking-transition.ts`): it refuses a transition outside the table with 409 `INVALID_STATE_TRANSITION` and otherwise runs the status-conditioned update (`{ _id, status: from }`), returning `false` when another writer moved the booking first. Bulk jobs (expiry, completion) use the same status-conditioned filter in `updateMany`.
- **Holds:** `HOLD_DURATION_MS` = 10 minutes (FLT-22, HTL-18).
- **Cancellation tiers (FLT-09, HTL-10):** `selectCancellationTier()` picks the highest threshold that does not exceed the days remaining, or 0% when none applies. `cancellationTierErrors()` validates policy input.
- **Refunds:** `computeRefundQuote()` blocks user cancellation after departure or check-in, refunds 100% for provider cancellations, and rounds down. Use the booking's **policy snapshot**, not the provider's current policy.
- **Issuing a refund (PAY-03, PAY-04; for FLT-26, HTL-21 and FLT-06):** inject `REFUNDS_SERVICE` (the payments module is global; never import it).
  - Signature: `refundFor({ bookingType, bookingId, userId, paymentId, quote, reason }, session?) => Promise<RefundRecord | null>`. `quote` comes from `quote()` on the booking's policy snapshot; `paymentId` is the booking's SUCCEEDED payment.
  - It returns **null when `quote.amountMinor` is 0**: no refund is recorded and nobody is notified. Store nothing then.
  - **Call it inside the cancellation transaction** and pass its `session`: the PENDING refund and its REFUND_ISSUED notification commit or abort with the cancellation. Stripe is called only after commit (outbox), so never wrap it in a retry of your own.
  - **Store `refundId` on the booking** (e.g. `refundId` on the flight booking or reservation) for your own audit trail; the booking details already show `refund: { id, status, amountMinor, currency } | null` through `summaryFor`.
  - A repeat call for the same booking returns the existing record (one refund per booking). A quote outside `PLATFORM_CURRENCY`, above the amount paid, or naming another booking's payment throws a plain `Error` (a defect, 500).
- **Flags:** providers have `isActive` (`ACTIVE_PROVIDER_FILTER` in search and booking, ACC-15). Community content has `isHidden` (`VISIBLE_CONTENT_FILTER` in public reads, GEN-10).
- **Room availability (HTL-04, for HTL-08, HTL-15 and HTL-18):** `rooms.availability` is a list of half-open `{from, to}` ranges (`to` is the first night not included), sorted by `from`, at most `MAX_RANGES_PER_ROOM`. Ranges never overlap but **may touch**, and touching ranges are stored separately: `[01-10, 01-20)` and `[01-20, 02-01)` together make 01-10 to 01-31 bookable. A stay is bookable when every night of it lies inside some range, so treat touching ranges as one contiguous span; never require the whole stay to fit inside a single range.
- **Room edits (HTL-05, for HTL-17 and HTL-18):** a moderator can change `priceMinor` and replace `availability` at any time. So that existing reservations are not affected, a hotel reservation must **store the price per night it was booked at** and never read the room's current price afterwards. Replacing availability refuses (409) to leave a BOOKED night, or a HELD night whose hold has not expired, from today on outside the new ranges. "Today" is the hotel's local date (the time zone of an airport in the hotel's city; UTC-12 when unknown), because `room_nights.date` is a local date. That check and the write run in one transaction that writes the room document, so the HTL-18 hold transaction must make a room write that **always changes it**: `$inc: { reservationVersion: 1 }` (alongside `$set: { everReserved: true }`). Setting `everReserved` alone is not enough: once it is already true the update changes nothing, MongoDB writes nothing and the two transactions no longer conflict. Do not rely on Mongoose timestamps, and do not use `doc.save()` for this write, because it skips documents with no changed field.
- **Schemas:** spread `SCHEMA_OPTIONS` (timestamps, `id` in JSON). Reference fields **must** use `@Prop({ type: MongooseSchema.Types.ObjectId })` (`import { Schema as MongooseSchema } from 'mongoose'`). `Types.ObjectId` stores values but breaks query casting, so `find({ userId: '<hex>' })` silently matches nothing.

## Currency conversion (ITN-18), for itinerary budgets
Inject `@Inject(CURRENCY_SERVICE) private readonly currency: CurrencyService` (the module is global) and call
`convert(amountMinor, from, to)`. It returns `{ amountMinor, rate, rateDate }`: the amount in minor units of `to`
(each currency's seeded minor units, so JPY has 0 decimals), the rate used and the day of that rate, which the
budget summary must show (ITN-18). Rates are fetched from FXRatesAPI once a day (and at startup when none are
cached) and the newest cached day is always used, so an API outage falls back to the last cached rates.
- Let the errors propagate: 400 `VALIDATION_FAILED` with `fieldErrors` `from`/`to` for a code that is not a seeded
  currency, and 503 `EXCHANGE_RATE_UNAVAILABLE` when no cached rate exists for either currency. Never show a
  converted total built without a rate (no 0, no NaN).
- Same currency returns the amount unchanged with rate 1. `supportedCurrencies()` lists the seeded codes.
- Display only: booking prices, payments and refunds are never converted (PAY-04).
- `GET /api/currencies/rates` shows the cached rates and `rateDate`; `GET /api/currencies/convert` is the Swagger demo.

## Image uploads (GEN-08), for BLG-10 and ITN-12
Posts and activities reuse the hotel/airline pattern (`hotels.service.ts` `addImages`/`removeImage`):
```ts
// controller: multipart field "images", 1-5 files kept in memory; multer limit errors become 400 fieldErrors
import { ImageFilesInterceptor } from '../uploads';
@Post(':id/images') @Roles(Role.User) @ApiConsumes('multipart/form-data')
@UseInterceptors(ImageFilesInterceptor('images', UPLOAD_LIMITS.maxImagesPerEntity))
add(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFiles() files: UploadedFileLike[] | undefined) { return this.posts.addImages(user, id, files ?? []); }

// service: check ownership first, then save, then add the URLs with a conditional $push
const stored = await this.uploads.saveImages(files, { entityType: 'POST', entityId: id, existingCount: post.images.length });
const urls = stored.map((s) => s.url);
const updated = await this.posts.findOneAndUpdate(
  { _id: id, $expr: { $lte: [{ $size: '$images' }, UPLOAD_LIMITS.maxImagesPerEntity - urls.length] } },
  { $push: { images: { $each: urls } } }, { new: true }).exec();
if (!updated) { for (const u of urls) await this.uploads.deleteImage(u); throw new ValidationFailedException([{ field: 'images', message: '...' }]); }
```
- `saveImages` rejects the whole batch with 400 `VALIDATION_FAILED` (`fieldErrors.images`, or `logo` for `AIRLINE_LOGO`) for 0 files, more than 5 in all (1 for a logo), a file above 5 MB, or content that is not JPG/PNG or does not match the declared type (magic bytes). Nothing is written then; on a later failure it deletes what it wrote.
- URLs look like `/uploads/<posts|activities|hotels|airlines>/<uuid>.<jpg|png>`, served publicly outside `/api` (`app.setup.ts`, `nosniff`). Validate stored URLs in DTOs with `IsImageUrl('<folder>')` (`common/validation`), which also accepts http(s) links.
- Delete files you drop with `deleteImage(url)` (it ignores anything that is not such a URL, and a missing file), and delete the files you saved whenever your own write afterwards fails or loses a race.

## Content moderation (GEN-09, GEN-10), for posts, comments, reviews and itineraries
Moderation never imports the content modules. Each one injects `CONTENT_MODERATION` (global, `common/contracts/moderation.contract.ts`) and registers **one** adapter for its type at start-up:
```ts
constructor(@Optional() @Inject(CONTENT_MODERATION) private readonly moderation?: ContentModeration) {}
onModuleInit() { this.moderation?.register(this); }
```
- **Adapter** (`ModeratableContentAdapter`): `type` (`POST`, `COMMENT`, `REVIEW` or `ITINERARY`) and three methods.
  - `find(id, session?)` returns `{ id, authorId, isHidden, isPublic }` whatever the visibility, or `null` for an unknown or malformed id. Reporting checks `isContentVisibleTo(content, userId)`: the author always, anyone else only when public and not hidden. Anything else answers exactly like an unknown id (404).
  - `setHidden(id, hidden, session)` (GEN-10) returns `false` and changes nothing when the content does not exist or already has that flag.
  - `remove(id, session)` (GEN-10) deletes the content and what belongs only to it, inside the caller's transaction. It returns `null` when there is nothing to delete; otherwise `{ afterCommit() }`.
- **Registry:** `register` throws on a second adapter for one type. A type with no adapter behaves as if no such content exists, so `POST /api/reports` answers 404 for it.
- **afterCommit rule:** the caller runs `afterCommit()` only after its transaction has committed, never inside it. Put there whatever cannot roll back with the transaction: deleting image files and calling ports that take no session. Never do that work inside `remove()`.

## Implemented in Sprint 0
- `modules/audit`: `audit_logs` schema, `AuditLogService` (TRVL-162) and `GET /api/admin/audit-logs` (GEN-07, TRVL-102: admin only, newest first, 10 per page, filters `action`, `targetType`, `actorId`, `from`, `to`). The log is append-only at the model level (update/delete hooks throw). Secret-looking metadata keys are stripped. Entries join the caller's transaction when a session is passed.
- `modules/payments`: `payments`, `refunds` and `stripe_events` schemas (TRVL-161) with these indexes:
  - unique PaymentIntent id
  - at most one SUCCEEDED payment per booking
  - one refund per booking
  - unique Stripe refund id when present
  - unique Stripe event id, kept for 30 days through a TTL index

## Audit log: what ACC-15, ACC-16 and GEN-10 must record (GEN-07)
`GET /api/admin/audit-logs` only shows what is recorded. Suspension and reactivation (ACC-15, ACC-16), content deletion (GEN-10) and the other admin actions must each call `AUDIT_SERVICE.record(entry, session)` **inside the same transaction** as the change, so the entry commits or aborts with it. Use the catalogue in `AuditAction` and `AuditTargetType` (`common/contracts/services.contract.ts`): `SUSPEND_ACCOUNT` / `REACTIVATE_ACCOUNT` on target `USER`, `DEACTIVATE_PROVIDER` / `REACTIVATE_PROVIDER` on `AIRLINE` or `HOTEL`, `RESOLVE_REPORT` on `REPORT`, `HIDE_CONTENT` / `DELETE_CONTENT` on `POST`, `COMMENT`, `REVIEW` or `ITINERARY`. Put the admin's `reason` in `reason` and a small before/after summary in `metadata`; keys that look like secrets are stripped.

ACC-15 and ACC-16 do this in `modules/admin` (PATCH `/api/admin/accounts/:id/suspend|reactivate` and `/api/admin/providers/:type/:id/deactivate|reactivate`). One `connection.transaction` holds the status change (`ACCOUNT_ADMIN.changeStatus` or `AIRLINE_STATUS`/`HOTEL_STATUS.setActive`), the session revocation of a suspension, the audit entry and the notifications (`ACCOUNT_SUSPENDED`/`ACCOUNT_REACTIVATED` to the account, `PROVIDER_DEACTIVATED`/`PROVIDER_REACTIVATED` to every moderator of the provider). Account entries carry `metadata: {targetRole, from, to}`; provider entries carry `{providerName, moderatorsNotified}`. GEN-10 content deletion still has to add its own entries.
