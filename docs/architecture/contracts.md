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
| `REFUNDS_SERVICE` | `RefundsService`: `quote`, `refundFor`, `summaryFor` | payments (`RefundsServiceImpl`, PAY-03, **implemented**) | booking details (refund block), cancellations FLT-26/HTL-21 (Karim), FLT-06 |
| `FLIGHTS_SEARCH` | `FlightsSearch.search` | flights (Joudy, Ahmed for FLT-12) | itineraries ITN-26 (Sarah) |
| `HOTELS_SEARCH` | `HotelsSearch.search` | hotels (Sandra) | itineraries ITN-25 (Sarah) |
| `CURRENCY_SERVICE` | `CurrencyService.convert` | currency (Ahmed, TRVL-133) | budgets ITN-18 (Malak) |
| `REFERENCE_SERVICE` | `ReferenceService` (airports, cities, countries, attractions) | reference (Joudy, GEN-12) | everyone |
| `AUDIT_SERVICE` | `AuditService.record` | audit (Ahmed, **implemented**) | admin, moderation |
| `NOTIFICATIONS_SERVICE` | `NotificationsService.notify` | notifications (Karim, GEN-01) | bookings, payments, admin, flights |
| `FLIGHT_BOOKINGS_LOOKUP` | `FlightBookingsLookup.confirmedBookings(flightId)` returns `{bookingId, userId}[]` | bookings (`BookingQueriesService`, TRVL-139), **implemented** | flights FLT-05 schedule-change notifications (`FlightScheduleNotifier`, injected `@Optional()`) |
| `UPLOADS_SERVICE` | `UploadsService.saveImages`, `deleteImage` (GEN-08 limits in `UPLOAD_LIMITS`) | uploads (`LocalDiskUploadsService`, Ahmed, **implemented**) | hotels HTL-01, airlines FLT-01; blog BLG-10 (Malak), itineraries ITN-12 (Sarah) |
| `UPCOMING_BOOKINGS` | `UpcomingBookings.countUpcomingConfirmed(userId, now)`: Confirmed flight bookings not yet departed plus Confirmed hotel reservations not yet checked in (one provider for both) | bookings (`BookingQueriesService`, TRVL-139), **implemented** | users ACC-12 self-deactivation (`DeactivationService`, injected `@Optional()`; until it is provided nobody can hold a booking) |
| `SESSION_VALIDATOR` | `SessionValidator.touch(sessionId, userId)` returns `SessionCheck`: atomically checks the session is not revoked, expired or idle and records the request (ACC-06), then returns the account's current `AuthUser`, status (ACC-11) and `mustChangePassword` (ACC-07a, ACC-13) | users (Abdelrahman, **implemented**) | the global `AuthGuard` in common/auth, on every cookie-authenticated request |

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

## Implemented in Sprint 0
- `modules/audit`: `audit_logs` schema and `AuditLogService` (TRVL-162). The log is append-only at the model level (update/delete hooks throw). Secret-looking metadata keys are stripped. Entries join the caller's transaction when a session is passed.
- `modules/payments`: `payments`, `refunds` and `stripe_events` schemas (TRVL-161) with these indexes:
  - unique PaymentIntent id
  - at most one SUCCEEDED payment per booking
  - one refund per booking
  - unique Stripe refund id when present
  - unique Stripe event id, kept for 30 days through a TTL index
