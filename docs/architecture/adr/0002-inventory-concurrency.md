# ADR-0002: Concurrency-safe inventory with atomic updates and unique room-nights

- Status: Accepted. Implemented in FLT-22 and HTL-18 (Ahmed), tested in TRVL-144.
- Requirements: FLT-22, HTL-18, HTL-16, GEN-11. Brief sections 6.2, 6.3 and 8.4.

## Context
Concurrent requests must never book more seats than exist, or the same room for overlapping nights. A multi-room hotel request is all-or-nothing. Holds last 10 minutes and then release inventory.

## Decision
**Flights (FLT-22):** reserve seats with a single conditional atomic update on the embedded cabin:
```js
updateOne(
  { _id: flightId, status: 'SCHEDULED', cabins: { $elemMatch: { class, seatsAvailable: { $gte: n } } } },
  { $inc: { 'cabins.$.seatsAvailable': -n } },
)
```
`modifiedCount === 0` means not enough seats, which returns 409 `INSUFFICIENT_INVENTORY`. The check and the decrement are one document operation, so no race is possible without a transaction.

**Hotels (HTL-18):** each held or booked night is a `room_nights` document with a **unique index on {roomId, date}**. A reservation inserts every night for every selected room inside one **transaction** (Atlas is a replica set). Any duplicate-key error aborts the whole transaction, so nothing is held. Blocked ranges and confirmed nights are checked in the same transaction.

**Holds:** bookings are created `PENDING_PAYMENT` with `holdExpiresAt = now + 10 min`. A scheduled sweeper (every minute) moves expired holds to `EXPIRED` with a status-conditioned update. It restores seats with `$inc` or deletes the hold's `room_nights`, and cancels the PaymentIntent (PAY-01). Payment confirmation re-checks `holdExpiresAt` and the status atomically, so a late webhook cannot confirm an expired booking.

## Consequences
- Correctness comes from the database (atomic update or unique index), not from application locks. This holds with any number of API instances.
- Tests run on an in-memory **replica set** so the transaction path is exercised in CI. TRVL-144 adds parallel-request tests.
