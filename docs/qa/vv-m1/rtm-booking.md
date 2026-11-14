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
