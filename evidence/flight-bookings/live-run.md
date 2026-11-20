# FLT-26 / FLT-12(a) live Swagger run, 2026-11-17

Evidence for the FLT-26 pull request (branch `feature/FLT-26-flight-cancellation`, code at `e4ba6b2`). This branch is
evidence only and is not meant to be merged.

## Setup

| Item | Value |
|---|---|
| Database | Throw-away `MongoMemoryReplSet` (single-node replica set, `mongodb://127.0.0.1:<random port>/flt26_live`) from `backend/node_modules`, stopped after the run. Atlas was never used: the launcher refused to start if the worktree had a `backend/.env`, and it ignored `MONGODB_URI` |
| API | `node dist/main`, built by `npm run verify`, on port 3999 with `NODE_ENV=development` and `AUTH_STUB=false` (real login cookies, no `x-dev-user`) |
| Data | `npm run seed` (reference data and admin), then `npm run seed:demo`: Demo Air DM101 CAI→LHR on 2028-03-15 and DM102 LHR→CAI on 2028-03-22, each with 120 economy seats at 250.00 USD; tiers 14 days = 100%, 7 days = 50%, 1 day = 25% |
| Payments | Stripe **test mode**: `POST /api/payments`, then `stripe payment_intents confirm <pi> --payment-method pm_card_visa`. `stripe listen --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,refund.created,refund.updated,refund.failed --forward-to localhost:3999/api/payments/webhook` delivered the signed webhooks |
| Accounts | `demo.traveller@example.com` (the owner), a newly registered user (the stranger), `demo.airline@example.com` (AIRLINE_MODERATOR) |

Swagger (`GET /api/docs` returned 200; the table comes from `GET /api/docs-json`):

| Endpoint | Summary | Tag | Documented responses |
|---|---|---|---|
| `GET /api/flight-bookings/{id}/refund-quote` | FLT-26 See the refund before cancelling a confirmed flight booking | flight-bookings | 200, 400, 401, 403, 404, 409 |
| `POST /api/flight-bookings/{id}/cancel` | FLT-26 Cancel a confirmed flight booking with a tier refund | flight-bookings | 200, 400, 401, 403, 404, 409 |

## 1. One way: quote, then cancel (FLT-26, PAY-03, GEN-11)

| Step | Request | Result |
|---|---|---|
| Hold DM101, 1 adult | `POST /api/flight-bookings/hold` | 201 `PENDING_PAYMENT` |
| Read and accept the policies | `GET /api/bookings/flight/{id}/policies`, `POST .../accept-policies` | 200, 200 |
| Pay | `POST /api/payments`, then confirm with the Stripe CLI and `pm_card_visa` | 201 `REQUIRES_PAYMENT`; the webhook confirmed the booking: `GET /api/flight-bookings/{id}` 200 `CONFIRMED` |
| Seats before | `GET /api/flights/{DM101}` | 117 |
| Quote | `GET /api/flight-bookings/{id}/refund-quote` | 200: `refundPercent` 100, `amountMinor` 25000, `tierApplied` `{daysBefore:14, refundPercent:100}` |
| Cancel | `POST /api/flight-bookings/{id}/cancel` | 200 `CANCELLED`, `refund` `{status:"PENDING", amountMinor:25000, currency:"USD"}` |
| Seats after | `GET /api/flights/{DM101}` | 118 (+1) |
| Refund after the Stripe webhook | `GET /api/refunds/{refund.id}` | 200 `REFUNDED`, 25000, 100% |
| Booking details | `GET /api/flight-bookings/{id}` | 200 `CANCELLED`, `refund.status` `REFUNDED` |

## 2. Error cases

| Case | Request | Result |
|---|---|---|
| Second cancel | `POST .../cancel` on the cancelled booking | 409 `BOOKING_NOT_CONFIRMED` |
| Quote of a cancelled booking | `GET .../refund-quote` | 409 `BOOKING_NOT_CONFIRMED` |
| Stranger (another USER) | quote and cancel on the owner's confirmed booking | 404 `NOT_FOUND` for both, the same as for an unknown id (ACC-11) |
| Unknown id | `POST /api/flight-bookings/{random ObjectId}/cancel` | 404 `NOT_FOUND` |
| Wrong role (AIRLINE_MODERATOR) | `POST .../cancel` | 403 `FORBIDDEN` |
| Signed out | `POST .../cancel` | 401 `UNAUTHENTICATED` |
| Malformed id | `POST /api/flight-bookings/not-an-id/cancel` | 400 `INVALID_ID` |
| Pending hold | `POST .../cancel` on a `PENDING_PAYMENT` booking | 409 `BOOKING_NOT_CONFIRMED` |
| After departure | on the throw-away DB, the confirmed booking's `startsAt` and outbound departure were moved to one minute ago; then the quote and the cancel | 409 `CANCELLATION_WINDOW_CLOSED` for both |

## 3. Two parallel cancels (TRVL-144)

Two cancel requests were sent at once (`Promise.all`) for one confirmed booking. One got 200 `CANCELLED`, the other 409 `BOOKING_NOT_CONFIRMED`, and the `refunds` collection holds exactly **1** refund for the booking.

## 4. Round trip cancelled as a whole (FLT-12 a)

| Step | Request | Result |
|---|---|---|
| Hold DM101 out and DM102 back for 2 adults and 1 infant (born 2026-06-01), then pay as above | | 201, then `CONFIRMED` through the webhook |
| Seats before | DM101 / DM102 | 114 / 118 |
| Quote | `GET .../refund-quote` | 200: the outbound tier `{daysBefore:14, refundPercent:100}`, `amountMinor` 105000 (2 × 25000 on each flight, plus the infant's 10% fare on each flight) |
| Cancel | `POST .../cancel` | 200 `CANCELLED`, one refund `{status:"PENDING", amountMinor:105000}` |
| Seats after | DM101 / DM102 | 116 / 120: +2 on each flight; the infant sits on a lap and gives back no seat |

Demo Air flies both legs, so the live run cannot show the outbound tier winning over a different return tier. The e2e
block `round trip cancelled as a whole: FLT-12` covers that case: the return airline would refund 100%, and the round
trip still gets the outbound airline's 50%.

## 5. Notifications

For the owner, `GET /api/notifications` lists one `BOOKING_CANCELLED` for each of the 3 cancelled bookings (the one
way, the race winner and the round trip). Each comes with its `REFUND_ISSUED`, and once Stripe answered, with
`REFUND_UPDATED` ("Refund completed").

## Automated checks on the same code

- `npm run verify` (backend): format, lint, typecheck, 988 unit tests, 807 e2e tests, build, OpenAPI generate and check (63 paths), dependency-cruiser (no violations).
- `test/flight-cancellation.e2e-spec.ts` was run 3 more times: 11/11 each time.
