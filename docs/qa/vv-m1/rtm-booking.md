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
| R-GEN-11-02 | contracts.md | Every status change is conditioned on the current status (`{_id, status: from}`), so of two concurrent writers only one moves the booking. The loser gets `false` | ST, CONC (unit) | booking-transition.ts | booking-transition.spec.ts ("no longer in the expected state") | PASS | Real-DB race proof comes with FLT-22 / TRVL-144 |
| R-GEN-11-03 | workbook | CONFIRMED→COMPLETED once the trip has ended (last arrival; check-out day in the hotel's zone). PENDING and future trips are untouched, and a second run changes nothing | ST, BVA (endsAt = now) | src/modules/bookings/booking-lifecycle.service.ts | test/bookings-lifecycle.e2e-spec.ts (completion job) | PASS | |
| R-GEN-11-04 | workbook | PENDING_PAYMENT→EXPIRED when the 10-minute hold times out, releasing the inventory | ST, BVA | - | - | BLOCKED-BY FLT-22, HTL-18 | |
| R-GEN-11-05 | workbook | CONFIRMED→CANCELLED on a user or provider cancellation | ST | - | - | BLOCKED-BY the cancellation stories | |
| R-GEN-11-06 | derived | The schemas refuse a status outside the lifecycle and a non-integer amount (ADR-0004) | EP | src/modules/bookings/schemas/*.ts | bookings-lifecycle.e2e-spec.ts (schemas) | PASS | |
| R-TRVL139-01 | ERD | The booking reference is unique once assigned, and many unconfirmed bookings may have none | EP | schemas/booking-fields.ts (partial unique index) | bookings-lifecycle.e2e-spec.ts (schemas) | PASS | A `sparse` index would have rejected the second null |
| R-ACC-12-02 | workbook | Self-deactivation is refused with 409 UPCOMING_BOOKINGS_EXIST while a Confirmed trip has not started. The count covers flights and hotels and ignores Pending, Cancelled, past and other users' bookings | EP, AUTHZ (real cookie) | src/modules/bookings/booking-queries.service.ts | bookings-lifecycle.e2e-spec.ts (UPCOMING_BOOKINGS) | PASS | Was BLOCKED-BY the bookings module |
| R-FLT-05-08a | workbook | A flight's Confirmed bookings, with the account to notify, are found for schedule-change notifications | EP | booking-queries.service.ts | bookings-lifecycle.e2e-spec.ts (FLIGHT_BOOKINGS_LOOKUP) | PASS | Sending the notification still needs GEN-01 |
