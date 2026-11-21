# ADR-0007: Per-IP rate limiting

- Status: Accepted (Milestone 1 hardening, TRVL-183).
- Requirements: GEN-13 (backend-enforced security), ACC-05 (login lockout), PAY-01 (Stripe payments).

## Context
ACC-05 locks one account after 5 wrong passwords, but nothing stopped one client from trying a password
against many accounts, from creating accounts in bulk, or from calling Stripe through `POST /api/payments`
in a loop. Every other route was unlimited too.

## Decision
- **`@nestjs/throttler` runs as the first global guard** (`CommonModule`), before authentication, so a flood
  is refused before any token check or database query. Limits are per client IP and per endpoint, over a
  one-minute window (`common/security/rate-limit.ts`):

  | Endpoint | Limit per IP per minute |
  |---|---|
  | `POST /api/auth/login`, `POST /api/auth/register` | 10 each |
  | `POST /api/payments`, `POST /api/payments/:id/retry` | 20 each |
  | `POST /api/payments/webhook`, `GET /api/health` | none (Stripe and uptime probes) |
  | every other route | 120 |

- **A refused request answers 429 `TOO_MANY_REQUESTS`** in the standard error body (GEN-02), with a
  `Retry-After` header of at most 60 seconds.
- **`RATE_LIMIT_ENABLED`**: unset means on everywhere except `NODE_ENV=test`, because the e2e suites log in
  many times a minute from one address. `test/rate-limit.e2e-spec.ts` turns it on for its own app.
- **`TRUST_PROXY`**: the number of reverse proxies in front of the API. Behind a proxy (a cloud deployment)
  every request would otherwise share the proxy's IP and one limit. Unset or `0` ignores `X-Forwarded-For`,
  so a client cannot pick a fresh address by sending that header.

## Consequences
- Counters live in memory, per API process. One instance is all Milestone 1 runs; several instances behind a
  load balancer would each allow the full limit, and would need a shared store (Redis) instead.
- A live Swagger demo stays far below 10 logins a minute. A class demo where everyone shares one NAT address
  could reach it; set `RATE_LIMIT_ENABLED=false` for that session rather than raising the limits.
