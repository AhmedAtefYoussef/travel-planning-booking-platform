# Swagger demo script (Milestone 1)

The call order for a live walkthrough in Swagger UI at <http://localhost:3000/api/docs>: Administrator, then
Airline moderator, then Hotel moderator, then Traveller. Each step is one call: method, path, the smallest body
that works, and the status to expect. Error cases at the end of each part show the shared error envelope
(`docs/api/conventions.md`).

Marks used below, so they can be dropped once the work is merged:

- **(PR #76)** ACC-15/16, suspend and deactivate. **(PR #77)** HTL-21, cancel a hotel booking.
- **(in review)** GEN-09/10, reports and moderation: the routes exist only after the content modules register
  (blog posts, comments, reviews); until then they are not in `openapi.json` either.

## 0. Before you start

```bash
cd backend
npm run seed          # reference data (airports, cities, currencies) and the admin account
npm run seed:demo     # optional shortcut: Demo Air, Demo Nile Hotel, their moderators and a traveller
npm run start:dev
```

1. In `backend/.env` set `AUTH_STUB=false`, so that real cookie login is used and every check applies (suspended,
   idle and forced-password-change accounts are refused). Restart the API after changing it.
2. Open Swagger. `POST /api/auth/login` sets httpOnly cookies and Swagger sends them with every later call. To
   change role, call `POST /api/auth/logout`, then log in again (or use a private window per role).
3. Passwords: the admin uses `ADMIN_SEED_PASSWORD`; the demo moderators and the traveller use `DEMO_PASSWORD`
   (both from `backend/.env`). Emails are in the README, "Seeded accounts".
4. Stripe: for the payment step run `stripe listen` as described in the README, "Stripe test mode".

### Where the ids come from

- **Demo provider ids** (`{airlineId}` = Demo Air, `{hotelId}` = Demo Nile Hotel): `npm run seed:demo` prints them,
  with the flight, cabin and room ids (it prints ids again on every run and never a password). You can also read them
  after logging in as a demo moderator: `GET /api/auth/me` returns `assignedProvider.providerId`.
- **Flight and cabin ids** (`{flightId}`, `{cabinId}`): the `flight` and `economy cabin` ids printed by the seed for DM101
  and DM102, or from the response of the step that created them.
- **Room ids**: `{room101Id}` and `{room102Id}` are printed by the seed. `{roomId}` in Part 3 is the id returned by that
  part's own `POST .../rooms` (there is no list endpoint for rooms).
- **Alternative path B** (no seed needed for Parts 1 to 3): Admin steps 4 to 6 create your own provider pair,
  `{walkAirlineId}` and `{walkHotelId}`, with moderators `walk.airline@example.com` and `walk.hotel@example.com`. In
  Parts 2 and 3 substitute those ids and log in as those moderators. Part 4 always uses the seeded demo records: only
  they have flights on the searched dates and a hotel with check-in/out times and cancellation tiers.

Money is in minor units (`25000` = 250.00 USD). Dates are `YYYY-MM-DD`; flight times are local airport time, `YYYY-MM-DDTHH:mm`.

## 1. Administrator

Log in as `ADMIN_SEED_EMAIL`. Steps 4 to 6 are alternative path B (your own provider pair); with `seed:demo` you can skip them.

| # | Call | Body or query | Expect |
|---|---|---|---|
| 1 | `POST /api/auth/login` | `{"email":"<ADMIN_SEED_EMAIL>","password":"<ADMIN_SEED_PASSWORD>"}` | 200, cookies set, `homePath` for admins |
| 2 | `GET /api/auth/me` | | 200, role `ADMIN` |
| 3 | `GET /api/airports`, `GET /api/cities`, `GET /api/countries`, `GET /api/currencies` | `?page=1` | 200, the seeded reference data (GEN-12) |
| 4 | `POST /api/airlines` (path B) | `{"name":"Walkthrough Air","code":"WA"}` | 201, keep `id` as `{walkAirlineId}`; repeating it gives 409 `DUPLICATE_KEY` |
| 5 | `POST /api/hotels` (path B) | `{"name":"Walkthrough Hotel","address":"5 Nile Street","cityId":"cairo"}` | 201, keep `id` as `{walkHotelId}` |
| 6 | `POST /api/admin/moderators` (path B) | `{"name":"Walk Airline Mod","email":"walk.airline@example.com","role":"AIRLINE_MODERATOR","providerId":"{walkAirlineId}","temporaryPassword":"Temp2026x"}` | 201; the same call for the hotel with `"name":"Walk Hotel Mod"`, `"email":"walk.hotel@example.com"`, `"role":"HOTEL_MODERATOR"` and `{walkHotelId}`. A moderator created this way must change the temporary password at first login (Part 2, step 2) |
| 7 | `GET /api/admin/accounts` | `?q=demo&role=USER&status=ACTIVE` | 200, paginated, 10 per page (ACC-14) |
| 8 | `POST /api/admin/users/{id}/reset-password` | `{"temporaryPassword":"Temp2026x"}` | 204; the user must change it at next login (ACC-07a) |
| 9 | `PATCH /api/admin/accounts/{id}/suspend` **(PR #76)** | no body; a user or moderator id | 200, status `SUSPENDED`; the account can no longer log in and is notified (ACC-16) |
| 10 | `PATCH /api/admin/accounts/{id}/reactivate` **(PR #76)** | | 200, status `ACTIVE`; login works again |
| 11 | `PATCH /api/admin/providers/{type}/{id}/deactivate` **(PR #76)** | no body; `{type}` is `airline` or `hotel` | 200, `isActive: false`; hidden from search and cannot be booked, Confirmed bookings stay valid (ACC-15) |
| 12 | `PATCH /api/admin/providers/{type}/{id}/reactivate` **(PR #76)** | | 200, `isActive: true` |
| 13 | `GET /api/admin/reports` **(in review)** | | 200, reports filed by users (GEN-09) |
| 14 | `PATCH /api/admin/reports/{id}` **(in review)** | body as shown in Swagger once merged | 200, the report is resolved with the action taken |
| 15 | `PATCH /api/admin/content/{type}/{id}/hide` **(in review)** | | 200; hidden content is removed from public lists (GEN-10) |
| 16 | `DELETE /api/admin/content/{type}/{id}` **(in review)** | | 204 |
| 17 | `GET /api/admin/audit-logs` | `?action=CREATE_MODERATOR` | 200, newest first (GEN-07): moderator creation, password resets and, once merged, suspensions and provider changes |
| 18 | `GET /api/currencies/rates`, `GET /api/currencies/convert` | `?amountMinor=10000&from=USD&to=EUR` | 200 (ITN-18); 503 if the exchange-rate service is unreachable |

Error cases worth showing: step 4 as a traveller gives 403 `FORBIDDEN`; any admin call without logging in gives
401 `UNAUTHENTICATED`; `GET /api/airlines/not-an-id` gives 400 `INVALID_ID`; an unknown valid id gives 404 `NOT_FOUND`.

## 2. Airline moderator

Log in as `demo.airline@example.com` (seeded, no forced password change). Here `{airlineId}` is Demo Air's id from the
seed output, or `assignedProvider.providerId` from `GET /api/auth/me` after step 1. (Path B: log in as
`walk.airline@example.com`, change the password as in step 2, and use `{walkAirlineId}`.) Another airline's id gives 403.

| # | Call | Body or query | Expect |
|---|---|---|---|
| 1 | `POST /api/auth/login` | `{"email":"demo.airline@example.com","password":"<DEMO_PASSWORD>"}` | 200 |
| 2 | `PATCH /api/auth/change-password` | `{"currentPassword":"Temp2026x","newPassword":"Walk2026pass"}` | 204. Only for a moderator created in Admin step 6; every other call returns 403 `PASSWORD_CHANGE_REQUIRED` until you do it |
| 3 | `PATCH /api/airlines/{airlineId}` | `{"name":"Demo Air Express"}` | 200; another airline's id gives 403 (ACC-11) |
| 4 | `PUT /api/airlines/{airlineId}/logo` | multipart field `logo` (PNG or JPEG, 5 MB max) | 200 (GEN-08) |
| 5 | `POST /api/flights` | `{"flightNumber":"DM201","from":"CAI","to":"LHR","departureLocal":"2028-04-05T09:00","arrivalLocal":"2028-04-05T12:30"}` | 201, status `SCHEDULED`, UTC and local times shown (FLT-03, GEN-06); keep `id` as `{flightId}`. A repeat gives 409; a past date gives 400 |
| 6 | `POST /api/flights/{flightId}/cabins` | `{"class":"ECONOMY","totalSeats":120,"priceMinor":25000,"freeBags":1,"maxKgPerBag":23}` | 201, keep the cabin `id` as `{cabinId}` (FLT-04) |
| 7 | `PATCH /api/flights/{flightId}/cabins/{cabinId}` | `{"priceMinor":27000}` | 200 (FLT-04, FLT-05) |
| 8 | `PATCH /api/flights/{flightId}` | `{"departureLocal":"2028-04-05T10:00","arrivalLocal":"2028-04-05T13:30"}` | 200; users with a Confirmed booking are notified (FLT-05) |
| 9 | `PUT /api/airlines/{airlineId}/baggage-policy` | `{"pricePerBagMinor":4000,"maxExtraBagsPerPassenger":2}` | 200 (FLT-08) |
| 10 | `PUT /api/airlines/{airlineId}/cancellation-policy` | `{"tiers":[{"daysBefore":14,"refundPercent":100},{"daysBefore":7,"refundPercent":50}]}` | 200; a repeated `daysBefore` gives 400 (FLT-09) |
| 11 | `GET /api/airlines/{airlineId}/cancellation-policy/refund-preview` | `?daysRemaining=10` | 200, tier 7 applies, 50% |
| 12 | `GET /api/flights/{flightId}` | | 200, details with seats left and policies (FLT-17) |
| 13 | `GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/read-all` | | 200 (GEN-01) |

Error cases: step 5 with `from` equal to `to` gives 400 with a `fieldErrors` entry; step 3 on another airline
gives 403; reducing `totalSeats` below the seats already booked gives 409.

## 3. Hotel moderator

Log in as `demo.hotel@example.com` (seeded). `{hotelId}` is Demo Nile Hotel's id from the seed output, or
`assignedProvider.providerId` from `GET /api/auth/me` after step 1. (Path B: `walk.hotel@example.com` and
`{walkHotelId}`, changing the password first.) Step 4 creates room 201 and returns its `{roomId}`; the seeded rooms 101
and 102 already have availability and are the ones the traveller books in Part 4.

| # | Call | Body or query | Expect |
|---|---|---|---|
| 1 | `POST /api/auth/login` | `{"email":"demo.hotel@example.com","password":"<DEMO_PASSWORD>"}` | 200 |
| 2 | `PATCH /api/hotels/{hotelId}` | `{"description":"Riverside hotel with a rooftop pool.","starClass":5}` | 200 (HTL-01) |
| 3 | `POST /api/hotels/{hotelId}/images` | multipart field `images` (up to 5 images, 5 MB each) | 201 (GEN-08); `DELETE /api/hotels/{hotelId}/images/{imageId}` removes one |
| 4 | `POST /api/hotels/{hotelId}/rooms` | `{"number":"201","type":"Double","beds":1,"maxOccupancy":2,"priceMinor":12000}` | 201, keep `id` as `{roomId}` (HTL-03); a repeated number gives 409 |
| 5 | `POST /api/hotels/{hotelId}/rooms/{roomId}/availability` | `{"ranges":[{"from":"2028-03-01","to":"2028-04-01"}]}` | 201 (HTL-04); an overlapping range gives 409 |
| 6 | `PATCH /api/hotels/{hotelId}/rooms/{roomId}` | `{"priceMinor":13000}` | 200 (HTL-05) |
| 7 | `PATCH /api/hotels/{hotelId}/rooms/{roomId}/availability` | `{"ranges":[{"from":"2028-03-01","to":"2028-05-01"}]}` | 200, replaces all ranges (HTL-05) |
| 8 | `GET /api/notifications` | | 200 |

Check-in and check-out times and the hotel cancellation tiers (HTL-09, HTL-10) have no endpoint yet: only the demo hotel
has them, set by `npm run seed:demo`. A hotel you create yourself (path B) has none, so its policies step and any
hotel cancellation would show no tiers. That is why Part 4 uses the demo hotel.

## 4. Traveller

| # | Call | Body or query | Expect |
|---|---|---|---|
| 1 | `POST /api/auth/register` | `{"name":"Mona Hassan","email":"mona@example.com","password":"Travel2026","acceptTerms":true}` | 201; a repeat gives 409 `EMAIL_ALREADY_REGISTERED`. Or skip and use `demo.traveller@example.com` |
| 2 | `POST /api/auth/login` | `{"email":"mona@example.com","password":"Travel2026"}` | 200 |
| 3 | `PATCH /api/users/me` | `{"phone":"+201001234567","preferredCurrency":"EGP"}` | 200 (ACC-09) |
| 4 | `GET /api/flights/search` | `?from=CAI&to=LHR&departureDate=2028-03-15&adults=1&cabinClass=ECONOMY&sort=price` | 200, finds Demo Air DM101; keep its `flightId` and economy `cabinId` (same ids as the seed output) (FLT-11) |
| 5 | `GET /api/flights/search/round-trip` | `?from=CAI&to=LHR&departureDate=2028-03-15&returnDate=2028-03-22&adults=1` | 200, outbound and return options (FLT-12) |
| 6 | `POST /api/flight-bookings/quote` | `{"outbound":{"flightId":"{flightId}","cabinId":"{cabinId}"},"passengers":[{"type":"ADULT","firstName":"Mona","lastName":"Adel","dateOfBirth":"1990-05-01","documentNumber":"A1234567"}]}` | 200, price summary, nothing is held (FLT-21) |
| 7 | `POST /api/flight-bookings/hold` | the same body | 201, `PENDING_PAYMENT`, seats held 10 minutes (FLT-22); keep `id` as `{bookingId}` |
| 8 | `POST /api/hotel-bookings` | `{"hotelId":"{hotelId}","checkIn":"2028-03-10","checkOut":"2028-03-13","rooms":[{"roomId":"{room101Id}","adults":2}]}` (the demo hotel and room 101) | 201, rooms held 10 minutes (HTL-16, HTL-18); keep `id` as `{reservationId}` |
| 9 | `GET /api/flight-bookings/{bookingId}`, `GET /api/hotel-bookings/{reservationId}` | | 200; someone else's id gives the same 404 as an unknown id (ACC-11) |
| 10 | `GET /api/bookings/flight/{bookingId}/policies` | (`hotel` and `{reservationId}` for a hotel) | 200, baggage, cancellation tiers, check-in and check-out; keep `version` (PAY-02) |
| 11 | `POST /api/bookings/flight/{bookingId}/accept-policies` | `{"accepted":true,"version":"<version>"}` | 200; paying before this gives 409 |
| 12 | `POST /api/payments` | `{"bookingType":"FLIGHT","bookingId":"{bookingId}"}` | 201, a `paymentIntentId` (PAY-01) |
| 13 | Terminal: `stripe payment_intents confirm <paymentIntentId> --payment-method pm_card_visa` | | the webhook confirms the booking |
| 14 | `GET /api/flight-bookings/{bookingId}` | | 200, `CONFIRMED`, `reference` starting `FL-` (`HT-` for hotels) |
| 15 | `GET /api/payments/{id}` | | 200 |
| 16 | `GET /api/flight-bookings/{bookingId}/e-ticket` | | 200, a PDF (FLT-23) |
| 17 | `GET /api/flight-bookings/{bookingId}/refund-quote` | | 200, the refund amount and tier (FLT-26) |
| 18 | `POST /api/flight-bookings/{bookingId}/cancel` | no body | 200, `CANCELLED`, seats returned, a refund recorded (FLT-26); a second call gives 409 |
| 19 | `GET /api/refunds/{id}` | the id from the booking's `refund` block | 200, `PENDING`, then `REFUNDED` (PAY-03) |
| 20 | `GET /api/hotel-bookings/{reservationId}/refund-quote` **(PR #77)** | | 200 (HTL-21) |
| 21 | `POST /api/hotel-bookings/{reservationId}/cancel` **(PR #77)** | no body | 200, rooms released, refund by the hotel tiers (HTL-21) |
| 22 | `POST /api/reports` **(in review)** | `{"targetType":"POST","targetId":"{id}","reason":"Offensive language"}` (types: POST, COMMENT, REVIEW, ITINERARY) | 201 (GEN-09) |
| 23 | `GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/{id}/read` | | 200: booking confirmed, cancelled and refund notices (GEN-01) |
| 24 | `GET /api/currencies/convert` | `?amountMinor=25000&from=USD&to=EGP` | 200 (PAY-04) |
| 25 | `PATCH /api/auth/change-password` | `{"currentPassword":"Travel2026","newPassword":"Travel2027"}` | 204 (ACC-08) |
| 26 | `DELETE /api/users/me` | `{"password":"Travel2027"}` | 204, the account is deactivated (ACC-12); with a Confirmed or held booking it gives 409 `UPCOMING_BOOKINGS_EXIST` |

A card that fails: `stripe payment_intents confirm <id> --payment-method pm_card_chargeDeclined` fails the
attempt; `POST /api/payments/{id}/retry` (no body) tries again until the hold ends. After 10 minutes an unpaid
hold expires on its own and the seats return to the inventory.

Error cases: a hold for more seats than are left gives 409; a missing field
gives 400 `VALIDATION_FAILED` with one `fieldErrors` entry per field.

## 5. Not part of the script

`GET /api/health` is the liveness check. The `Diagnostics (dev only)` Swagger tag (`/api/diagnostics/*`) exists
only outside production, to exercise the shared validation, pagination and error rules; it is not a feature.
