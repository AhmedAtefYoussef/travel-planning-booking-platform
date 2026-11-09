# ADR-002: Inventory concurrency for flights and hotels

Status: Accepted (Milestone 1). Requirements: FLT-22, HTL-18.

## Context

Two users can try to book the last seat or the same room at the same moment. A "check, then write" sequence in application code would oversell. A booking stays unpaid for up to 10 minutes, so inventory must be held and then either confirmed or released.

## Decision

- Flights: the availability of a cabin is `seats - booked - held`. A hold is one atomic conditional `$inc` on the cabin (`held += n` only if available >= n); zero matched documents means no seats (409).
- Hotels: a booking inserts one `room_nights` document per room per night (`kind` HELD, later BOOKED) inside a Mongo transaction. The unique index `{roomId, date}` rejects any overlap, so a multi-room request succeeds or fails as a whole. Owner-blocked dates use `kind` BLOCKED in the same collection.
- Holds expire 10 minutes after creation (`holdExpiresAt`). A `@nestjs/schedule` job runs every 30 seconds: it marks unpaid bookings EXPIRED, releases held seats or `room_nights`, and cancels the PaymentIntent.
- Transactions need a replica set: MongoDB Atlas in production and a `mongodb-memory-server` replica set in the e2e tests.

## Consequences

- Correctness comes from the database (atomic update, unique index), not from locks in Node, so it holds with several API instances.
- The release job is the only path that frees abandoned holds, so lag is up to about 30 seconds beyond the 10-minute hold. Payment and confirmation endpoints must also check `holdExpiresAt` themselves.
- Hotel storage grows with rooms times nights. This is fine at project scale and keeps overlap checks index-backed.
