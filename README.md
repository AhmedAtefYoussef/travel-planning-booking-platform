# Travel Planning and Booking Platform

GIU Software Project I (Winter 2026). One web platform for flight and hotel booking, itinerary planning and budgeting, and travel blogging, built with the MVC stack from the brief:

| Layer | Technology | Folder |
|---|---|---|
| Model | MongoDB Atlas + Mongoose schemas and NestJS services | `backend/src/modules/*` |
| Controller | NestJS REST controllers, documented in Swagger | `backend/src/modules/*` |
| View | Next.js (App Router, TypeScript), Milestone 2 | `frontend/` |

## Repository layout

```
backend/            NestJS API (Milestone 1)
  src/config/       environment validation (fails fast on a missing or unsafe variable)
  src/common/       shared infrastructure: validation, errors, pagination, auth decorators, utils, contracts
  src/modules/      one folder per feature module: auth, users, flights, hotels, bookings, payments, reference,
                    audit, health and a development-only diagnostics module
  scripts/          seed, db:check, OpenAPI generation and the Swagger contract checks used by CI
frontend/           Next.js app (Milestone 2)
docs/requirements/  requirements.json (from the official workbook) and traceability.md
docs/architecture/  ERD and architecture decision records (ADRs)
docs/api/           API conventions every module follows
docs/setup/         environment and MongoDB Atlas setup
docs/process/       review checklist
docs/ONBOARDING.md  first day: clone to first merged PR
AI_PROMPTS.txt      mandatory AI prompt log (brief section 11.1)
.env.example        every environment variable the backend needs, without values
```

## Getting started

New to the team? Follow [docs/ONBOARDING.md](docs/ONBOARDING.md): it covers access, `.env`, `db:check`, the Swagger `dev-user` stub and your first PR. The short version:

Prerequisites: Node.js 22 LTS or newer, npm, and access to the team MongoDB Atlas cluster.

```bash
npm install                     # repo tooling: git hooks and commit linting
cd backend && npm install
cp ../.env.example .env         # then fill in MONGODB_URI and the secrets you were given privately
npm run seed                    # load the official reference data (GEN-12); safe to run again
npm run start:dev               # http://localhost:3000/api, Swagger at http://localhost:3000/api/docs
```

`npm run seed` loads the official reference datasets from `backend/seed/data` (Countries, Cities, Airports and
Attractions CSVs, brief section 5.1) and derives the supported currencies from Countries.csv. It validates the files
first and writes nothing if a rule fails. Records are upserted by their dataset ids (country `code`, `city_id`,
`iata_code`, `attraction_id`), so running it again never creates duplicates.

`backend/.env` is gitignored. Never commit it, and never paste the connection string into chat, issues or AI tools.

## Run the Milestone 1 demo in Swagger

Swagger is at http://localhost:3000/api/docs. Sign in with real cookies: `POST /api/auth/login` sets httpOnly
cookies, and Swagger sends them with every later call. For this, set `AUTH_STUB=false` in `backend/.env`; the
`x-dev-user` stub is only a development shortcut. The seed loads the reference data and one administrator
(`ADMIN_SEED_EMAIL`), but no airlines, flights, hotels or rooms, so the demo creates them in this order:

1. **Administrator** (`POST /api/auth/login` with the seeded admin):
   - `POST /api/airlines` and `POST /api/hotels` (city from `GET /api/cities`). Keep the ids.
   - `POST /api/admin/moderators` once for the airline and once for the hotel, each with a `temporaryPassword`
     you choose.
2. **Airline moderator** (log in, then `PATCH /api/auth/change-password`, which the temporary password requires):
   - `POST /api/flights` (airports from `GET /api/airports`, local times), then `POST /api/flights/{id}/cabins`.
   - `PUT /api/airlines/{id}/baggage-policy` and `PUT /api/airlines/{id}/cancellation-policy`.
3. **Hotel moderator** (log in and change the password the same way):
   - `POST /api/hotels/{id}/rooms`, then `POST /api/hotels/{id}/rooms/{roomId}/availability`.
4. **Traveller** (`POST /api/auth/register`, then log in):
   - `GET /api/flights/search` (or `/search/round-trip`), `POST /api/flight-bookings/quote`, then
     `POST /api/flight-bookings/hold`: a 10-minute Pending Payment booking.
   - `POST /api/hotel-bookings` holds the selected rooms the same way.
   - `GET /api/bookings/{type}/{id}/policies`, then `POST /api/bookings/{type}/{id}/accept-policies`.
   - `POST /api/payments` (PAY-01, from #62) returns a `paymentIntentId`; pay it with the Stripe CLI (below), then
     `GET /api/flight-bookings/{id}` shows CONFIRMED with an `FL-` reference (`HT-` for hotels).

### Stripe test mode

`STRIPE_SECRET_KEY` must be a test key (`sk_test_...`); the backend refuses any other. With the
[Stripe CLI](https://docs.stripe.com/stripe-cli) logged in to the same test account:

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
```

It prints a `whsec_...` signing secret: put it in `STRIPE_WEBHOOK_SECRET` and restart the API. Then, with the
`paymentIntentId` from `POST /api/payments`:

```bash
stripe payment_intents confirm <paymentIntentId> --payment-method pm_card_visa
```

`pm_card_chargeDeclined` makes the attempt fail (`POST /api/payments/{id}/retry` then tries again until the hold
ends). Only the signature-verified webhook confirms a booking; card details never reach this API.

## Quality gate

Run this in `backend/` before opening a pull request. CI runs the same checks:

```bash
npm run verify    # prettier, eslint (0 warnings), tsc, unit + e2e tests, build, Swagger contract, architecture rules
```

## Workflow

Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first branch. In short: branch from the latest `develop` as `feature/<REQ-ID>-<desc>`, write Conventional Commits, open a PR into `develop` with the template filled in, and get every check green plus a team-leader review.
