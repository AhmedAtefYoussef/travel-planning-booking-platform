# ADR-0003: Stripe PaymentIntents with webhook-verified confirmation

- Status: Accepted. Schemas implemented (TRVL-161); PAY-01 implemented (#62); PAY-03 refunds implemented (amendment 2026-11-15, refunds).
- Requirements: PAY-01, PAY-02, PAY-03, PAY-04, FLT-23, HTL-17. Brief section 6.4.

## Context
Card data must never reach the backend. A booking is confirmed only after the backend verifies payment success. Payments may be retried until the hold expires, and refunds go through Stripe.

## Decision
- **Test mode only:** env validation rejects any `STRIPE_SECRET_KEY` that is not `sk_test_...`.
- `POST /api/payments` checks ownership, status `PENDING_PAYMENT`, an unexpired hold and `policiesAcceptedAt` (PAY-02). It then creates a PaymentIntent for the booking's server-side total in `PLATFORM_CURRENCY`, card-only with no redirect methods (`automatic_payment_methods[allow_redirects]=never`, so confirming needs no `return_url`). It returns the payment with the PaymentIntent id and its `client_secret`; the secret is never stored. Card entry happens in Stripe Elements on the frontend.
- **Only the webhook confirms.** `POST /api/payments/webhook` is `@Public()`. It verifies the `Stripe-Signature` against the raw request body (`rawBody: true` in `main.ts`) using `STRIPE_WEBHOOK_SECRET`, then:
  1. opens **one transaction** that inserts the event id into `stripe_events`, marks the payment `SUCCEEDED` and calls `PayableBooking.markConfirmed`, which is idempotent and assigns the reference (FLT-23, HTL-17)
  2. a duplicate-key error on the event id means a replay of an event that was already committed, so it is acknowledged with 200 and ignored
  3. if anything else in the transaction fails, everything rolls back, including the event id, and the webhook returns 500 so Stripe retries the same event
  4. after commit, notifies the user (GEN-01)

  The event id is never committed separately from its effects. Otherwise a failure after the insert would make Stripe's retry look like a replay, leaving a paid booking unconfirmed.
- Stored payment data: Stripe ids, amount, currency, status and attempt count. No card fields; CI guard rails reject them.
- Refunds use `computeRefundQuote` on the booking's **policy snapshot**: user cancellations get the tier percentage rounded down, provider cancellations get 100%. A `refunds` document is created `PENDING`, the refund goes through the Stripe Refunds API, and the webhook updates it to `REFUNDED` or `FAILED` (PAY-03).

## Consequences
- The client cannot fake a payment: confirmation needs a signed event from Stripe.
- Unique indexes (one SUCCEEDED payment per booking, one refund per booking, unique event id) make retries and replays safe.
- Local development needs `stripe listen --forward-to localhost:3000/api/payments/webhook` to receive events.

## Amendment, 2026-11-14 (PAY-01, #62)
- **No Stripe SDK.** `HttpStripeGateway` calls Stripe's REST API with Node's `fetch` behind a `STRIPE_GATEWAY` port, so no new dependency enters the supply chain. e2e tests swap in an in-memory fake. The `Stripe-Signature` check (`stripe-signature.ts`: HMAC-SHA256 over `t.rawBody`, constant-time comparison, 5-minute tolerance) is our own code, and the tests run the real check against events signed with the test secret.
- **Payment gate.** `POST /api/payments` and the retry both pass `assertPayable` (PAY-02, PAY-04).
- **One open PaymentIntent per booking.** It is created with the idempotency key `checkout:<type>:<bookingId>:<payment count>`. Concurrent requests get the same PaymentIntent, and its unique id leaves exactly one payment document. A PaymentIntent cancelled while the hold is still valid gets a successor.
- **Retry** reuses the same PaymentIntent (Stripe puts it back to `requires_payment_method` after a failure) and increments `attempts`. If Stripe has cancelled or lost that PaymentIntent while the hold is still valid, the payment is closed as CANCELED and a successor payment (new id, new PaymentIntent) is returned; clients use the id in the retry response.
- **Stripe errors (amendment 2026-11-15).** Failures a later attempt can get past (network, 429, 5xx, `idempotency_key_in_use`) answer 503. Any other rejection means our request or configuration is wrong, so it is a logged 500 that never repeats Stripe's text. Create and retry need a usable client secret, so they surface these errors instead of returning a payment without one; a plain `GET` still answers without the secret. A late refund that Stripe refuses for good (e.g. `charge_already_refunded`) is closed as FAILED with its reason instead of being re-sent every minute.
- **Webhook outcomes.** Any failure while applying an event answers 5xx (a domain 404/409 included), so Stripe redelivers it. A reference collision re-runs the whole transaction, because `withTransaction` does not retry duplicate keys.
- **Cancel on expiry.** Each payment stores its booking's hold end (`holdEndsAt`). A minute job cancels open PaymentIntents past it:
  - if Stripe already captured one, the job applies that capture as the succeeded webhook would;
  - a PaymentIntent Stripe no longer has is closed;
  - anything else unsettled is retried with backoff, so it never blocks the batch.
- **Late success.** If the booking can no longer be confirmed (the hold expired first), the webhook transaction still records the payment as SUCCEEDED, plus a PENDING refund with the new reason `HOLD_EXPIRED` (100%). After commit, the full refund is requested from Stripe. If that request fails, it is logged and the same minute job re-sends it (same idempotency key) until Stripe has it. A missing booking or an invalid state leads to the same refund. The captured amount and currency must match the payment.
- **Notification.** The GEN-01 notification after confirmation comes with FLT-23/HTL-17, once the notifications module exists.

## Amendment, 2026-11-15 (PAY-03 refunds, PAY-04; TRVL-69, TRVL-109)
- **Refund outbox.** `REFUNDS_SERVICE.refundFor` (`RefundsServiceImpl`) never calls Stripe. Inside the caller's transaction it upserts ONE PENDING refund per booking (`one_refund_per_booking`) and writes the REFUND_ISSUED notification (GEN-01); a zero amount records nothing. One second later an unref'd timer runs the dispatcher, which reads only committed refunds, so an aborted cancellation never reaches Stripe. The 60 s payments job runs the same dispatcher (`dispatchPendingRefunds`, replacing `retryPendingRefunds`) for every reason, so a refund the kick missed (restart, Stripe outage) is still sent.
- **Idempotency.** `late-refund:<paymentId>` for HOLD_EXPIRED (unchanged; still a full refund without an amount), `refund:<refundId>` otherwise. Stripe metadata is `{ refundId, paymentId, reason }`, except HOLD_EXPIRED, whose request stays exactly PAY-01's (`{ paymentId, reason }`) so a refund already in flight under its key never gets `idempotency_error`.
- **Settling exactly once.** Stripe's synchronous answer and the `refund.created`, `refund.updated` and `refund.failed` webhooks map `succeeded` to REFUNDED and `failed`/`canceled` to FAILED; `pending`/`requires_action` stay PENDING. Every settlement is one conditional update on `{ _id, status: PENDING }` in a transaction with the REFUND_UPDATED notification, so whichever source arrives first settles the refund and the others change nothing and notify nobody. Webhook events are deduplicated by `stripe_events` as before.
- **Out of order.** The webhook finds the refund by `stripeRefundId` or, when it beats the dispatcher saving that id, by `metadata.refundId` (only if that refund has no other Stripe id yet) or, for a late refund, by `metadata.paymentId`, and saves the id itself. A Stripe status that contradicts a refund already settled (e.g. failed after REFUNDED) leaves it unchanged and is logged as an error with the refund id, Stripe id and code, for a person to check. The dispatcher isolates each refund, so one failure never stops the batch.
- **Failure reasons** are `stripe:<code>` (the refund's `failure_reason`, or the API error code); Stripe's text is never stored. Config errors and outages keep the refund PENDING with back-off (1 min doubling to 1 h); terminal codes close it as FAILED.
- **PAY-04.** `refundFor` refuses (plain `Error`) a quote outside `PLATFORM_CURRENCY` or above the amount paid.
- **Module wiring.** The payments module is `@Global()` and exports `REFUNDS_SERVICE`, so bookings reads refunds through the token without importing payments. `RefundsServiceImpl` depends on no booking contract, so there is no provider cycle (no `forwardRef`).
