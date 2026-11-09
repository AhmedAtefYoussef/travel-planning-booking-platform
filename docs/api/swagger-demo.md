# Payment flow demo (Swagger + Stripe test mode)

Walks the PAY-01 to PAY-03 flow end to end: policies, acceptance, PaymentIntent, test confirmation, verified webhook, booking confirmed, refund.

The API document is `docs/api/openapi.json` (regenerate with `npm run openapi:export` in `backend/`). Swagger UI is served at `http://localhost:3000/api/docs`, the live JSON at `/api/docs-json`.

## Using Swagger UI with the dev headers

With `DEV_AUTH_ENABLED=true` (and `NODE_ENV=development` or `test`) the document declares three header API keys. In Swagger UI click **Authorize** and fill:

| Scheme | Value for a normal user | Value for an admin |
|---|---|---|
| `x-dev-user-id` | `aaaaaaaaaaaaaaaaaaaaaaaa` | any id |
| `x-dev-role` | `USER` | `ADMIN` |
| `x-dev-provider` | leave empty | leave empty (set an airline/hotel id for `AIRLINE_MOD` / `HOTEL_MOD`) |

Then **Close**; "Try it out" sends the headers on every call (they persist across page reloads). Every operation summary starts with its requirement id, for example `[PAY-01] Create payment intent for a booking`, and every request body has a schema with an example. When `DEV_AUTH_ENABLED` is off the Authorize dialog only offers the bearer scheme. Karim's booking modules are not bound yet: bookings come from the in-memory stub, seeded by `backend/scripts/demo-server.ts`. The `curl` commands below do the same thing and stay valid.

## 0. One-time setup

1. `backend/.env` (copy `.env.example`): set `NODE_ENV=development`, `DEV_AUTH_ENABLED=true`, `MONGODB_URI`, `JWT_SECRET`, your own Stripe test secret key in `STRIPE_SECRET_KEY`. Never commit this file.
2. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run `stripe login` (test mode).

## 1. Start the services (three terminals)

**Terminal A: the API with two seeded demo bookings** (from `backend/`):

```bash
npx ts-node scripts/demo-server.ts
```

Add `DEMO_IN_MEMORY_DB=true` to use a throw-away in-memory MongoDB instead of `MONGODB_URI`. The script prints the booking ids. With the defaults they are:

| Booking | type | id | total |
|---|---|---|---|
| Flight | `flight` | `111111111111111111111111` | 25000 (USD 250.00) |
| Hotel | `hotel` | `222222222222222222222222` | 25000 (USD 250.00) |

The owner is `aaaaaaaaaaaaaaaaaaaaaaaa`; the hold lasts 60 minutes.

**Terminal B: forward Stripe webhooks to the API:**

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
```

It prints `Ready! ... Your webhook signing secret is whsec_...`. Put that value in `STRIPE_WEBHOOK_SECRET` in `backend/.env` and restart Terminal A. Without this the webhook is rejected with 400 (signature check) and the booking never confirms.

**Terminal C (optional, if you prefer curl to Swagger UI).** Shared variables:

```bash
API=http://localhost:3000/api
H='-H x-dev-user-id:aaaaaaaaaaaaaaaaaaaaaaaa -H x-dev-role:USER'
FLIGHT=111111111111111111111111
```

## 2. Call order

In Swagger UI use the tags `bookings`, `payments` and `refunds` in this order after **Authorize**; the equivalent curl is in the middle column.

| # | Call | Expect |
|---|---|---|
| 1 | `curl $H $API/bookings/flight/$FLIGHT/policies` | 200, airline tiers (`daysBefore`, `refundPercent`) and baggage |
| 2 | `curl -X POST $H -H 'content-type: application/json' -d '{"accepted":true}' $API/bookings/flight/$FLIGHT/accept-policies` | 200 `{policiesAcceptedAt}`. Sending `accepted:false` is 400 |
| 3 | `curl -X POST $H -H 'content-type: application/json' -d "{\"bookingType\":\"FLIGHT\",\"bookingId\":\"$FLIGHT\"}" $API/payments` | 201 `{paymentId, clientSecret, amountMinor:25000, currency:"USD"}`. Before step 2 it is 409 |
| 4 | `curl -X POST $H $API/payments/<paymentId>/test-confirm` | 200 `{confirmed:true}`. Dev only: confirms the PaymentIntent with Stripe's `pm_card_visa`; it is a 404 when `NODE_ENV=production`. It does not confirm the booking |
| 5 | Watch Terminal B | `payment_intent.succeeded` forwarded, API answers 200 `{received:true}` |
| 6 | `curl $H $API/payments/<paymentId>` | 200, `status:"SUCCEEDED"`. The booking is now confirmed (exactly once, even if Stripe redelivers) |

Failure and retry (instead of step 4): `stripe trigger payment_intent.payment_failed` marks a payment FAILED while the booking stays pending; then `curl -X POST $H $API/payments/<paymentId>/retry` returns a new PaymentIntent until the hold expires. Retry on a payment that is not FAILED is 409. When the hold expires the open PaymentIntent is cancelled by `cancelForExpiredHold`.

## 3. Refund (PAY-03)

Refunds are issued by the cancellation flow (Karim's modules call `RefundsService.refundFor(type, id, reason)`): `USER` uses the frozen policy tier with the highest `daysBefore` not above the days remaining (no tier means 0%), `PROVIDER` is always 100%. A zero amount issues nothing and never calls Stripe. A positive amount creates a Stripe refund, stores it as `PENDING`, and the `refund.updated` (or `charge.refund.updated`) webhook moves it to `REFUNDED` or `FAILED`.

Until the cancellation endpoints exist this step is exercised by the e2e tests (see `docs/requirements/traceability.md`, PAY-03). Once a refund exists:

```bash
curl $H $API/refunds/<refundId>     # 200 {status: PENDING|REFUNDED|FAILED}; owner or admin only
```

## 4. Other routes shown in Swagger

| Route | Notes |
|---|---|
| `GET /api/currencies`, `GET /api/currencies/rates` | Public. Supported list and the cached daily rates with their date (ITN-18) |
| `GET /api/admin/audit-logs?page=1` | Admin only (`x-dev-role: ADMIN`), newest first, 10 per page, filters `actorId`, `action`, `from`, `to` |
| `GET /api/uploads/:filename` | Public. Serves a stored JPG/PNG |

Every error has the shape `{statusCode, error, message, fieldErrors?, path, timestamp}`.
