# Web-based Travel Planning and Booking Platform

NestJS + MongoDB backend (Milestone 1) for flights, hotels, itineraries, community posts and Stripe payments. The web frontend (`frontend/`) is a placeholder until Milestone 2.

```
backend/   NestJS 11 API (TypeScript, Mongoose, Jest)
frontend/  Milestone 2 placeholder
docs/      requirements/, architecture/ (ERD, ADRs), api/
```

## Prerequisites

- Node.js 20 or newer and npm
- A MongoDB database. MongoDB Atlas is the target; booking transactions need a replica set (Atlas has one)
- A Stripe account in test mode and the [Stripe CLI](https://stripe.com/docs/stripe-cli) for webhook forwarding
- Optional: an FXRatesAPI key for exchange rates

## Clone and install

```bash
git clone https://github.com/AhmedAtefYoussef/web-based-Travel-Planning-and-Booking-Platform-.git
cd web-based-Travel-Planning-and-Booking-Platform-/backend
npm ci
```

## Configure `backend/.env`

The template is `.env.example` at the repository root. Copy it to `backend/.env` and fill in your own values. Never commit `.env`; real keys belong only there.

```bash
cp ../.env.example .env
```

| Variable | Notes |
|---|---|
| `MONGODB_URI` | Required. Atlas or local connection string |
| `JWT_SECRET` | Required, at least 32 characters |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `SESSION_IDLE_MINUTES` | Defaults `15m`, `7d`, `30` |
| `PLATFORM_CURRENCY` | Default `USD` |
| `COOKIE_SECURE` | `true` behind HTTPS |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Test-mode `sk_test_...` and `whsec_...`; required in production |
| `FX_API_KEY`, `FX_API_BASE_URL` | Exchange-rate API |
| `UPLOAD_DIR` | Default `./uploads` |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | For the admin seed script (not part of the foundation yet) |
| `DEV_AUTH_ENABLED` | Local testing only, see below |

The app validates the file at startup and refuses to boot with missing or invalid values.

## npm scripts (run in `backend/`)

| Command | What it does |
|---|---|
| `npm run start:dev` | Start with file watching (http://localhost:3000) |
| `npm run start` | Start once |
| `npm run build` then `npm run start:prod` | Compile and run `dist/main` |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm test` | Unit tests (`*.spec.ts`) |
| `npm run test:cov` | Unit tests with coverage |
| `npm run test:e2e` | End-to-end tests |

Seed data, `npm run seed` and the seeded test accounts are not available yet. They arrive with ACC-18 and GEN-12, which belong to teammates. Until then, use the `x-dev-*` headers described below.

## API documentation (Swagger)

With the server running, open http://localhost:3000/api/docs. The raw spec is at http://localhost:3000/api/docs-json. All routes are under the `/api` prefix.

## Testing locally without the auth module: `DEV_AUTH_ENABLED`

Until real login ships, a temporary guard accepts identity headers. It is off by default; enable it in `backend/.env`:

```
NODE_ENV=development
DEV_AUTH_ENABLED=true
```

Then send these headers (in Swagger UI use the request headers, or curl):

- `x-dev-user-id`: a 24-character hex ObjectId
- `x-dev-role`: `USER`, `ADMIN`, `AIRLINE_MOD` or `HOTEL_MOD`
- `x-dev-provider`: the moderator's provider id (moderators only)

It only works when `NODE_ENV` is `development` or `test`; the app refuses to start with `DEV_AUTH_ENABLED=true` in production. Requests without the headers get 401, except `@Public` routes.

## Payments with Stripe (test mode)

1. Put your test `STRIPE_SECRET_KEY` in `backend/.env`.
2. In a second terminal forward Stripe events to the webhook:

   ```bash
   stripe listen --forward-to localhost:3000/api/payments/webhook
   ```

3. Copy the `whsec_...` signing secret the CLI prints into `STRIPE_WEBHOOK_SECRET` and restart the backend.
4. Create a payment with `POST /api/payments`, then simulate the card step with the dev-only endpoint `POST /api/payments/:id/test-confirm`. It confirms the PaymentIntent with the test card `pm_card_visa`; the booking is confirmed only when the signed webhook arrives. The endpoint returns 404 when `NODE_ENV=production`.

See `docs/architecture/adr-003-payments-webhook.md` for the design.

## Tests

`npm test` runs unit tests. `npm run test:e2e` starts an in-memory MongoDB replica set (`mongodb-memory-server`, downloaded on first run) and mocks Stripe, so it needs no Atlas connection or Stripe key; it sets `NODE_ENV=test` and `DEV_AUTH_ENABLED=true` itself.

## Documentation

- `docs/architecture/erd.md` - data model (Mermaid ERD) with collection owners
- `docs/architecture/adr-001-auth-cookies.md`, `adr-002-inventory-concurrency.md`, `adr-003-payments-webhook.md`, `adr-004-money-and-time.md`
- `docs/requirements/plan.md` - engineering plan and team workflow
- `AI_PROMPTS.txt` - AI usage log

## Conventions

Money is integer minor units (USD cents); times are UTC. Lists use `?page=N` with a fixed page size of 10 and return `{items, page, limit, total, totalPages}`. Errors return `{statusCode, error, message, fieldErrors?, path, timestamp}`. Commits follow Conventional Commits with the requirement ID, for example `feat(payments): ... [PAY-01]`.

## Pull requests and merging

Merging is automated with GitHub Actions only, using no external keys:

1. Push your work to a branch such as `feature/FLT-11-round-trip` or `fix/HTL-18-overlap`. If no PR exists yet, **PR Automation** opens one into `develop`, titled after your first commit. Edit its description to add context.
2. Two required checks run on every push:
   - **`build-lint-test`** (CI): the `AI_PROMPTS.txt` entry format and `.env.example` vs `env.schema.ts` (`.github/scripts/repo-consistency.mjs`), then `npm ci`, lint, build, unit and e2e tests in `backend/`, and finally that `docs/api/openapi.json` matches the code (run `npm run openapi:export` and commit it when you change an endpoint).
   - **`pr-requirements`**: the PR rules in `.github/scripts/pr-requirements.mjs`. They cover the base branch, merge conflicts, branch name, a Conventional Commit title with a requirement ID that exists in `docs/requirements/reqs.json`, the "What" and "How to verify" sections, Conventional Commit messages, tests for changed services, `[ID]` in Swagger summaries, no `.env`/build/credential files and no secrets, plus a warning when a referenced ID has no row in `docs/requirements/traceability.md`. The rules and `reqs.json` are read from the base branch, so a PR cannot change the rules it is checked by. The result is posted as one comment on the PR.
3. Nothing merges automatically. Once both checks are green and the branch is up to date with `develop`, the team leader reviews, approves and merges the PR. Every PR needs the team leader's approval (`.github/CODEOWNERS`), and a push after the approval needs a fresh one.

Release PRs (`develop` → `main`) are checked the same way and merged by the team leader.
