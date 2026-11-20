# Swagger evidence: endpoints without screenshots before 2026-11-20

These screenshots cover every Milestone 1 endpoint (project description section 8) that had no evidence on the former per-member branches.

## How they were taken
- **When and what:** 20 Nov 2026, real Swagger UI "Try it out → Execute" runs at `http://localhost:3000/api/docs`. The backend was `develop` plus the open PRs #131 (GEN-10 comment moderation), #132 (ITN-25/26) and #133 (ACC-12).
- **Database:** a throwaway in-memory MongoDB replica set, loaded with `npm run seed` and `npm run seed:demo`. The shared team Atlas database was not touched.
- **Accounts:** real cookie login (`AUTH_STUB=false`) as the seeded admin, the demo airline and hotel moderators and the demo traveller, plus a second traveller registered during the run.
- **Payments:** in Stripe test mode. The traveller's bookings were confirmed only after the PaymentIntent succeeded and `stripe listen` forwarded the webhook (PAY-01). Cancelling a hotel reservation produced a Stripe refund (PAY-03).
- **One database edit:** reviews (HTL-23) need a Completed stay. A stay becomes Completed only after its check-out date, so the single reservation `HT-92165CD8` was moved to past dates and status COMPLETED directly in the database before the review was submitted. Nothing else was edited outside the API.

## Files
| Folder | Endpoints shown |
|---|---|
| `acc-06/` | `POST /api/auth/logout` 204 |
| `acc-07a/` | `POST /api/admin/users/{id}/reset-password` 204, as admin |
| `acc-08/` | `PATCH /api/auth/change-password` 204 |
| `acc-09/` | `PATCH /api/users/me`: phone and preferred currency, 200 |
| `acc-17/` | `GET /api/admin/bookings?from&to`: flight and hotel bookings, 200 |
| `flt-06/` | `POST /api/flights/{id}/cancel`: DM102 cancelled, 200 |
| `flt-25/` | `GET /api/flight-bookings`, `GET /api/flight-bookings/{id}`, 200 |
| `flt-29/` | `GET /api/flights/{id}/bookings`; `GET /api/flights/{id}/passengers/export` (CSV attachment), 200 |
| `gen-09/` | `POST /api/reports` on a COMMENT, 201 |
| `gen-10/` | `GET /api/admin/reports` 200; `PATCH /api/admin/reports/{id}` HIDE 200; `DELETE /api/admin/content/comment/{id}` 200 |
| `htl-20/` | `GET /api/hotel-bookings`, `GET /api/hotel-bookings/{id}`, 200 |
| `htl-21/` | `POST /api/hotel-bookings/{id}/cancel`: CANCELLED with a PENDING Stripe refund, 200 |
| `htl-22/` | `GET /api/hotels/{id}/reservations`, as the hotel moderator, 200 |
| `htl-23/` | `POST /api/hotel-bookings/{id}/review` 201; `PATCH /api/reviews/{id}` 200; `DELETE /api/reviews/{id}` 204 |
| `htl-24/` | `GET /api/hotels/{id}/reviews`: average, count, newest first, 200 |
| `itn-01/` | `POST /api/itineraries` 201; `DELETE /api/itineraries/{id}` 204 |
| `itn-03/` | `GET /api/itineraries`, `GET /api/itineraries/{id}`, 200 |
| `itn-05/` | `POST /api/itineraries/{id}/days` 201; `PATCH /api/itineraries/{id}/days/{dayId}` 200 |
| `itn-07/` | `DELETE /api/itineraries/{id}/days/{dayId}`: days renumbered, 200 |
| `itn-08/` | `PATCH /api/itineraries/{id}/days/reorder` 200 |
| `itn-10/` | `POST .../days/{dayId}/activities` 201; `PATCH /api/activities/{id}` 200; `DELETE /api/activities/{id}` 204 |
| `itn-12/` | `POST /api/activities/{id}/images` (PNG upload) 201; `DELETE /api/activities/{id}/images/{imageId}` 200 |
| `itn-20/` | `PATCH /api/itineraries/{id}` with visibility PUBLIC, 200 |
| `itn-21/` | `GET /api/itineraries/public/search?q=dubai` 200; `GET /api/itineraries/public/{id}` 200; `POST /api/itineraries/{id}/clone` by another user 201 (private copy, `clonedFrom` credits the author) |
| `itn-25/` | `GET /api/itineraries/{id}/hotels?group=1&guests=1`: check-in on the group's first day, check-out the day after its last, 200 |
| `itn-26/` | `GET /api/itineraries/{id}/flights?origin=LHR`: flights into the first day's city, 200 |
