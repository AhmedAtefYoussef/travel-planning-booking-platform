# ADR-003: Stripe PaymentIntents confirmed only by the verified webhook

Status: Accepted (Milestone 1). Requirements: PAY-01, PAY-03, PAY-04.

## Context

Card data must never reach our servers, and a booking must never be confirmed because a client claims the payment worked. Stripe can deliver an event more than once.

## Decision

- The backend creates a PaymentIntent (`POST /api/payments`) and returns the `clientSecret`; the M2 frontend collects the card with Stripe Elements. We store only the Stripe id, amount, currency and status. Test mode only.
- Confirmation happens solely in `POST /api/payments/webhook`, a `@Public()` route that verifies the `stripe-signature` header against the raw body (`NestFactory.create(AppModule, { rawBody: true })`, `STRIPE_WEBHOOK_SECRET`). A bad or missing signature returns 400.
- On `payment_intent.succeeded` the handler re-retrieves the PaymentIntent and requires status `succeeded`, marks the payment SUCCEEDED and calls the `PAYABLE_BOOKING` contract `markConfirmed` once; a duplicate event is a no-op. `payment_intent.payment_failed` marks it FAILED and calls `markPaymentFailed`. Refund events move the refund to REFUNDED or FAILED.
- Creating a payment requires a booking in PENDING_PAYMENT, an unexpired hold and accepted policies. An existing pending payment is returned instead of creating a second one; `POST /api/payments/:id/retry` only works after FAILED while the hold is valid.
- Refunds use the Stripe Refunds API. The percentage is the tier with the highest `daysBefore` that is <= days remaining; no tier means 0% and no Stripe call; provider cancellations refund 100%.
- Development only: `POST /api/payments/:id/test-confirm` confirms the PaymentIntent with `pm_card_visa` to stand in for the frontend. It returns 404 when `NODE_ENV=production`, and the booking is still confirmed only by the webhook.
- Payments reach bookings only through the `PAYABLE_BOOKING` contract, so the modules can be built independently.

## Consequences

- Local runs need the Stripe CLI forwarding events to the webhook (see README).
- A lost webhook leaves a booking PENDING_PAYMENT until it expires; Stripe retries delivery, which makes this rare.
- The handler must be idempotent; the unique `stripeId` index and the status check back this up.
