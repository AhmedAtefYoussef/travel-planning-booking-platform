# V&V M1, Track E: Booking engine and payments

Scope: GEN-11 and the TRVL-139 schemas first; FLT-12, FLT-19, FLT-21, FLT-22, FLT-23, HTL-16, HTL-17, HTL-18, GEN-01 and PAY-01 to PAY-04 are added as their PRs land (plan of 2026-11-14).

Method. Each workbook rule is split into atomic rules, and each atomic rule names the black-box technique that derived its cases:
- **ST**: state-transition testing. GEN-11 covers every state pair: 0-switch, all 25.
- **EP/BVA**: equivalence partitions and boundary values (ages, counts, amounts, the 10-minute hold).
- **DT**: decision table (one case per rule column).
- **CONC**: concurrency (parallel requests against the replica set).
- **IDEM**: replay and retry.
- **AUTHZ**: the BOLA/BFLA role matrix.

Every case lives in a `describe('… : <ID>')` block, so `check-test-traceability.mjs` can see it.

Paths are relative to `backend/`.

## GEN-11 booking lifecycle and TRVL-139 schemas

| Rule | Source | Rule text | Technique | Code | Test | Verdict | Note |
|---|---|---|---|---|---|---|---|
| R-GEN-11-01 | workbook | Only PENDING_PAYMENT→CONFIRMED, CONFIRMED→COMPLETED, PENDING_PAYMENT→EXPIRED and CONFIRMED→CANCELLED are allowed. The other 21 state pairs are refused with 409 INVALID_STATE_TRANSITION before any write | ST (25/25 pairs) | src/common/contracts/booking-transition.ts | src/common/contracts/booking-transition.spec.ts | PASS | |
| R-GEN-11-02 | contracts.md | Every status change is conditioned on the current status (`{_id, status: from}`), so of two concurrent writers exactly one moves the booking and the other gets `false`. Neither `where` nor `set` can override the id or status guard | ST, CONC (replica set) | booking-transition.ts | test/bookings-lifecycle.e2e-spec.ts (two parallel writers; expired booking cannot be confirmed), booking-transition.spec.ts (guard cannot be overridden) | PASS | Independent review (2026-11-14) downgraded the first, mock-only evidence; the real-DB race test was added |
| R-GEN-11-07 | contracts.md, PAY-01 | Confirming must write the payment and the booking reference in the same update; confirmation is never done in bulk; a malformed id is a 404 before any write | EP | booking-transition.ts | booking-transition.spec.ts | PASS | |
| R-GEN-11-08 | ADR-0002 | Lifecycle jobs use the same guarded transition in bulk; an invalid transition is refused before any write, and the app refuses to start if Confirmed -> Completed leaves the table | ST (21 invalid pairs, bulk) | booking-transition.ts (`transitionManyBookings`), booking-lifecycle.service.ts | booking-transition.spec.ts | PASS | |
| R-GEN-11-03 | workbook | CONFIRMED→COMPLETED once the trip has ended (last arrival; the end of the check-out day in the hotel's zone, so a guest still in the room is never completed). PENDING and future trips are untouched, and a second run changes nothing | ST, BVA (endsAt = now) | src/modules/bookings/booking-lifecycle.service.ts | test/bookings-lifecycle.e2e-spec.ts (completion job) | PASS | |
| R-GEN-11-04 | workbook | PENDING_PAYMENT→EXPIRED when the 10-minute hold times out, releasing the inventory | ST, BVA | - | - | Closed by the FLT-22 row R-GEN-11-04 below | Kept so the ids stay stable |
| R-GEN-11-05 | workbook | CONFIRMED→CANCELLED on a user or provider cancellation | ST | bookings/booking-cancellation.ts | booking-cancellation.spec.ts; test/flight-cancellation.e2e-spec.ts | PASS for flight bookings (R-FLT-26-03, #PR); hotel reservations BLOCKED-BY HTL-21 | Provider cancellation is in the core; its caller lands with FLT-06 |
| R-GEN-11-06 | derived | The schemas refuse a status outside the lifecycle, a non-integer amount (ADR-0004), a round trip without two segments, endsAt not after startsAt, check-out not after check-in, and a malformed reference | EP | src/modules/bookings/schemas/*.ts | bookings-lifecycle.e2e-spec.ts (schemas) | PASS | |
| R-TRVL139-01 | ERD | The booking reference is unique once assigned, and many unconfirmed bookings may have none | EP | schemas/booking-fields.ts (partial unique index) | bookings-lifecycle.e2e-spec.ts (schemas) | PASS | A `sparse` index would have rejected the second null |
| R-ACC-12-02 | workbook | Self-deactivation is refused with 409 UPCOMING_BOOKINGS_EXIST while the user has a Confirmed trip that has not finished (in progress counts) or a Pending Payment booking within its hold (the payment may still be confirmed). Flights and hotels both count; expired holds, Cancelled, Completed and other users' bookings do not. A malformed id fails closed, and the provider is required, so an app without it does not start | EP, BVA, AUTHZ (real cookie) | src/modules/bookings/booking-queries.service.ts | bookings-lifecycle.e2e-spec.ts (UPCOMING_BOOKINGS) | PASS | Was BLOCKED-BY the bookings module |
| R-FLT-05-08a | workbook | A flight's Confirmed bookings, with the account to notify, are found for schedule-change notifications | EP | booking-queries.service.ts | bookings-lifecycle.e2e-spec.ts (FLIGHT_BOOKINGS_LOOKUP) | PASS | Sending the notification still needs GEN-01 |

### Independent review, 2026-11-14 (commit 1d5c4dc)

Two reviewer subagents (TypeScript correctness, silent failures) reviewed the first commit. The fixes are in the follow-up commit on the same branch.

| Finding | Severity | Resolution |
|---|---|---|
| A hotel stay was completed at 00:00 on check-out day, while the guest was still in the room | HIGH | `endsAt` is now the end of the check-out day (R-GEN-11-03) |
| The completion job bypassed the transition guard | HIGH | `transitionManyBookings` (R-GEN-11-08) |
| R-GEN-11-02 was marked PASS on mock-only evidence | HIGH | Replica-set race test added (R-GEN-11-02) |
| A paid but not yet confirmed hold did not block deactivation | HIGH | Unexpired holds count (R-ACC-12-02) |
| An optional ACC-12 provider fell back to "no bookings" | HIGH | The provider is required, and the check fails closed (R-ACC-12-02) |
| Invalid ids answered 0 or [] | MEDIUM | They throw instead (R-ACC-12-02) |
| A trip in progress did not block deactivation | MEDIUM | `endsAt > now` (R-ACC-12-02) |
| A confirmation could omit the payment or the reference; a malformed id became a 500 | MEDIUM | Guarded (R-GEN-11-07) |
| Copied trip data was not validated; lifecycle fields and indexes were missing | MEDIUM | Validators, `confirmedAt`/`cancelledAt`/`cancelledBy`, a `paymentId` index and a partial expiry index (R-GEN-11-06) |
| A test override could silently not apply; the uniqueness test could flake; the job log had no stack | LOW | Fixed |

**Deferred, with reasons:**
- `policySnapshot` stays `Mixed` until PAY-02 defines its shape.
- The FLT-05 schedule-change path must update the booking's `startsAt`/`endsAt`. That belongs to FLT-22, which creates the first real bookings.
- Rooms with 0 adults remain valid, because the workbook requires one adult per reservation, not per room.
- The ACC-12 message still says "upcoming confirmed bookings" although unexpired holds now count too. Changing the user-visible text is left to the ACC-12 owner.

## FLT-12 round trip, passenger types and cabin filter

| Rule | Source | Rule text | Technique | Code | Test | Verdict | Note |
|---|---|---|---|---|---|---|---|
| R-FLT-12-01 | workbook (b) | Adults and children pay the cabin fare and each take a seat | EP | src/modules/flights/flight-pricing.ts (`priceParty`) | flight-pricing.spec.ts; test/flight-search-round-trip.e2e-spec.ts | PASS | |
| R-FLT-12-02 | workbook (b) | Infants pay 10% of the fare (rounded down to whole minor units) and take no seat | EP, BVA (fare 999 → 99; 2 adults + 2 infants fit a 2-seat cabin, while 3 seated passengers do not) | flight-pricing.ts, flight-search.service.ts | flight-pricing.spec.ts; flight-search-round-trip.e2e-spec.ts | PASS | Search and FLT-22 holds share `priceParty` |
| R-FLT-12-03 | workbook (b) | Each booking needs at least one adult and no more infants than adults | BVA (0 / 1 adult; infants = adults vs adults + 1) | flight-pricing.ts (`partyErrors`) | flight-pricing.spec.ts; flight-search-round-trip.e2e-spec.ts | PASS | Enforced again at hold time (FLT-22) |
| R-FLT-12-04 | workbook (b) | The passenger type is validated against the date of birth | BVA | - | - | Closed by R-FLT-22-07 (#59) | Search has no DOB; the booking checks it |
| R-FLT-12-05 | derived (FLT-11 compatibility) | Give either the FLT-11 `passengers` count (all adults) or adults/children/infants, never both and never neither; children or infants without adults is reported on `adults`. All of these are DTO errors, reported with the other format errors | DT (both / neither / passengers only / typed only / typed without adults) | dto/flight-search.dto.ts (`ValidateIf`, `NotWithTypedCounts`, `IsCount`) | flight-search-round-trip.e2e-spec.ts; flight-search.e2e-spec.ts (FLT-11 unchanged) | PASS | |
| R-FLT-12-06 | workbook (c) | An optional cabin-class filter keeps only that cabin; an unknown class is a 400 on cabinClass | EP | flight-search.service.ts | flight-search-round-trip.e2e-spec.ts | PASS | |
| R-FLT-12-07 | workbook (a) | Round-trip search returns outbound and return options for the same party and cabin, each paginated (page, returnPage) | EP | flight-search.service.ts (`searchRoundTrip`), flights.controller.ts | flight-search-round-trip.e2e-spec.ts | PASS | |
| R-FLT-12-08 | derived | returnDate must be given, well-formed, a real date and on or after departureDate (a same-day return is allowed); the order is compared only when both dates are real; returnPage is a whole number of at least 1 | BVA (D-1, D, D+7; 2028-02-30; returnPage 0, 999) | searchRoundTrip | flight-search-round-trip.e2e-spec.ts | PASS | |
| R-FLT-12-12 | GEN-02 | Every validation layer reports all of its errors at once: semantic errors of both legs (unknown airport, impossible date, party rule) come back together; one message per field | EP | flight-search.service.ts (`searchRoundTrip` via `allSettled`; calendar check also when the airport is unknown) | flight-search-round-trip.e2e-spec.ts | PASS | Also closes an FLT-11 gap: an impossible date was hidden behind an unknown airport |
| R-FLT-12-13 | derived (booking) | The return segment must depart after the outbound arrives | DT | - | - | Closed by R-FLT-22-06 (#59) | A booking-time pair check; search lists the legs independently |
| R-FLT-12-09 | workbook (a) | A round trip is booked as one booking with two segments, one payment and one reference | ST | bookings schema (2 segments validated, #57) | - | Closed by R-FLT-22-05 (#59) | |
| R-FLT-12-10 | workbook (a) | A round trip is cancelled as a whole using the outbound segment's tier | DT | flight-bookings.service.ts (`cancellationQuote`: outbound terms of the PAY-02 snapshot, `releaseAll`: every segment) | flight-bookings.service.spec.ts (round trip cancelled as a whole on the outbound tier: FLT-12); test/flight-cancellation.e2e-spec.ts (round trip cancelled as a whole: FLT-12) | PASS (#72, #PR) | The return airline refunds 100% in the test, so only the outbound tier gives 50%; both segments get their seats back and infants release none |
| R-FLT-12-11 | contracts.md | FLIGHTS_SEARCH applies passenger types and the cabin filter for other modules, refuses `returnDate` instead of ignoring it, and refuses an unknown cabin class instead of returning an empty page | EP | flight-search.service.ts (`search`, `searchOneWay`) | flight-search-round-trip.e2e-spec.ts (contract: three cases) | PASS | |

### Independent review, 2026-11-14 (FLT-12, first commit)

One reviewer subagent (TypeScript correctness and test coverage) checked the first commit. It found no critical issue and confirmed the pricing, the seat logic and FLT-11/FLT-15 compatibility. The fixes are in the second commit.

| Finding | Severity | Resolution |
|---|---|---|
| A party error thrown in the controller hid the other errors; children without adults was reported on `passengers` | MEDIUM | Moved into DTO validation; reported on `adults` (R-FLT-12-05) |
| The round trip stopped at the first error and compared dates that might not exist | MEDIUM | Both legs run with `allSettled`, their errors are collected, and dates are compared only when both are valid (R-FLT-12-08, R-FLT-12-12) |
| A contract caller's unknown cabin class silently gave an empty page | MEDIUM | Validated in the service (R-FLT-12-11) |
| R-FLT-12-11 had no test for refusing `returnDate` | MEDIUM | Test added |
| Duplicate messages for one field; untested omitted or malformed returnDate, returnPage, return-list envelope and price filter with infants | LOW | One validator per count; tests added |
| "Return departs after outbound arrives" was missing | LOW | A booking rule, so it is now row R-FLT-12-13 (BLOCKED-BY FLT-22) |

## FLT-22 seat hold, FLT-19 passenger details, FLT-21 summary, TRVL-144 concurrency

| Rule | Source | Rule text | Technique | Code | Test | Verdict | Note |
|---|---|---|---|---|---|---|---|
| R-FLT-22-01 | workbook | Proceeding to payment atomically reserves the seats only if enough remain, creating one PENDING_PAYMENT booking held for 10 minutes | EP, BVA (holdExpiresAt = now + 10 min ± tolerance) | modules/bookings/flight-bookings.service.ts (`hold`), modules/flights/flight-inventory.service.ts (`reserveSeats`) | test/flight-hold.e2e-spec.ts | PASS | Seats change only through the FLIGHT_INVENTORY contract (owner module) |
| R-FLT-22-02 | workbook | More seated passengers than remain → 409 INSUFFICIENT_INVENTORY, nothing held | BVA (4 requested, 3 left) | `reserveSeats` conditional update | flight-hold.e2e-spec.ts | PASS | |
| R-FLT-22-03 | workbook | An unpaid hold becomes EXPIRED after 10 minutes and its seats are released exactly once, even when two expiry runs overlap | ST, BVA (1 ms before expiry vs after), CONC | `expireHolds`, booking-lifecycle.service.ts | flight-hold.e2e-spec.ts (hold expiry) | PASS | Release runs in the same transaction as the status-conditioned transition |
| R-FLT-22-04 | workbook, TRVL-144 | Concurrent requests never take more seats than exist: 20 parallel one-seat holds for the last 4 seats → exactly 4 succeed, 16 get 409, seats end at 0 | CONC (replica set) | `reserveSeats` | flight-hold.e2e-spec.ts (concurrency) | PASS | |
| R-FLT-22-05 | FLT-12 a | A round trip is held as one booking with two segments, all or nothing: if the return leg lacks seats, the outbound seats are untouched | CONC, DT | `hold` (one transaction) | flight-hold.e2e-spec.ts | PASS | Closes R-FLT-12-09 |
| R-FLT-22-06 | FLT-12 a | The return flight must be the reverse route and leave after the outbound lands (400 on `return`) | DT | `plan` | flight-hold.e2e-spec.ts | PASS | Closes R-FLT-12-13 |
| R-FLT-22-07 | FLT-12 b, FLT-19 | Each declared passenger type must match the date of birth on the departure date in the departure airport's zone (400 on `passengers[i].type`); at least one adult and no more infants than adults (400 on `passengers`) | BVA (2nd and 12th birthdays, leap day), EP | bookings/passenger-age.ts, `plan` | passenger-age.spec.ts; flight-hold.e2e-spec.ts | PASS | Closes R-FLT-12-04. The type is checked on each leg's own departure date; a passenger whose type changes between the legs is refused (book the flights separately). The 120-year limit uses the outbound date |
| R-FLT-19-01 | workbook | Passenger details: name, date of birth, passport/ID number (5-30 letters or digits) are required, with field errors | EP | dto/flight-booking.dto.ts | flight-hold.e2e-spec.ts | PASS | |
| R-FLT-19-02 | FLT-08, FLT-19 | Extra bags per passenger are limited by the airline maximum (0 when it sells none) and charged on each flight of the trip | BVA (max vs max + 1) | `plan` | flight-hold.e2e-spec.ts | PASS | Closes R-FLT-08-04 |
| R-FLT-21-01 | workbook | The summary before payment shows the flights, cabin, passengers, fares, infant fare, extra bags and total, and holds nothing. On a round trip each segment shows its own infant fare, so the lines add up to the total | EP | `quote` | flight-hold.e2e-spec.ts (quote; "own infant fare" uses unequal leg fares) | PASS | The quote and the hold share one validation and pricing path. Session 4 (SC-05): the summary showed only the outbound infant fare until the fix PR |
| R-ACC-11-BOLA-1 | ACC-11, OWASP API1 | GET /api/flight-bookings/:id and GET /api/hotel-bookings/:id answer another user's id with exactly the 404 body of an id that does not exist (no existence leak) | AUTHZ | `assertOwner` (`notFoundMessage`), `findOne` in both services | flight-hold.e2e-spec.ts; hotel-hold.e2e-spec.ts (owner and admin cases) | PASS | Session 4: "Resource not found" vs "Booking not found" let a stranger tell an id exists; fixed in #64 |
| R-FLT-22-08 | ACC-11 | A booking is visible to its owner and to an admin; anyone else gets 404 (no existence leak); holds are for registered users only (401 signed out, 403 admin) | AUTHZ (owner / other user / admin / guest) | flight-bookings.controller.ts, `findOne` | flight-hold.e2e-spec.ts | PASS | Real login cookies |
| R-FLT-22-09 | PAY-01 contract | The payable contract shows the booking only to its owner (404 otherwise, so ids are not revealed); confirmation needs an unexpired hold, assigns a FL- reference and confirmedAt, and a replayed confirmation is a no-op | ST, IDEM | `getPayable`, `markConfirmed` | flight-hold.e2e-spec.ts (PayableBooking) | PASS | A late webhook on an expired booking is refused with HOLD_EXPIRED; PAY-01 refunds it |
| R-FLT-11-06 | workbook | Search excludes seats held or booked | EP | flight-search.service.ts | flight-hold.e2e-spec.ts (FLT-11 case) | PASS | Was PARTIAL (only simulated decrements) |
| R-GEN-11-04 | workbook | PENDING_PAYMENT → EXPIRED when the hold times out, releasing inventory | ST | `expireHolds` (flights and hotels) | flight-hold.e2e-spec.ts; hotel-hold.e2e-spec.ts | PASS | Hotels added by HTL-18 (R-HTL-18-05) |
| R-FLT-22-10 | contracts.md | An FLT-05 schedule change must move the booking's startsAt/endsAt | - | - | - | BLOCKED-BY a follow-up on FlightScheduleNotifier | Until then a rescheduled trip completes on its original arrival time |
| R-FLT-22-11 | OWASP API6 | One account can have at most 3 unpaid (unexpired) holds; a fourth is a 409, so a script cannot pin a cabin. The cap holds under concurrency: 6 parallel holds by one account give exactly 3 | BVA (3 vs 4), CONC | bookings/hold-limit.ts `assertUnpaidHoldsBelowCap` (write the account's guard document, then count, inside the hold transaction) | flight-hold.e2e-spec.ts (abuse) | PASS | The first version counted before the transaction (check-then-act); the automated security review caught it and the concurrency test reproduced it (5 of 6 got through) |
| R-FLT-22-12 | ADR-0003 | A confirmation after the hold expired is refused with HOLD_EXPIRED, and expiring holds never releases the seats of a confirmed booking | ST | `markConfirmed`, `expireHolds` | flight-hold.e2e-spec.ts (late payments) | PASS | |
| R-FLT-19-03 | derived | Two passengers in one booking cannot share a document number (case-insensitive), and no passenger is older than 120 | EP, BVA | `plan` | flight-hold.e2e-spec.ts | PASS | |
| R-FLT-22-13 | FLT-12 b | A round-trip passenger whose type changes between the two flights (for example an infant who turns 2) is refused | BVA | `plan` (each leg's date) | test/vv/bookings.vv.e2e-spec.ts ("a round trip checks the type on each leg", #62) | PASS | Session 4: the cited unit spec had no such case; the HTTP case was added with #62 |

### Independent review, 2026-11-14 (FLT-22, first commit)

Two reviewer subagents (TypeScript correctness, silent failures) checked the first commit. Both confirmed the overbooking guarantee (one conditional `$inc`; reserve and insert in one transaction) and found no DI cycle. The fixes are in the second commit.

| Finding | Severity | Resolution |
|---|---|---|
| One failing booking stopped the expiry job for every hold behind it, every minute | HIGH | Each booking is expired in its own try/catch, logged with its id and stack; ordered by holdExpiresAt; a full batch logs a backlog warning |
| A seat release that matched no cabin was silently ignored | HIGH | `releaseSeats` returns whether it matched (contract updated) and the job logs the booking, flight and cabin |
| One account could pin a cabin with endless holds (API6) | HIGH | At most 3 unpaid holds per account (R-FLT-22-11) |
| The reference-collision retry inside the caller's transaction could not work, and three collisions gave a false HOLD_EXPIRED | MEDIUM | Inside a session the error is rethrown for the caller's transaction to retry; without one it ends in an explicit error |
| The expired count was incremented inside a retried transaction callback | MEDIUM | Counted after commit |
| The hold window started before transaction retries | MEDIUM | Starts when the seats are taken |
| A round-trip passenger could change type between the flights | MEDIUM | Checked on each leg (R-FLT-22-13) |
| `getPayable` answered 403 for another account's booking (existence oracle) | MEDIUM | 404, contract updated |
| Duplicate document numbers; impossible birth years; untested late confirmation | MEDIUM | Validated and tested (R-FLT-19-03, R-FLT-22-12) |
| "Not enough seats" also reported for a cancelled or removed flight; `markPaymentFailed` dropped its reason; the timer log had no stack and did not name the job | LOW | Accurate reasons; the reason is logged; each job is logged on its own with its stack |

**Deferred, with reasons:**
- The fare and the airline status are checked just before the transaction, not inside it. The window is milliseconds, and the seat check itself is atomic.
- Document numbers are shown in full to the booking's owner and to admins. Masking can follow with the M2 UI.
- Field errors are reported only after both flights resolve (a missing flight is a 404 first).

## FLT-26 flight cancellation with a tier refund, FLT-12(a) whole round trip (#72, #PR)

| Rule | Source | Rule text | Technique | Code | Test | Verdict | Note |
|---|---|---|---|---|---|---|---|
| R-FLT-26-01 | workbook | The owner sees the refund before cancelling; quoting changes nothing (no seats, no refund record) | EP | flight-bookings.service.ts (`refundQuote`), flight-bookings.controller.ts | test/flight-cancellation.e2e-spec.ts (one way) | PASS | |
| R-FLT-26-02 | workbook, FLT-09 | The refund is the amount paid times the tier with the highest daysBefore not exceeding the whole days left, from the policy accepted with the booking (PAY-02 snapshot), rounded down; 0% when no tier applies | BVA (exactly 7 days vs 1 ms less; 60 days; 0 days with a 0-day tier; 99 999 × 33%) | `cancellationQuote`, common/contracts/refunds.contract.ts (`computeRefundQuote`) | src/modules/bookings/flight-bookings.service.spec.ts (refund tiers at their boundaries: FLT-26) | PASS | The airline's current policy is never read |
| R-FLT-26-03 | workbook, GEN-11 | Cancelling moves CONFIRMED → CANCELLED with cancelledAt and cancelledBy USER, releases the seats, records one PENDING refund linked as refundId and sends one BOOKING_CANCELLED notice, all in one transaction | ST | bookings/booking-cancellation.ts (`cancelConfirmedBooking`) | booking-cancellation.spec.ts; flight-cancellation.e2e-spec.ts (one way) | PASS | Closes R-GEN-11-05 for flights |
| R-FLT-26-04 | workbook, PAY-03 | A 0% cancellation cancels the booking and releases the seats but records no refund; the notice says no refund applies | BVA (0%) | `cancelConfirmedBooking`, RefundsService.refundFor (null for 0) | booking-cancellation.spec.ts; flight-cancellation.e2e-spec.ts (0% tier) | PASS | |
| R-FLT-26-05 | workbook | No cancellation at or after departure: 409 CANCELLATION_WINDOW_CLOSED for the quote and the cancel, and the transition itself is conditioned on `startsAt > now` | BVA (departure − 1 ms vs departure), ST | `assertCancellable`, `cancelConfirmedBooking` | flight-bookings.service.spec.ts; flight-cancellation.e2e-spec.ts (after departure) | PASS | |
| R-FLT-26-06 | GEN-11 | Only a CONFIRMED booking can be cancelled: a pending hold or a second cancel is 409 BOOKING_NOT_CONFIRMED and releases, refunds and notifies nothing more | ST, IDEM | `assertCancellable`, transition guard | flight-cancellation.e2e-spec.ts (not Confirmed; second cancel) | PASS | |
| R-FLT-26-07 | TRVL-144 | Two parallel cancels: exactly one 200 and one 409; seats come back once, one refund, one notice | CONC (replica set) | status-conditioned transition in one transaction | flight-cancellation.e2e-spec.ts (two parallel cancels) | PASS | |
| R-FLT-26-08 | ACC-11 | Owner only: a stranger gets the same 404 as an unknown id; 401 signed out, 403 for another role (admin), 400 for a malformed id | AUTHZ | flight-bookings.controller.ts, `ownBooking` | flight-cancellation.e2e-spec.ts | PASS | Real login cookies |
| R-FLT-26-09 | derived | Infants sit on a lap, so cancelling gives back only the adult and child seats | EP | `releaseAll` | flight-cancellation.e2e-spec.ts (infants) | PASS | |
| R-FLT-26-10 | design | The cancel core is shared: HTL-21 and FLT-06 reuse `cancelConfirmedBooking`; a provider cancellation is not limited by startsAt and is recorded as PROVIDER | EP | booking-cancellation.ts | booking-cancellation.spec.ts | PASS | Hotel and provider callers land with HTL-21 and FLT-06 |

## HTL-16 multi-room reservation, HTL-18 room hold, TRVL-144 hotel concurrency (#60)

Nights are taken only through a new HOTEL_INVENTORY contract owned by the hotels module. Inside one transaction the hold writes each room (`$inc reservationVersion`, the HTL-05 contract), re-reads it, inserts one HELD room_nights document per room and night (unique `{roomId, date}`), and creates the reservation.

| Rule | Source | Rule text | Technique | Code | Test | Verdict | Note |
|---|---|---|---|---|---|---|---|
| R-HTL-16-01 | workbook | One reservation holds one or more rooms of the same hotel for the same dates, with adults and children per room | EP | modules/bookings/hotel-bookings.service.ts (`hold`), dto/hotel-booking.dto.ts | test/hotel-hold.e2e-spec.ts | PASS | Same dates for every room by construction (one checkIn/checkOut per request) |
| R-HTL-16-02 | workbook | Children are aged 0-17 (field error on `rooms[i].childrenAges`); at least one adult per reservation (400 on `rooms`), and a room may hold only children if another room has an adult | EP, BVA (0 and 17 accepted, 18 refused) | DTO, `plan` | hotel-hold.e2e-spec.ts | PASS | Each room also needs at least one guest (derived) |
| R-HTL-16-03 | workbook | No room's guests exceed its maximum occupancy (400 on `rooms[i]`) | BVA (max accepted, max + 1 refused) | `plan`, re-checked in the transaction | hotel-hold.e2e-spec.ts; hotel-bookings.service.spec.ts | PASS | Re-checked against the room read inside the transaction |
| R-HTL-16-04 | workbook, HTL-05 | Total = sum over rooms of nights x that room's price at booking time; the reservation keeps that price when the room price changes later | EP | `hold` (price read inside the transaction) | hotel-hold.e2e-spec.ts; hotel-bookings.service.spec.ts | PASS | Closes the HTL-05 "store the price" obligation |
| R-HTL-18-01 | workbook | All selected rooms are held together for 10 minutes as one PENDING_PAYMENT reservation, one HELD night per room and night | EP, BVA (holdExpiresAt = now + 10 min ± tolerance) | `hold`, hotels/hotel-inventory.service.ts (`holdNights`) | hotel-hold.e2e-spec.ts | PASS | |
| R-HTL-18-02 | workbook | If any room overlaps a confirmed reservation, an unexpired hold or a blocked night, the whole request is rejected (409 INSUFFICIENT_INVENTORY naming the nights) and nothing is held | DT (one case per overlap kind), EP | `holdNights` | hotel-hold.e2e-spec.ts (all or nothing) | PASS | A stay starting on another stay's check-out day is accepted (half-open nights) |
| R-HTL-18-03 | workbook | Check-out after check-in (400 on `checkOut`), at most 30 nights; check-in not before today in the hotel's time zone (400 on `checkIn`) | BVA (same day refused; local midnight in Cairo vs UTC) | DTO, `plan` | hotel-hold.e2e-spec.ts; hotel-bookings.service.spec.ts (today in the hotel zone, unit with a fixed clock); test/vv/bookings.vv.e2e-spec.ts (30 vs 31 nights, #62) | PASS | A hotel whose city has no known zone is refused (503, documented in Swagger since #63) rather than guessed. The 30-night limit is derived, not a workbook rule. Session 4: the 30/31 boundary had no test until #62 |
| R-HTL-18-04 | TRVL-144 | Parallel overlapping multi-room requests give exactly one reservation, and nothing is held partially: 8 parallel requests over rooms (C, D) and (D, E) → one 201, seven 409, exactly 6 nights in total | CONC (replica set) | `holdNights` (room write + unique index) | hotel-hold.e2e-spec.ts (TRVL-144) | PASS | |
| R-HTL-18-05 | workbook, GEN-11 | An unpaid hold becomes EXPIRED after 10 minutes and its nights are released exactly once, even when two expiry runs overlap; a late confirmation is refused with HOLD_EXPIRED | ST, CONC | `expireHolds`, booking-lifecycle.service.ts (`expireHotelHolds`) | hotel-hold.e2e-spec.ts (expiry) | PASS | Release runs in the same transaction as the status-conditioned transition Session 4: the e2e asserts the end state (Expired, nights 0, confirmation refused); the run count is `>= 1` because each run also expires stale holds from other tests in the shared database |
| R-HTL-18-06 | derived | An expired hold that the job has not swept yet does not block a new request: it is expired and released inside the new hold's transaction | ST | `expireStaleHolders` | hotel-hold.e2e-spec.ts; hotel-bookings.service.spec.ts | PASS | Removes up to a minute of sweeper lag |
| R-HTL-18-07 | HTL-04, HTL-06, ACC-15 | A night outside the room's bookable ranges, a deactivated room or a deactivated hotel is refused with 409 CONFLICT; an unknown hotel or a room of another hotel is 404 | DT | `getBookableStay`, `holdNights` | hotel-hold.e2e-spec.ts; hotel-bookings.service.spec.ts | PASS | Checked again inside the transaction after the room write |
| R-HTL-18-08 | HTL-05 contract | Every hold writes each room (`reservationVersion` + 1, `everReserved`), so it conflicts with a concurrent availability replace instead of interleaving | EP | `holdNights` | hotel-hold.e2e-spec.ts | PASS | |
| R-HTL-18-09 | ACC-11 | A reservation is visible to its owner and to an admin; anyone else gets 404; holds are for registered users only (401 signed out, 403 moderator) | AUTHZ | hotel-bookings.controller.ts, `findOne` | hotel-hold.e2e-spec.ts | PASS | Real login cookies |
| R-HTL-18-10 | OWASP API6 | One account can have at most 3 unpaid hotel holds; the cap is enforced inside the hold transaction | BVA (3 vs 4) | hold-limit.ts | hotel-hold.e2e-spec.ts | PASS | Flights and hotels share the account guard document, so all of one account's holds serialize |
| R-HTL-17-01 | workbook (part) | Confirmation sets Confirmed with a unique HT- reference, and every held night becomes BOOKED in the same transaction; a reservation with no held nights is never confirmed | ST, IDEM | `markConfirmed`, `bookNights` | hotel-hold.e2e-spec.ts; hotel-bookings.service.spec.ts | PASS | Notification and confirmation view: FLT-23/HTL-17 PR |
| R-HTL-17-02 | PAY-01 contract | The payable contract shows the reservation only to its owner (404 otherwise); a replayed confirmation is a no-op; a reference collision is retried | IDEM | `getPayable`, `markConfirmed` | hotel-hold.e2e-spec.ts; hotel-bookings.service.spec.ts | PASS | |

### Independent review, 2026-11-14 (HTL-16/18, first commit 6098620)

Two reviewer subagents (TypeScript correctness, silent failures) checked the first commit. Both confirmed the core design: the room write before the re-read makes concurrent holds and an HTL-05 replace conflict, the transaction callback is retry-safe, and expiry is exactly once. The fixes are in the second commit.

| Finding | Severity | Resolution |
|---|---|---|
| Confirmation accepted a partial set of booked nights (only 0 was refused), leaving unbooked nights sellable | HIGH | The reservation's rooms x nights must all become BOOKED, or the confirmation rolls back and is logged |
| The hotel name came from a live lookup on every read (an empty name if the hotel was gone; a reference-data failure became a 500) | HIGH | `hotelName` is stored on the reservation at hold time |
| A hotel with no known time zone was a 409 the user could not resolve, and nothing was logged | HIGH | 503 SERVICE_UNAVAILABLE plus an error log naming the hotel |
| A reference collision inside the caller's transaction was documented as retried by withTransaction, which never retries duplicate keys | MEDIUM | Docstrings and the PayableBooking contract now say the caller (PAY-01) re-runs its transaction; `isReferenceCollision` is shared (flights too) |
| Any duplicate key in confirmation was treated as a reference collision | MEDIUM | Only E11000 on the `reference` index is retried; the cause is kept |
| Upper-case hex ids passed IsMongoId but missed the lowercase lookups (false 404, duplicate check bypassed) | MEDIUM | Ids are normalised before planning |
| `now` was frozen across transaction retries for the cap and stale-hold checks | MEDIUM | The clock is re-read on every attempt |
| A stale holder that could not be expired, or a HELD night with no reservation, blocked rooms silently | MEDIUM | Both are logged with the rooms and nights |
| Expiry checked only for 0 released nights, without context | MEDIUM | Compared with rooms x nights and logged with the reservation |
| Confirmation did not write the rooms, so it could interleave with an availability replace | LOW | `bookNights` bumps `reservationVersion` like the hold does |
| A malformed payment id became a BSON 500 without context; "room undefined" could appear in a 409 | LOW | Explicit error; the room id is shown instead |

**Deferred, with reasons:**
- GET shows PENDING_PAYMENT for up to a minute after `holdExpiresAt`, until the job runs (flights behave the same). `holdExpiresAt` is in the response, and payment refuses an expired hold.
- A reservation that keeps failing to expire stays at the head of the batch. This matches flights; the backlog warning makes it visible.
- Occupancy is re-checked after the nights are inserted; a failure rolls the whole transaction back.

## PAY-02 policies before payment, PAY-04 single platform currency (#61)

The policies are read through the FLIGHT_INVENTORY and HOTEL_INVENTORY contracts, so the bookings module never reads airline or hotel documents directly. `assertPayable` (common/contracts/payment-gate.ts) is the one gate PAY-01 calls before charging.

| Rule | Source | Rule text | Technique | Code | Test | Verdict | Note |
|---|---|---|---|---|---|---|---|
| R-PAY-02-01 | workbook | Before payment the airline's cancellation and baggage policies are shown: each flight's cancellation tiers (FLT-09), extra-bag price and limit (FLT-08) and the booked cabin's free bags (FLT-04) | EP | modules/bookings/booking-policies.service.ts (`show`), flights/flight-inventory.service.ts (`getAirlinePolicy`) | test/booking-policies.e2e-spec.ts | PASS | One entry per flight, so a round trip shows both airlines |
| R-PAY-02-02 | workbook | For a hotel, its cancellation tiers (HTL-10) and check-in/check-out times (HTL-09) are shown | EP | `show`, hotels/hotel-inventory.service.ts (`getHotelPolicy`) | booking-policies.e2e-spec.ts | PARTIAL | The values are set directly in the test: on develop no endpoint sets a hotel's check-in/check-out times (HTL-09, #56 open) or its cancellation tiers (HTL-10). Live, a hotel shows `null` times and no tiers |
| R-PAY-02-03 | workbook | Acceptance needs the checkbox: `accepted` must be true (400 on `accepted`) | EP | dto/booking-policies.dto.ts | booking-policies.e2e-spec.ts | PASS | |
| R-PAY-02-04 | workbook | The acceptance is stored with a timestamp, together with a snapshot of the accepted terms; a repeat keeps the first time | EP, IDEM | `accept` (one conditional update) | booking-policies.e2e-spec.ts; booking-policies.service.spec.ts | PASS | PAY-03 refunds from the snapshot; closes the "typed policySnapshot" obligation |
| R-PAY-02-05 | derived | Terms that changed after they were shown are not accepted: `version` must match the current terms (409, nothing stored) | ST | `policiesVersion`, `accept` | booking-policies.e2e-spec.ts; payment-gate.spec.ts | PASS | Key-order independent fingerprint |
| R-PAY-02-06 | workbook | Payment is blocked until the policies are accepted (POLICIES_NOT_ACCEPTED), checked after the hold (an expired hold is HOLD_EXPIRED) | DT (status x hold x acceptance x currency) | common/contracts/payment-gate.ts (`assertPayable`), payments.service.ts | payment-gate.spec.ts; booking-policies.e2e-spec.ts; payments.e2e-spec.ts | PASS | POST /api/payments calls the gate (#62) |
| R-PAY-02-07 | ACC-11, GEN-11 | Only the owner sees or accepts (404 otherwise, wrong type included); only while PENDING_PAYMENT with time left (409 HOLD_EXPIRED / INVALID_STATE_TRANSITION); an unknown type is 400 on `type` | AUTHZ, ST | booking-policies.controller.ts, `load`, `assertAwaitingPayment` | booking-policies.e2e-spec.ts; booking-policies.service.spec.ts | PASS | |
| R-PAY-04-01 | workbook, TRVL-109 | PLATFORM_CURRENCY must be one of the seeded currencies (Countries.currency: AED, EGP, EUR, GBP, JPY, SAR, USD); startup fails otherwise | EP (each seeded code; CHF, a real but unseeded code, refused) | config/env.validation.ts (`PLATFORM_CURRENCIES`) | config/env.validation.spec.ts | PASS | A test keeps the list equal to seed/data/Countries.csv |
| R-PAY-04-02 | workbook | Bookings are priced and stored in PLATFORM_CURRENCY, and the payment gate refuses any other currency | DT | bookings services, `assertPayable` | payment-gate.spec.ts; booking-policies.e2e-spec.ts | PARTIAL | Payments and refunds go through the gate with PAY-01 and PAY-03 (SQ-10) |

### Independent review, 2026-11-14 (PAY-02/PAY-04, first commit f3d9cf6)

Two reviewer subagents (TypeScript correctness, silent failures) checked the first commit. Neither found a way to pay without accepting, or to accept terms that were not shown. The fixes are in the second commit.

| Finding | Severity | Resolution |
|---|---|---|
| A timestamp stored without terms passed the payment gate, and the service could not repair it | HIGH | `PayableSnapshot.policiesVersion`; the gate needs both; accepting again repairs it, and the defect is logged |
| A repeat accept with another version returned 200, claiming terms the user had not accepted | MEDIUM | Only an exact repeat is idempotent; another version is 409 POLICIES_CHANGED |
| "Terms changed" and "retry" shared the generic CONFLICT code | MEDIUM | New POLICIES_CHANGED code |
| A currency mismatch or a bad amount was a 409 the user could not fix | MEDIUM | A loud 500 naming the booking; never charged |
| A vanished provider gave the same unlogged 409 for four different causes | MEDIUM | The cause is logged with the booking |
| The terms were read in several queries | MEDIUM | One projected read of the booking |
| The type pipe accepted `constructor` and other inherited keys | LOW | Own keys only (400) |
| Airline tiers were not sorted, so a stored reorder changed the version | LOW | Sorted like the hotel tiers |

**Rebutted, with reasons:**
- *An airline or hotel without tiers is shown as "0% refund".* That is the defined rule (FLT-09, HTL-10: no tier means no refund on a user cancellation), and the empty list is shown explicitly before acceptance. Missing check-in/out times are shown as null until HTL-09 lands.
- *Terms of an inactive provider.* ACC-15 keeps existing bookings valid, so a hold made before deactivation can still be paid on the terms shown.
- *JPY has no minor unit.* `money.ts` uses each currency's ISO exponent, so JPY amounts are whole yen.

## PAY-01 Stripe payment within the hold, webhook-verified confirmation (#62)

Tests use an in-memory Stripe (no network) and the real signature check with events signed by the test secret. The live check is in Stripe test mode with the Stripe CLI (see the PR).

| Rule | Source | Rule text | Technique | Code | Test | Verdict | Note |
|---|---|---|---|---|---|---|---|
| R-PAY-01-01 | workbook | A registered user pays a Pending Payment booking within its hold with a test-mode PaymentIntent; only the client secret is returned, so card details go from Stripe Elements to Stripe and never reach the backend | EP | modules/payments/payments.service.ts (`create`), http-stripe-gateway.ts | test/payments.e2e-spec.ts; http-stripe-gateway.spec.ts | PASS | Amount = the booking's server-side total; test-mode key enforced by env validation |
| R-PAY-01-02 | workbook | The booking is confirmed only after a verified payment_intent.succeeded webhook: POST /api/payments leaves it Pending; a missing or forged signature is 400 and changes nothing | ST, EP | `handleWebhook`, stripe-signature.ts | payments.e2e-spec.ts; stripe-signature.spec.ts | PASS | HMAC over the raw body, constant-time, 5-minute tolerance (BVA at the edge) |
| R-PAY-01-03 | ADR-0003 | The event id is recorded in the same transaction as its effects: a replay is acknowledged and ignored; a failure rolls the id back and answers 500, so Stripe's redelivery is processed | IDEM, fault injection | `inTransaction`, `onSucceeded` | payments.e2e-spec.ts (replay, rollback) | PASS | |
| R-PAY-01-04 | workbook | On failure the error is recorded and shown (status FAILED, lastError); the user may retry with the same PaymentIntent until the hold expires (409 HOLD_EXPIRED after); if Stripe cancelled it meanwhile, a successor payment with a new id is returned | ST, BVA | `onFailed`, `retry` | payments.e2e-spec.ts | PASS | The booking stays Pending Payment while retrying |
| R-PAY-01-05 | workbook | When the hold expires the PaymentIntent is cancelled | ST | `cancelExpiredIntents`, payments-jobs.service.ts | payments.e2e-spec.ts; payments.service.spec.ts | PASS | One failure does not stop the batch; an intent Stripe already captured is applied by the job itself as a succeeded event (`reconcileEvent`), so it is refunded. The cancel call carries no idempotency key (Session 3, P-3) |
| R-PAY-01-06 | ADR-0003 | A payment captured after the hold expired does not confirm the booking and is refunded in full (refund reason HOLD_EXPIRED, 100%) | ST, fault injection | `onSucceeded`, `recordLateRefund`, `requestRefund` | payments.e2e-spec.ts | PASS | A transient or configuration refusal (outage, revoked key) leaves the refund PENDING and is logged; `retryPendingRefunds` re-sends it. A refusal about the charge itself (`charge_already_refunded`, `charge_disputed`, `charge_expired_for_capture`) closes it as FAILED with `failureReason` = Stripe's code (Session 4). Moving a sent refund to REFUNDED (refund webhooks) is PAY-03 |
| R-PAY-01-07 | workbook | Only the Stripe payment id, amount, currency and status are stored; no card data, no client secret | EP | schemas/payment.schema.ts | payments.e2e-spec.ts (stored keys); contracts-schemas.e2e-spec.ts | PASS (declared deviation) | The test pins the exact stored keys. Besides the four the workbook names, the document keeps only operational fields, none of them card data: the booking link (`bookingType`, `bookingId`, `userId`), `attempts`, `lastError`, `holdEndsAt`, `attemptStartedAt` (ignores stale failures), and `nextCheckAt` / `checkAttempts` (cancel-job backoff) |
| R-PAY-01-08 | ACC-11, derived | One payment per booking, even when "pay" is clicked twice at once; a payment is visible to its owner (with the client secret) and an admin (without it), 404 otherwise; the webhook is the only public route | CONC, AUTHZ | `create`, `load`, foundation.vv GEN-13 list | payments.e2e-spec.ts; foundation.vv.e2e-spec.ts | PASS | Same idempotency key gives the same PaymentIntent |
| R-PAY-01-09 | derived | A Stripe outage is a 503 the user can retry, never a raw 500; a malformed event is 400 | EP | `gateway`, `parseEvent` | payments.service.spec.ts | PASS | |
| R-FLT-23-01 | workbook (part) | After a successful payment the flight booking is Confirmed with a unique FL- reference | ST | `onSucceeded` -> FLIGHT_PAYABLE_BOOKING.markConfirmed | payments.e2e-spec.ts | PASS | Notification and e-ticket with FLT-23 |
| R-HTL-17-03 | workbook (part) | After a successful payment the reservation is Confirmed and its nights are BOOKED | ST | `onSucceeded` -> HOTEL_PAYABLE_BOOKING.markConfirmed | payments.e2e-spec.ts | PASS | Notification and confirmation view with FLT-23/HTL-17 |
| R-PAY-01-10 | review | A PaymentIntent cancelled while the hold is still valid does not block paying: a new one is created (the idempotency key includes the booking's payment count) | ST | `create`, `retry` | payments.e2e-spec.ts (review fixes) | PASS | |
| R-PAY-01-11 | review | A payment_failed event created before the current attempt is ignored (Stripe does not guarantee order) | ST | `onFailed` (attemptStartedAt) | payments.e2e-spec.ts | PASS | Compared at Stripe's one-second precision |
| R-PAY-01-12 | review | A late refund Stripe refused is re-sent by a job until Stripe has it; a capture whose webhook never came is applied by the cancel job | fault injection | `retryPendingRefunds`, `cancelExpiredIntents` | payments.e2e-spec.ts; payments.service.spec.ts | PASS | Same idempotency key, so a refund is never sent twice |
| R-PAY-01-13 | review | The captured amount and currency must match the payment, or nothing is confirmed (5xx); an unrecorded PaymentIntent naming one of our bookings is a 5xx, not a silent 200 | fault injection | `assertSameAmount`, `onSucceeded` | payments.e2e-spec.ts | PASS | |

### Independent review, 2026-11-14 (PAY-01, first commit 5232519)

Three reviewer subagents (security, TypeScript correctness, silent failures) checked the first commit. The security review found no CRITICAL or HIGH issue: the signature check, owner-only access, the client-secret handling and the gateway's input handling were confirmed sound. The fixes are in the second commit.

| Finding | Severity | Resolution |
|---|---|---|
| A late refund that Stripe refused, or that was lost in a crash, stayed PENDING forever (the event was already recorded) | CRITICAL | A job re-sends PENDING late refunds with no Stripe id (same idempotency key); the Stripe call and the database write fail separately and are logged separately |
| The cancel job always took the oldest 100 open payments, so unsettled ones could stall it | CRITICAL | Backoff per payment (`nextCheckAt`, 1 min doubling to 1 h); a PaymentIntent Stripe no longer has is closed; a capture is applied as the webhook would |
| A PaymentIntent cancelled while the hold was valid blocked the user (same idempotency key, dead client secret) | HIGH | The key includes the booking's payment count; a retry on a cancelled intent starts a new payment |
| Success overwrote any status and did not check the amount; a missing booking left captured money unrefunded | HIGH | Amount and currency are checked; NOT_FOUND also leads to the full refund; a CANCELED payment that was captured anyway is logged |
| Success for an unrecorded PaymentIntent was acknowledged silently | HIGH | A 5xx when it names one of our bookings (Stripe redelivers); a warning only for foreign intents |
| The late refund was upserted per booking, so it could be lost | HIGH | Keyed by payment |
| Stale or repeated payment_failed events | MEDIUM | Ignored when created before the current attempt; a repeat failure updates the record |
| `findOne` swallowed every error, needed Stripe for a read, and gave the client secret after the hold ended | MEDIUM | Only NOT_FOUND is tolerated (logged); the secret only while the hold has time left; a Stripe outage omits it |
| An intent created without its record (insert failure) | MEDIUM | Cancelled at once (best effort, logged) |
| Closure variables narrowed to null/never | MEDIUM | The webhook transaction helper is generic and returns its result |
| A payment_intent event without an intent id was accepted | MEDIUM | 400 |
| The client secret could be cached | LOW | `Cache-Control: no-store` |
| The fake Stripe ignored idempotency parameters and refund rules | LOW | It rejects a reused key with other parameters and a refund without a successful charge |

**Deferred, with reasons:**
- A captured-then-refunded payment keeps status SUCCEEDED. Stripe did capture it, and its refund record (reason HOLD_EXPIRED) shows the money going back. A REFUNDED payment status comes with PAY-03's refund views.
- Throttling create, retry and the webhook. The app has no rate limiter yet, so this is a cross-cutting follow-up.
- Comparing a delayed webhook with the event time instead of the processing time. Refunding is the fail-safe outcome.
- `markPaymentFailed` runs after commit. It only logs; the payments collection is the record.

### Session 3 re-verification, 2026-11-15 (PAY-01 fixes 553c32c and its review commit)

Read-only audits of #57 to #62 against the workbook and the Jira acceptance criteria. An independent verifier then confirmed each finding against the code and Stripe's documentation before it was fixed, test first.

| Finding | Severity | Resolution |
|---|---|---|
| PaymentIntents allowed redirect methods, so the documented `stripe payment_intents confirm <id> --payment-method pm_card_visa` fails without a `return_url` | HIGH | `automatic_payment_methods[allow_redirects]=never`: cards only, with 3-D Secure in a modal (http-stripe-gateway.spec.ts) |
| When saving the payment failed after Stripe created the intent, the intent was cancelled; the next attempt then got it back under the same idempotency key and stored a cancelled intent as payable, blocking the user until the hold ended (found by the review) | HIGH | The orphan intent is left alone. Its secret never left the server, and the next attempt records it (payments.service.spec.ts). This reverses the 2026-11-14 "cancel at once" row above |
| The PaymentIntent id was not in the response, so a Swagger demo had to cut it out of `clientSecret` | MEDIUM | `paymentIntentId` in PaymentDto. It is not a secret, and only the owner or an admin can read it (payments.e2e-spec.ts) |
| The cancel call used a fixed idempotency key; Stripe replays a key's first error for 24 hours | MEDIUM | No key. A repeat cancel returns `payment_intent_unexpected_state`, which is handled (http-stripe-gateway.spec.ts) |
| Every Stripe error became 503 "try again", including ones a retry can't fix | MEDIUM | Network, 429, 5xx and `idempotency_key_in_use` give 503. Any other rejection gives an explicit 500 INTERNAL_ERROR that never repeats Stripe's text (payments.service.spec.ts) |
| Retry on a PaymentIntent Stripe no longer has failed with 500 every time and blocked the booking (found by the review) | MEDIUM | Handled like a cancelled intent: the payment is closed and a new one started (payments.e2e-spec.ts) |
| The cancel job logged a rejection a retry can't fix (e.g. a revoked key) only as a warning (found by the review) | MEDIUM | Logged as an error with the payment and intent ids; the job still backs off (payments.service.spec.ts) |
| A 2xx answer with an unreadable body became a TypeError (found by the review) | MEDIUM | A retryable StripeApiError, 502 `network_error` (http-stripe-gateway.spec.ts) |
| Swagger did not list the 503 on create and retry, or the webhook's deliberate 500 | LOW | Documented |
| PAY-02 marked Done although no endpoint sets a hotel's times or tiers | Doc | Traceability set to Partial; R-PAY-02-02 is PARTIAL |
| ADR-0003 and R-PAY-01-05/06/07 described behaviour or names that don't exist | Doc | Corrected; the stored operational fields are listed as a declared deviation |

**Rebutted or deferred, with reasons:**
- The signature check rejects timestamps more than 5 minutes in the future as well as in the past. Stripe's libraries reject only old ones. Kept on purpose: `t` is inside the HMAC, so this costs nothing in security, and the spec asserts it.
- A Stripe error the user can't fix is logged twice: once in the gateway, with Stripe's code, and once in the exception filter, with the stack. This is cosmetic.
- Refunds that never leave PENDING (no `refund.*` webhook) belong to PAY-03, the next story.

### Session 4 V&V, 2026-11-15 (#57 to #63 re-verified after a compacted session)

**Method.** The baseline was `npm run verify` on develop with #62 and #63 merged: 815 unit and 686 e2e tests, all green. Four read-only reviewers then worked in parallel, each with its own lens: spec conformance, silent failures, security (OWASP API1/API5/API6) and rule-to-test traceability. An adversarial verifier re-read the code for each High or Medium claim and either confirmed or refuted it. Every confirmed defect got a failing test before its fix.

| Finding | Severity | Resolution |
|---|---|---|
| EH-2: A late refund that Stripe refuses permanently (e.g. `charge_already_refunded`) was re-sent every minute forever | MEDIUM | Only a refusal about the charge itself closes the refund as FAILED (logged once). An outage or a configuration error (401/403) stays PENDING so the refund is sent once fixed; the review of the first fix (R1, HIGH) caught that closing on every 4xx would strand money after a key rotation. `failureReason` stores Stripe's code, never its text (R2) (payments.service.spec.ts "EH-2", "R1") |
| SEC-R1: after R1, a refund that keeps failing for a non-terminal reason was re-sent every minute, and enough of them could fill the job's batch of 100 and starve newer refunds (automated security review of 2a26112) | MEDIUM | Per-refund back-off: `nextAttemptAt`, 1 minute doubling to 1 hour, with a `sendAttempts` count; the job picks only refunds whose back-off has passed (payments.service.spec.ts "only picks refunds whose back-off has passed"; payments.e2e-spec.ts) |
| EH-3: When Stripe could not return the open payment's client secret, `POST /api/payments` (201) and retry (200) answered without one, and the user could not pay | MEDIUM | Create and retry go through the gateway: 503 or 500. A plain `GET` still answers without the secret (payments.service.spec.ts "EH-3") |
| EH-4: A capture the cancel job could not apply (our own error, e.g. a nights mismatch) was only a warning without a stack | MEDIUM | Logged as an error with the payment, intent and booking ids and the stack (payments.service.spec.ts "EH-4") |
| EH-5: A refused webhook signature was not logged, so a wrong `STRIPE_WEBHOOK_SECRET` failed every confirmation silently | MEDIUM | A warning without secrets or the body (payments.service.spec.ts "EH-5") |
| EH-6: Stripe failure logs named no operation, and a failed retry said the payment "could not be started" | LOW | The log names the operation and its ids; the 500 says the provider refused the request (payments.service.spec.ts "EH-6") |
| SC-01: Swagger did not list the deliberate 500 on create and retry, and ADR-0003 said nothing about the 503/500 split | Doc | Both are documented (amendment 2026-11-15) |
| SC-02: Swagger, ADR-0003 and R-PAY-01-04 said retry always reuses the same PaymentIntent, but a cancelled intent gets a successor payment with a new id | Doc | All three now describe the successor and tell clients to use the id returned by retry |
| Acceptance gaps (pr-test-analyzer) | - | New black-box suite test/vv/bookings.vv.e2e-spec.ts (13 cases): age boundaries at exactly 2 and 12 on the travel date; 1 adult + 1 infant = 1 seat and 10%; an infant who turns 2 between legs; 30 vs 31 nights; hotel pay before accept; the cross-user 404 matrix over 7 routes compared with an unknown id; 5 parallel deliveries of one event; a capture in another currency |

**Review of the fix commit (cdd4fca).** A reviewer subagent re-read only the fix: R1 (HIGH) and R2 are above. R3 corrected R-PAY-01-06. R4-R6 tightened the acceptance suite: a parallel-webhook loser is shown to be recoverable by a redelivery; the wrong-currency case asserts the deliberate 500 with nothing recorded or refunded; the ownership matrix compares whole bodies with those for an unknown id. That last check found **BOLA-1 (LOW)**: `GET /api/flight-bookings/:id` and `GET /api/hotel-bookings/:id` answer "Resource not found" for another user's id but "Booking not found" / "Reservation not found" for an unknown one, so a stranger can tell an id exists. This is merged code (#59, #60), fixed in #64; the other five routes return identical bodies.

**Refuted or deferred, with reasons:**
- R7: a retry of a payment still awaiting the card whose PaymentIntent Stripe has cancelled answers 500 (`resource_missing`) or an unusable secret. Only the FAILED branch starts a successor. This existed before Session 4, and the cancel job closes such payments, so it is deferred and documented here.
- EH-4's amount-mismatch case cannot occur on the reconcile path: the synthetic event carries no amount. Comparing the amount there is SC-03 (Low), deferred.
- EH-1, refund outcomes never leaving PENDING, is PAY-03 scope, as recorded above.
- SEC-1, rate limiting, is cross-cutting, as recorded above.
- SEC-2: an admin sees passenger documents through `GET /api/flight-bookings/:id`. This is intended by ACC-17 (read-only admin views).
- SC-04: a second success for the same booking would hit the unique index. No normal path reaches it, so it is deferred.
- SC-06: `lastError` shows Stripe's decline message, which PAY-01 requires to be shown.
- 201 for a reused payment: documented, not changed.
- SC-05 (a round-trip quote shows only the outbound infant fare) and the overclaimed rows R-FLT-22-13, R-HTL-18-03 and R-HTL-18-05 are in merged code. They are handled in the separate fix PR.

## Session 3 re-verification of #57 to #61 (2026-11-15, #63)

A read-only audit compared every clause of GEN-11, FLT-11, FLT-12, FLT-19, FLT-21, FLT-22, HTL-16 and HTL-18 with the code and tests. An independent verifier confirmed each finding before it was fixed, test first. No lifecycle or overbooking defect was found: the 5x5 transition guard is the only status writer, and the 20->4 seat and 8->1 room races hold.

| Rule | Source | Rule text | Technique | Code | Test | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| R-FLT-19-01 | workbook (FLT-19, FLT-08) | Extra baggage is entered as bags **and weight** per passenger: `extraBagsWeightKg` (total kg) is required with `extraBags`, refused without them, and at most `extraBags x` the cabin's kg per bag on every flight of the trip (400 on `passengers[i].extraBagsWeightKg`) | EP, BVA (46 kg vs 47 kg for 2 x 23 kg), DT (round trip with a lower limit on the return) | dto/flight-booking.dto.ts, `plan`, flights/flight-inventory.service.ts (`maxKgPerBag`) | flight-bookings.service.spec.ts; flight-hold.e2e-spec.ts | PASS | The fee stays per bag (FLT-08). At least 1 kg per bag (derived). The weight is stored on the passenger and shown in the quote and booking |
| R-FLT-19-02 | derived | A date of birth after today is refused, even when it is before the flight (400 on `passengers[i].dateOfBirth`) | BVA | `plan` (`latestToday`, UTC+14 so a baby born today anywhere is accepted) | flight-bookings.service.spec.ts; flight-hold.e2e-spec.ts | PASS | Before #63 an unborn infant could be booked, and the Swagger example used one (`2027-01-15`), which would fail for any flight before that date |

| Finding | Severity | Resolution |
|---|---|---|
| FLT-19 "bags and weight": only a bag count was accepted | HIGH | R-FLT-19-01 |
| The Swagger infant example was born in 2027, so it fails for any flight before 2027-01-15 (the evaluation is on 2026-11-20); unborn passengers were accepted | HIGH | Example `2025-12-01`; R-FLT-19-02 |
| `POST /api/hotel-bookings` can answer 503 (a hotel whose city has no zone) but Swagger did not list it | LOW | Documented |
| A unit test title said 403 where the code and assertion say 404 | LOW | Renamed |
| Stale rows: R-GEN-11-04 and R-FLT-12-04/09/13 still BLOCKED; R-FLT-22-07, R-FLT-22-09 and R-HTL-18-03 contradicted the code | Doc | Corrected above |

**Independent review of the first #63 commit (TypeScript and test-coverage reviewers):**

| Finding | Severity | Resolution |
|---|---|---|
| The README demo called the payment routes, which reach develop only with #62 | HIGH (docs) | The step names PAY-01 (#62) |
| The stored weight was never read back, and the born-today and UTC+14 edges, the DTO's 0/-1/1.5 refusals and "exactly at the lower return limit" were untested | MEDIUM | Tests added: GET reads the weight back, the hold stores it, a baby born today passes and one born tomorrow fails, the UTC+14 day, the DTO refusals and 40 kg for 2 x 20 kg |
| 5 extra bags weighing 1 kg in total were accepted | LOW | At least 1 kg per bag (derived rule) |
| The schema typed the weight `?: number` but stored `null` | LOW | `number \| null`, default null |

**Recorded, not changed (spec questions or deferrals, listed in report.md):**
- Flight holds are released by the minute job, so for up to 60 s after a hold ends its seats still count as held. Hotels clear stale holds inside the next hold's transaction.
- A FLT-05 reschedule does not move a booking's `startsAt`/`endsAt` (R-FLT-22-10).
- Extra bags are charged on each flight of a round trip.
- A hotel whose city has no airport cannot be booked, because the hotel's zone comes from the city's airports. Every seeded city has an airport.
