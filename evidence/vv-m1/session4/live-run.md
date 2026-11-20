# Session 4 live run: booking engine and payments (#57 to #64)

**When:** 15 Nov 2026, 15:18 to 15:31 UTC.

**Environment:**
- The code is develop with #62 (`d0f246a`), #63 (`d3a84fc`) and #64 (`d26221e`) merged into the local branch `vv/session4-live`.
- `npm run start:dev` on `localhost:3000`, with `AUTH_STUB=false`, so every call uses real httpOnly cookie sessions.
- Database `travel_platform` (your choice). Every record the run created was removed afterwards by an id-matched cleanup with a dry run first; the 2 admin audit-log entries are kept.
- Stripe is in test mode (`livemode: false` on every PaymentIntent). Payments were confirmed with `stripe payment_intents confirm`, and webhooks were forwarded by `stripe listen`.

**Method:**
- Requests were sent from the Swagger UI page (same origin, same cookies as Swagger's "Try it out") by a recorder that kept each request, its status and its body. Passwords and client secrets were redacted before anything was stored.
- The fixtures were created through the API: the admin created the airline, the hotel and both moderators; each moderator changed their temporary password, then set up the flights, cabins, policies, rooms and availability; travellers A to D registered.

**Fixtures:**
- Flights: VB410 CAI→DXB on 10 Dec, 150 000, 10 seats; VB411 DXB→CAI on 20 Dec, 120 000.
- Each cabin: 1 free bag, at most 23 kg per bag.
- Extra bags: 5 000 each, at most 2 per passenger.
- Airline cancellation tiers: 14 days 80%, 3 days 50%.
- Hotel rooms: 101 sleeps 2 at 9 000; 102 sleeps 3 at 12 000.

## Verdicts

| Journey | Requirements | Result | Evidence (rows below) |
|---|---|---|---|
| J1 one-way flight | FLT-11, FLT-21, FLT-22, PAY-02, PAY-01, FLT-23 (part), GEN-11 | **PASS**. The quote holds nothing (9 → 9). The hold is 10 minutes, measured as `holdExpiresAt − createdAt` = 599 999 ms, and takes one seat (9 → 8). Paying before acceptance gives 409. Acceptance is stored with a timestamp. The PaymentIntent is 150 000 USD, and paying again returns the same payment. After a Visa confirm, the webhook gives 200, the booking is **CONFIRMED FL-XJ5BGR6A** and the payment SUCCEEDED, with no client secret any more. | 27–39 |
| J2 round trip, passenger types, bags | FLT-12, FLT-19, FLT-21 | **PASS**. Search returns outbound and return options. The quote shows each leg's own infant fare (15 000 and 12 000; #64), and the lines add up to 307 000. Six invalid inputs each give 400 on the exact field: type versus date of birth, future date of birth, more than 23 kg, weight without bags, more than 2 bags, no adult. The hold is one ROUND_TRIP booking with 2 segments, 1 seat on each leg, and the weight is stored. | 40–49 |
| J3 declined card, then retry | PAY-01, GEN-11 | **PASS**. `pm_card_chargeDeclined` makes the payment FAILED with "Your card was declined.", and the booking stays Pending Payment. Retry returns the same payment and PaymentIntent with attempts 2. A Visa confirm then gives **CONFIRMED FL-8GHA3ARG**. | 50–57 |
| J4 expiry | FLT-22, GEN-11, PAY-01 | **PASS**. The booking is EXPIRED at 15:29:41, 37 s after its hold ended (the job runs every 60 s). The seat returns to search: 3 left, which is 10 minus 7 still held or booked. Pay and retry both give 409 HOLD_EXPIRED. The payment is CANCELED, and Stripe shows the PaymentIntent `canceled`. | 21–26, 99–103 |
| J5 hotel, two rooms | HTL-16, HTL-18, PAY-02 (partial), HTL-17 (part) | **PASS**. Both rooms are held as one reservation of 42 000 (2 × 9 000 + 2 × 12 000). Over-occupancy gives 400 on `rooms[0]`, and a check-in in the past gives 400 on `checkIn`. User B's request of a free room plus an overlapping one gives 409, and nothing is held: the next night is still bookable. The policies show `checkInTime` and `checkOutTime` as null and no tiers (PAY-02 Partial until HTL-09/10). After paying, the reservation is **CONFIRMED HT-7FTPG619**. | 58–66 |
| J6 negative and authorization | ACC-11, GEN-11, PAY-01, derived | **PASS**. For the flight booking, hotel reservation, payment and policies of another user, the 404 body is identical to the one for an unknown id (BOLA-1, #64). Retrying another user's payment gives 404. No session gives 401. A traveller creating a flight gets 403. A forged webhook signature gives 400. A 4th unpaid hold gives 409 (derived cap). Paying a Confirmed booking gives 409 INVALID_STATE_TRANSITION. | 67–87 |
| R1 / R5 repeats of J1 and J5 | consistency | **PASS**. Fresh fixtures and users gave the same statuses and amounts (150 000 and 42 000), with new unique references FL-J6AZPNWY and HT-19BP3YAT. | 88–98 |

**Webhook deliveries**, from the `stripe listen` log: every `payment_intent.succeeded` and `payment_intent.payment_failed` in this run was answered **200**.

**Findings in the live run:**
- **ENV-1, configuration.** At first the server's `STRIPE_WEBHOOK_SECRET` did not match the CLI listener. The EH-5 warning added on #62 ("Webhook refused: invalid Stripe signature") showed the cause at once; before the fix, this failure was silent.
- **ENV-2, process.** A running server keeps the database it started with, so editing `.env` has no effect until a restart. A first attempt therefore wrote to the team database unexpectedly. It was cleaned up, and the run was then repeated as described above.
- **Refuted.** Re-accepting the same policy version on a Confirmed booking answers 200 with the stored acceptance. `acceptedAt` stays at the pre-payment time (rows 85–87), so this is an idempotent repeat, not a defect. A different version gives 409 POLICIES_CHANGED (row 83).

## Transcript

Ids are shortened to their last 6 hex characters. Login and password-change calls are left out.

| # | UTC | Step | Request | Status | Response digest |
|---|---|---|---|---|---|
| 1 | 15:18:27 | AUTH admin session | GET /api/auth/me | 200 | status=ACTIVE |
| 2 | 15:18:27 | DB check: account count | GET /api/admin/accounts | 200 | total=1 |
| 3 | 15:18:46 | FIX admin creates airline | POST /api/airlines | 201 | code=VB |
| 4 | 15:18:47 | FIX admin creates hotel | POST /api/hotels | 201 | |
| 5 | 15:18:47 | FIX admin creates airline moderator (ACC-13) | POST /api/admin/moderators | 201 | status=ACTIVE |
| 6 | 15:18:48 | FIX admin creates hotel moderator (ACC-13) | POST /api/admin/moderators | 201 | status=ACTIVE |
| 7 | 15:18:50 | FIX flight VB410 | POST /api/flights | 201 | status=SCHEDULED |
| 8 | 15:18:50 | FIX cabin VB410 | POST /api/flights/…a50c5c/cabins | 201 | |
| 9 | 15:18:50 | FIX flight VB411 | POST /api/flights | 201 | status=SCHEDULED |
| 10 | 15:18:51 | FIX cabin VB411 | POST /api/flights/…a50c6c/cabins | 201 | |
| 11 | 15:18:51 | FIX FLT-08 baggage policy | PUT /api/airlines/…a50c33/baggage-policy | 200 | |
| 12 | 15:18:51 | FIX FLT-09 cancellation policy | PUT /api/airlines/…a50c33/cancellation-policy | 200 | |
| 13–16 | 15:18:53 | FIX rooms 101 and 102 with availability for December | POST /api/hotels/…a50c38/rooms (+ /availability) | 201 | |
| 17–20 | 15:18:54 | FIX register users A to D (ACC-01) | POST /api/auth/register | 201 | status=ACTIVE |
| 21 | 15:19:04 | J4 seats before the hold | GET /api/flights/search | 200 | seatsLeft=VB410:10 |
| 22 | 15:19:04 | J4 FLT-22 hold to be left unpaid | POST /api/flight-bookings/hold | 201 | status=PENDING_PAYMENT, totalMinor=150000, currency=USD |
| 23 | 15:19:05 | J4 PAY-02 policies | GET /api/bookings/flight/…a50cb7/policies | 200 | airlineTiers=[3d 50%, 14d 80%] |
| 24 | 15:19:05 | J4 PAY-02 accept | POST /api/bookings/flight/…a50cb7/accept-policies | 200 | acceptedAt=15:19:05.361Z |
| 25 | 15:19:06 | J4 PAY-01 PaymentIntent created, then left unpaid | POST /api/payments | 201 | status=REQUIRES_PAYMENT, amountMinor=150000, paymentIntentId=pi_3Uc5CvCAUV81R6xr1D1opPKt |
| 26 | 15:19:06 | J4 seats after the hold | GET /api/flights/search | 200 | seatsLeft=VB410:9 |
| 27 | 15:19:21 | J1 FLT-11 search before the hold | GET /api/flights/search | 200 | seatsLeft=VB410:9 |
| 28 | 15:19:21 | J1 FLT-21 quote (holds nothing) | POST /api/flight-bookings/quote | 200 | totalMinor=150000, currency=USD |
| 29 | 15:19:21 | J1 FLT-21 search after the quote: unchanged | GET /api/flights/search | 200 | seatsLeft=VB410:9 |
| 30 | 15:19:22 | J1 FLT-22 hold one seat (Pending Payment, 10 minutes) | POST /api/flight-bookings/hold | 201 | status=PENDING_PAYMENT, totalMinor=150000 |
| 31 | 15:19:22 | J1 FLT-22 search after the hold: one seat fewer | GET /api/flights/search | 200 | seatsLeft=VB410:8 |
| 32 | 15:19:22 | J1 PAY-02 pay before accepting the policies | POST /api/payments | 409 | code=POLICIES_NOT_ACCEPTED |
| 33 | 15:19:23 | J1 PAY-02 show airline cancellation and baggage policies | GET /api/bookings/flight/…a50cee/policies | 200 | airlineTiers=[3d 50%, 14d 80%] |
| 34 | 15:19:23 | J1 PAY-02 accept policies (stored with a timestamp) | POST /api/bookings/flight/…a50cee/accept-policies | 200 | acceptedAt=15:19:23.162Z |
| 35 | 15:19:24 | J1 PAY-01 create the test-mode PaymentIntent | POST /api/payments | 201 | status=REQUIRES_PAYMENT, amountMinor=150000, currency=USD, paymentIntentId=pi_3Uc5DDCAUV81R6xr0nzMB4MN |
| 36 | 15:19:24 | J1 PAY-01 clicking pay again returns the same payment | POST /api/payments | 201 | same payment id and PaymentIntent |
| — | 15:19:31 | Stripe CLI `confirm … pm_card_visa`, then webhook `payment_intent.succeeded` | POST /api/payments/webhook | 200 | |
| 37 | 15:19:40 | J1 FLT-23 (part) booking CONFIRMED with a unique FL- reference | GET /api/flight-bookings/…a50cee | 200 | status=CONFIRMED, reference=FL-XJ5BGR6A |
| 38 | 15:19:40 | J1 PAY-01 payment SUCCEEDED; the client secret is no longer shown | GET /api/payments/…a50d06 | 200 | status=SUCCEEDED, reference=FL-XJ5BGR6A |
| 39 | 15:19:40 | J1 FLT-23 seats stay booked after confirmation | GET /api/flights/search | 200 | seatsLeft=VB410:8 |
| 40 | 15:19:53 | J2 FLT-12 round-trip search | GET /api/flights/search/round-trip | 200 | outbound and return options |
| 41 | 15:19:54 | J2 FLT-21/FLT-12 round-trip quote: each leg shows its own infant fare (#64) | POST /api/flight-bookings/quote | 200 | ROUND_TRIP, totalMinor=307000, segments=150000x1+inf15000/120000x1+inf12000, extraBagsMinor=10000 |
| 42 | 15:19:54 | J2 FLT-12 a type that contradicts the date of birth | POST /api/flight-bookings/quote | 400 | passengers[1].type: born 2020-01-01 travels as CHILD on 2026-12-10, not INFANT |
| 43 | 15:19:54 | J2 FLT-12 date of birth after the travel date | POST /api/flight-bookings/quote | 400 | passengers[1].dateOfBirth: 2027-01-15 is after the travel date |
| 44 | 15:19:55 | J2 FLT-19 extra-bag weight over 23 kg per bag | POST /api/flight-bookings/quote | 400 | passengers[0].extraBagsWeightKg: at most 23 kg for 1 extra bag |
| 45 | 15:19:55 | J2 FLT-19 weight without extra bags | POST /api/flight-bookings/quote | 400 | passengers[0].extraBagsWeightKg: only together with extraBags |
| 46 | 15:19:55 | J2 FLT-19 more extra bags than the airline maximum (2) | POST /api/flight-bookings/quote | 400 | passengers[0].extraBags: at most 2 per passenger |
| 47 | 15:19:56 | J2 FLT-12 no adult | POST /api/flight-bookings/quote | 400 | passengers: at least one adult (12 or older) |
| 48 | 15:19:57 | J2 FLT-12/FLT-22 hold the round trip as ONE booking with two segments | POST /api/flight-bookings/hold | 201 | ROUND_TRIP, totalMinor=307000, segments=150000x1/120000x1 |
| 49 | 15:20:07 | J2 FLT-19 date of birth after today but before travel (derived rule) | POST /api/flight-bookings/quote | 400 | passengers[1].dateOfBirth: cannot be in the future (2026-11-25) |
| 50 | 15:20:08 | J3 FLT-22 user B holds one seat | POST /api/flight-bookings/hold | 201 | status=PENDING_PAYMENT |
| 51–52 | 15:20:08 | J3 PAY-02 policies and accept | GET/POST /api/bookings/flight/…a50d67/… | 200 | acceptedAt=15:20:08.673Z |
| 53 | 15:20:09 | J3 PAY-01 PaymentIntent | POST /api/payments | 201 | paymentIntentId=pi_3Uc5DwCAUV81R6xr03IgBIrh |
| — | 15:20:16 | Stripe CLI `confirm … pm_card_chargeDeclined`, then webhook `payment_intent.payment_failed` | POST /api/payments/webhook | 200 | card_declined / generic_decline |
| 54 | 15:20:26 | J3 PAY-01 the declined attempt is recorded | GET /api/payments/…a50d79 | 200 | status=FAILED, lastError=Your card was declined., attempts=1 |
| 55 | 15:20:26 | J3 GEN-11 the booking stays Pending Payment | GET /api/flight-bookings/…a50d67 | 200 | status=PENDING_PAYMENT |
| 56 | 15:20:27 | J3 PAY-01 retry within the hold | POST /api/payments/…a50d79/retry | 200 | same payment and PaymentIntent, status=REQUIRES_PAYMENT, attempts=2 |
| — | 15:20:34 | Stripe CLI `confirm … pm_card_visa`, then webhook `payment_intent.succeeded` | POST /api/payments/webhook | 200 | |
| 57 | 15:20:50 | J3 FLT-23 (part) confirmed after the retry | GET /api/flight-bookings/…a50d67 | 200 | status=CONFIRMED, reference=FL-8GHA3ARG |
| 58 | 15:20:51 | J5 HTL-16/HTL-18 hold two rooms together (2 nights) | POST /api/hotel-bookings | 201 | status=PENDING_PAYMENT, totalMinor=42000 |
| 59 | 15:20:52 | J5 HTL-16 over occupancy (3 adults in a 2-person room) | POST /api/hotel-bookings | 400 | rooms[0]: Room 101 sleeps at most 2; 3 guests were assigned |
| 60 | 15:20:52 | J5 HTL-18 check-in in the past | POST /api/hotel-bookings | 400 | checkIn: cannot be before today (2026-11-15 at the hotel) |
| 61 | 15:20:53 | J5 HTL-18 user B: free room + overlapping room, so the whole request is refused | POST /api/hotel-bookings | 409 | code=INSUFFICIENT_INVENTORY |
| 62 | 15:20:54 | J5 HTL-18 nothing was held for B: the next night is still free | POST /api/hotel-bookings | 201 | totalMinor=21000 |
| 63 | 15:20:55 | J5 PAY-02 hotel policies (partial until HTL-09/10) | GET /api/bookings/hotel/…a50da7/policies | 200 | checkIn=null, checkOut=null, tiers=0 |
| 64 | 15:20:55 | J5 PAY-02 accept | POST /api/bookings/hotel/…a50da7/accept-policies | 200 | acceptedAt=15:20:55.456Z |
| 65 | 15:20:56 | J5 PAY-01 PaymentIntent for the reservation | POST /api/payments | 201 | amountMinor=42000, paymentIntentId=pi_3Uc5EhCAUV81R6xr0vWF61ps |
| — | 15:21:03 | Stripe CLI `confirm … pm_card_visa`, then webhook `payment_intent.succeeded` | POST /api/payments/webhook | 200 | |
| 66 | 15:21:22 | J5 HTL-17 (part) reservation CONFIRMED with an HT- reference | GET /api/hotel-bookings/…a50da7 | 200 | status=CONFIRMED, reference=HT-7FTPG619 |
| 67–74 | 15:21:22 | J6 ACC-11 user B reads user A's flight booking, hotel reservation, payment and policies, and an unknown id of each | GET (4 routes × 2) | 404 | code=NOT_FOUND each; bodies identical apart from path and time |
| 75 | 15:21:24 | J6 ACC-11 user B retries user A's payment | POST /api/payments/…a50d06/retry | 404 | code=NOT_FOUND |
| 76 | 15:21:24 | J6 ACC-11 no session | POST /api/flight-bookings/hold | 401 | code=UNAUTHENTICATED |
| 77 | 15:21:24 | J6 PAY-01 webhook with a forged signature | POST /api/payments/webhook | 400 | code=BAD_REQUEST |
| 78–80 | 15:21:25 | J6 derived (OWASP API6) user D unpaid holds 1 to 3 | POST /api/flight-bookings/hold | 201 | PENDING_PAYMENT |
| 81 | 15:21:26 | J6 derived (OWASP API6) user D unpaid hold 4 | POST /api/flight-bookings/hold | 409 | code=CONFLICT |
| 82 | 15:21:27 | J6 GEN-11 paying an already Confirmed booking | POST /api/payments | 409 | code=INVALID_STATE_TRANSITION |
| 83 | 15:21:27 | J6 PAY-02 accepting a different policy version on a Confirmed booking | POST /api/bookings/flight/…a50cee/accept-policies | 409 | code=POLICIES_CHANGED |
| 84 | 15:21:27 | J6 BFLA: a traveller cannot create a flight | POST /api/flights | 403 | code=FORBIDDEN |
| 85–87 | 15:21:35 | J6 PAY-02 repeat acceptance of the same version is idempotent; acceptedAt unchanged | GET/POST /api/bookings/flight/…a50cee/… | 200 | status=CONFIRMED, acceptedAt=15:19:23.162Z (pre-payment) |
| 88–92 | 15:22:19 | R1 repeat of J1: hold, policies, pay before accept, accept, PaymentIntent | … | 201 / 200 / 409 / 200 / 201 | 150000; POLICIES_NOT_ACCEPTED |
| 93–96 | 15:22:22 | R5 repeat of J5: two rooms, policies, accept, PaymentIntent | … | 201 / 200 / 200 / 201 | 42000 |
| 97 | 15:22:42 | R1 confirmed | GET /api/flight-bookings/…a50e78 | 200 | status=CONFIRMED, reference=FL-J6AZPNWY |
| 98 | 15:22:42 | R5 confirmed | GET /api/hotel-bookings/…a50e9c | 200 | status=CONFIRMED, reference=HT-19BP3YAT |
| 99 | 15:29:41 | J4 FLT-22/GEN-11 unpaid hold is EXPIRED after 10 minutes | GET /api/flight-bookings/…a50cb7 | 200 | status=EXPIRED |
| 100 | 15:29:41 | J4 FLT-22 the expired seat is released back to search | GET /api/flights/search | 200 | seatsLeft=VB410:3 |
| 101 | 15:29:41 | J4 PAY-01 paying after the hold expired | POST /api/payments | 409 | code=HOLD_EXPIRED |
| 102 | 15:29:41 | J4 PAY-01 retry after expiry | POST /api/payments/…a50cc9/retry | 409 | code=HOLD_EXPIRED |
| 103 | 15:30:46 | J4 PAY-01 the payment is CANCELED once the job cancels the PaymentIntent | GET /api/payments/…a50cc9 | 200 | status=CANCELED; Stripe shows the PaymentIntent `canceled` |
