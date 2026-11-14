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
| R-GEN-11-04 | workbook | PENDING_PAYMENT→EXPIRED when the 10-minute hold times out, releasing the inventory | ST, BVA | - | - | BLOCKED-BY FLT-22, HTL-18 | |
| R-GEN-11-05 | workbook | CONFIRMED→CANCELLED on a user or provider cancellation | ST | - | - | BLOCKED-BY the cancellation stories | |
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
| R-FLT-12-04 | workbook (b) | The passenger type is validated against the date of birth | BVA | - | - | BLOCKED-BY FLT-19 / FLT-22 | Search has no DOB |
| R-FLT-12-05 | derived (FLT-11 compatibility) | Give either the FLT-11 `passengers` count (all adults) or adults/children/infants, never both and never neither; children or infants without adults is reported on `adults`. All of these are DTO errors, reported with the other format errors | DT (both / neither / passengers only / typed only / typed without adults) | dto/flight-search.dto.ts (`ValidateIf`, `NotWithTypedCounts`, `IsCount`) | flight-search-round-trip.e2e-spec.ts; flight-search.e2e-spec.ts (FLT-11 unchanged) | PASS | |
| R-FLT-12-06 | workbook (c) | An optional cabin-class filter keeps only that cabin; an unknown class is a 400 on cabinClass | EP | flight-search.service.ts | flight-search-round-trip.e2e-spec.ts | PASS | |
| R-FLT-12-07 | workbook (a) | Round-trip search returns outbound and return options for the same party and cabin, each paginated (page, returnPage) | EP | flight-search.service.ts (`searchRoundTrip`), flights.controller.ts | flight-search-round-trip.e2e-spec.ts | PASS | |
| R-FLT-12-08 | derived | returnDate must be given, well-formed, a real date and on or after departureDate (a same-day return is allowed); the order is compared only when both dates are real; returnPage is a whole number of at least 1 | BVA (D-1, D, D+7; 2028-02-30; returnPage 0, 999) | searchRoundTrip | flight-search-round-trip.e2e-spec.ts | PASS | |
| R-FLT-12-12 | GEN-02 | Every validation layer reports all of its errors at once: semantic errors of both legs (unknown airport, impossible date, party rule) come back together; one message per field | EP | flight-search.service.ts (`searchRoundTrip` via `allSettled`; calendar check also when the airport is unknown) | flight-search-round-trip.e2e-spec.ts | PASS | Also closes an FLT-11 gap: an impossible date was hidden behind an unknown airport |
| R-FLT-12-13 | derived (booking) | The return segment must depart after the outbound arrives | DT | - | - | BLOCKED-BY FLT-22 | A booking-time pair check; search lists the legs independently |
| R-FLT-12-09 | workbook (a) | A round trip is booked as one booking with two segments, one payment and one reference | ST | bookings schema (2 segments validated, #57) | - | BLOCKED-BY FLT-22 | |
| R-FLT-12-10 | workbook (a) | A round trip is cancelled as a whole using the outbound segment's tier | DT | - | - | BLOCKED-BY the cancel stories / PAY-03 | |
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
| R-FLT-22-07 | FLT-12 b, FLT-19 | Each declared passenger type must match the date of birth on the departure date in the departure airport's zone (400 on `passengers[i].type`); at least one adult and no more infants than adults (400 on `passengers`) | BVA (2nd and 12th birthdays, leap day), EP | bookings/passenger-age.ts, `plan` | passenger-age.spec.ts; flight-hold.e2e-spec.ts | PASS | Closes R-FLT-12-04. The outbound date is used for both legs of a round trip |
| R-FLT-19-01 | workbook | Passenger details: name, date of birth, passport/ID number (5-30 letters or digits) are required, with field errors | EP | dto/flight-booking.dto.ts | flight-hold.e2e-spec.ts | PASS | |
| R-FLT-19-02 | FLT-08, FLT-19 | Extra bags per passenger are limited by the airline maximum (0 when it sells none) and charged on each flight of the trip | BVA (max vs max + 1) | `plan` | flight-hold.e2e-spec.ts | PASS | Closes R-FLT-08-04 |
| R-FLT-21-01 | workbook | The summary before payment shows the flights, cabin, passengers, fares, infant fare, extra bags and total, and holds nothing | EP | `quote` | flight-hold.e2e-spec.ts (quote) | PASS | The quote and the hold share one validation and pricing path |
| R-FLT-22-08 | ACC-11 | A booking is visible to its owner and to an admin; anyone else gets 404 (no existence leak); holds are for registered users only (401 signed out, 403 admin) | AUTHZ (owner / other user / admin / guest) | flight-bookings.controller.ts, `findOne` | flight-hold.e2e-spec.ts | PASS | Real login cookies |
| R-FLT-22-09 | PAY-01 contract | The payable contract shows the booking only to its owner (403 otherwise); confirmation needs an unexpired hold, assigns a FL- reference and confirmedAt, and a replayed confirmation is a no-op | ST, IDEM | `getPayable`, `markConfirmed` | flight-hold.e2e-spec.ts (PayableBooking) | PASS | A late webhook on an expired booking is refused with HOLD_EXPIRED; PAY-01 refunds it |
| R-FLT-11-06 | workbook | Search excludes seats held or booked | EP | flight-search.service.ts | flight-hold.e2e-spec.ts (FLT-11 case) | PASS | Was PARTIAL (only simulated decrements) |
| R-GEN-11-04 | workbook | PENDING_PAYMENT → EXPIRED when the hold times out, releasing inventory | ST | `expireHolds` (flights and hotels) | flight-hold.e2e-spec.ts; hotel-hold.e2e-spec.ts | PASS | Hotels added by HTL-18 (R-HTL-18-05) |
| R-FLT-22-10 | contracts.md | An FLT-05 schedule change must move the booking's startsAt/endsAt | - | - | - | BLOCKED-BY a follow-up on FlightScheduleNotifier | Until then a rescheduled trip completes on its original arrival time |
| R-FLT-22-11 | OWASP API6 | One account can have at most 3 unpaid (unexpired) holds; a fourth is a 409, so a script cannot pin a cabin. The cap holds under concurrency: 6 parallel holds by one account give exactly 3 | BVA (3 vs 4), CONC | bookings/hold-limit.ts `assertUnpaidHoldsBelowCap` (write the account's guard document, then count, inside the hold transaction) | flight-hold.e2e-spec.ts (abuse) | PASS | The first version counted before the transaction (check-then-act); the automated security review caught it and the concurrency test reproduced it (5 of 6 got through) |
| R-FLT-22-12 | ADR-0003 | A confirmation after the hold expired is refused with HOLD_EXPIRED, and expiring holds never releases the seats of a confirmed booking | ST | `markConfirmed`, `expireHolds` | flight-hold.e2e-spec.ts (late payments) | PASS | |
| R-FLT-19-03 | derived | Two passengers in one booking cannot share a document number (case-insensitive), and no passenger is older than 120 | EP, BVA | `plan` | flight-hold.e2e-spec.ts | PASS | |
| R-FLT-22-13 | FLT-12 b | A round-trip passenger whose type changes between the two flights (for example an infant who turns 2) is refused | BVA | `plan` (each leg's date) | flight-bookings.service.spec.ts | PASS | |

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
| R-HTL-18-03 | workbook | Check-out after check-in (400 on `checkOut`), at most 30 nights; check-in not before today in the hotel's time zone (400 on `checkIn`) | BVA (same day refused; local midnight in Cairo vs UTC) | DTO, `plan` | hotel-hold.e2e-spec.ts; hotel-bookings.service.spec.ts | PASS | A hotel whose city has no known zone is refused (409) rather than guessed |
| R-HTL-18-04 | TRVL-144 | Parallel overlapping multi-room requests give exactly one reservation, and nothing is held partially: 8 parallel requests over rooms (C, D) and (D, E) → one 201, seven 409, exactly 6 nights in total | CONC (replica set) | `holdNights` (room write + unique index) | hotel-hold.e2e-spec.ts (TRVL-144) | PASS | |
| R-HTL-18-05 | workbook, GEN-11 | An unpaid hold becomes EXPIRED after 10 minutes and its nights are released exactly once, even when two expiry runs overlap; a late confirmation is refused with HOLD_EXPIRED | ST, CONC | `expireHolds`, booking-lifecycle.service.ts (`expireHotelHolds`) | hotel-hold.e2e-spec.ts (expiry) | PASS | Release runs in the same transaction as the status-conditioned transition |
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
| R-PAY-02-02 | workbook | For a hotel, its cancellation tiers (HTL-10) and check-in/check-out times (HTL-09) are shown | EP | `show`, hotels/hotel-inventory.service.ts (`getHotelPolicy`) | booking-policies.e2e-spec.ts | PASS | Values set directly in the test until the HTL-09/HTL-10 endpoints land |
| R-PAY-02-03 | workbook | Acceptance needs the checkbox: `accepted` must be true (400 on `accepted`) | EP | dto/booking-policies.dto.ts | booking-policies.e2e-spec.ts | PASS | |
| R-PAY-02-04 | workbook | The acceptance is stored with a timestamp, together with a snapshot of the accepted terms; a repeat keeps the first time | EP, IDEM | `accept` (one conditional update) | booking-policies.e2e-spec.ts; booking-policies.service.spec.ts | PASS | PAY-03 refunds from the snapshot; closes the "typed policySnapshot" obligation |
| R-PAY-02-05 | derived | Terms that changed after they were shown are not accepted: `version` must match the current terms (409, nothing stored) | ST | `policiesVersion`, `accept` | booking-policies.e2e-spec.ts; payment-gate.spec.ts | PASS | Key-order independent fingerprint |
| R-PAY-02-06 | workbook | Payment is blocked until the policies are accepted (POLICIES_NOT_ACCEPTED), checked after the hold (an expired hold is HOLD_EXPIRED) | DT (status x hold x acceptance x currency) | common/contracts/payment-gate.ts (`assertPayable`) | payment-gate.spec.ts; booking-policies.e2e-spec.ts | PARTIAL | The gate passes its decision table; PAY-01's POST /api/payments must call it |
| R-PAY-02-07 | ACC-11, GEN-11 | Only the owner sees or accepts (404 otherwise, wrong type included); only while PENDING_PAYMENT with time left (409 HOLD_EXPIRED / INVALID_STATE_TRANSITION); an unknown type is 400 on `type` | AUTHZ, ST | booking-policies.controller.ts, `load`, `assertAwaitingPayment` | booking-policies.e2e-spec.ts; booking-policies.service.spec.ts | PASS | |
| R-PAY-04-01 | workbook, TRVL-109 | PLATFORM_CURRENCY must be one of the seeded currencies (Countries.currency: AED, EGP, EUR, GBP, JPY, SAR, USD); startup fails otherwise | EP (each seeded code; CHF, a real but unseeded code, refused) | config/env.validation.ts (`PLATFORM_CURRENCIES`) | config/env.validation.spec.ts | PASS | A test keeps the list equal to seed/data/Countries.csv |
| R-PAY-04-02 | workbook | Bookings are priced and stored in PLATFORM_CURRENCY, and the payment gate refuses any other currency | DT | bookings services, `assertPayable` | payment-gate.spec.ts; booking-policies.e2e-spec.ts | PARTIAL | Payments and refunds go through the gate with PAY-01 and PAY-03 (SQ-10) |
