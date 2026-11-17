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
docs/api/           API conventions, the Swagger demo script and the exported openapi.json
docs/setup/         environment and MongoDB Atlas setup
docs/process/       review checklist
docs/ONBOARDING.md  first day: clone to first merged PR
AI_PROMPTS.txt      mandatory AI prompt log (brief section 11.1)
.env.example        every environment variable the backend needs, without values
```

## Getting started

New to the team? Follow [docs/ONBOARDING.md](docs/ONBOARDING.md): it covers access, `.env`, `db:check`, the Swagger `dev-user` stub and your first PR. The short version:

Prerequisites: Node.js 22 LTS or newer, npm, Git, a MongoDB connection string for the team Atlas cluster (a replica
set: payments and bookings use transactions) and, for the payment demo, a Stripe account in test mode with the
[Stripe CLI](https://docs.stripe.com/stripe-cli) logged in.

```bash
git clone https://github.com/AhmedAtefYoussef/travel-planning-booking-platform.git
cd travel-planning-booking-platform
npm install                     # repo tooling: git hooks and commit linting
cd backend && npm install
cp ../.env.example .env         # then fill in MONGODB_URI and the secrets you were given privately
npm run seed                    # reference data (GEN-12) and the admin account (ACC-18); safe to run again
npm run seed:demo               # optional: demo airline, hotel, flights, rooms and accounts; safe to run again
npm run start:dev               # http://localhost:3000/api, Swagger at http://localhost:3000/api/docs
```

`npm run seed` loads the official reference datasets from `backend/seed/data` (Countries, Cities, Airports and
Attractions CSVs, brief section 5.1) and derives the supported currencies from Countries.csv. It validates the files
first and writes nothing if a rule fails. Records are upserted by their dataset ids (country `code`, `city_id`,
`iata_code`, `attraction_id`), so running it again never creates duplicates. It also creates the admin from
`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` (an existing admin is left unchanged).

`npm run seed:demo` (run `seed` first) adds "Demo Air" with two flights and its moderator, "Demo Nile Hotel" with two
rooms and its moderator, and one traveller. It goes through the same services as the API, needs `DEMO_PASSWORD`, and
running it again changes nothing. It prints the ids of the demo airline, flights, cabins, hotel and rooms (never a
password) for the Swagger demo script; the demo flights and hotel dates are in March 2028, so bump them in
`backend/scripts/demo-data.ts` after that.

`backend/.env` is gitignored. Never commit it, and never paste the connection string into chat, issues or AI tools.

### Environment variables

Copy `.env.example` to `backend/.env`. The API validates it at startup and refuses to boot on a missing or malformed
required variable, naming it. The file holds placeholders only.

| Variable | Required | Meaning and example |
|---|---|---|
| `NODE_ENV` | yes | `development`, `test` or `production` |
| `PORT` | no (3000) | HTTP port |
| `CORS_ORIGINS` | no | Comma-separated origins allowed to send cookies, e.g. `http://localhost:3001` |
| `MONGODB_URI` | yes | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/travel_platform?...`; the path must be `/travel_platform` |
| `JWT_SECRET` | yes | 32 or more random characters |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | yes | Token lifetimes, e.g. `15m`, `7d` |
| `SESSION_IDLE_MINUTES` | yes | Idle minutes before a session ends, e.g. `30` |
| `COOKIE_SECURE` | yes | `true` behind HTTPS, `false` for local http |
| `AUTH_STUB` | no (false) | `true` accepts the `x-dev-user` header (local development only); set `false` for the demo and any shared environment |
| `PLATFORM_CURRENCY` | yes | The one currency of every price, e.g. `USD` (one of AED, EGP, EUR, GBP, JPY, SAR, USD) |
| `STRIPE_SECRET_KEY` | yes | Stripe test key, `sk_test_...` (live keys are refused) |
| `STRIPE_WEBHOOK_SECRET` | yes | The `whsec_...` that `stripe listen` prints (see below) |
| `FX_API_KEY`, `FX_API_BASE_URL` | yes | Exchange-rate service key and URL (ITN-18); server-side only |
| `UPLOAD_DIR` | yes | Where uploaded images are stored, e.g. `./uploads` |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | yes | The administrator `npm run seed` creates |
| `DEMO_PASSWORD` | only for `seed:demo` | The password of the demo moderators and traveller |

Password rules (everywhere a password is set, including both seed passwords): at least 8 characters, at least one
letter and one digit, at most 72 bytes.

### Seeded accounts

| Role | Email | Password | Created by |
|---|---|---|---|
| Administrator | `ADMIN_SEED_EMAIL` (`admin@example.com` in `.env.example`) | `ADMIN_SEED_PASSWORD` | `npm run seed` |
| Airline moderator (Demo Air) | `demo.airline@example.com` | `DEMO_PASSWORD` | `npm run seed:demo` |
| Hotel moderator (Demo Nile Hotel) | `demo.hotel@example.com` | `DEMO_PASSWORD` | `npm run seed:demo` |
| Traveller | `demo.traveller@example.com` | `DEMO_PASSWORD` | `npm run seed:demo` |

The demo moderators are not forced to change their password at first login. Moderators an admin creates through
`POST /api/admin/moderators` are (ACC-13); any traveller can sign up with `POST /api/auth/register`.

## Run the Milestone 1 demo in Swagger

Swagger is at http://localhost:3000/api/docs. Sign in with real cookies: `POST /api/auth/login` sets httpOnly
cookies, and Swagger sends them with every later call. For this, set `AUTH_STUB=false` in `backend/.env`; the
`x-dev-user` stub is only a development shortcut.

The step-by-step call order per role (Administrator, Airline moderator, Hotel moderator, Traveller), with request
bodies and expected statuses, is in **[docs/api/demo-script.md](docs/api/demo-script.md)**. The exported
specification is [docs/api/openapi.json](docs/api/openapi.json) (refresh with `npm run openapi:export`).

### Stripe test mode

`STRIPE_SECRET_KEY` must be a test key (`sk_test_...`); the backend refuses any other. With the Stripe CLI (1.55 or
newer) logged in to the same test account, forward the events the API handles (one line):

```bash
stripe listen --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,refund.created,refund.updated,refund.failed --forward-to localhost:3000/api/payments/webhook
```

It prints a `whsec_...` signing secret. Use it as `STRIPE_WEBHOOK_SECRET`, either in `backend/.env` or as an override
for one run (Git Bash or Linux: `STRIPE_WEBHOOK_SECRET=whsec_... npm run start:dev`; PowerShell:
`$env:STRIPE_WEBHOOK_SECRET='whsec_...'; npm run start:dev`), and restart the API. Then, with the
`paymentIntentId` from `POST /api/payments`:

```bash
stripe payment_intents confirm <paymentIntentId> --payment-method pm_card_visa
```

`pm_card_chargeDeclined` makes the attempt fail (`POST /api/payments/{id}/retry` then tries again until the hold
ends). Only the signature-verified webhook confirms a booking; card details never reach this API.

## Feature map

Each module, its Swagger tag and the requirements it covers (status per requirement is in
[docs/requirements/traceability.md](docs/requirements/traceability.md)). Only merged work is listed; the matrix
shows what is still open.

| Module (`backend/src/modules/`) | Swagger tag | Requirements |
|---|---|---|
| `auth` | Auth | ACC-01, ACC-04, ACC-05, ACC-06, ACC-08, ACC-19 |
| `users` | Users, Admin: accounts | ACC-07a, ACC-09, ACC-11, ACC-12, ACC-13, ACC-14 |
| `audit` | Admin: audit log | GEN-07 |
| `notifications` | notifications | GEN-01 |
| `flights` | Airlines, Flights | FLT-01, FLT-03, FLT-04, FLT-05, FLT-08, FLT-09, FLT-11, FLT-12, FLT-15, FLT-17 |
| `bookings` | flight-bookings, hotel-bookings, booking-policies | FLT-19 to FLT-23, HTL-16 to HTL-18, PAY-02, GEN-11 |
| `hotels` | Hotels | HTL-01, HTL-03, HTL-04, HTL-05 |
| `payments` | payments, refunds | PAY-01, PAY-03 |
| `currency` | currency | ITN-18, PAY-04 |
| `reference` | Reference data | GEN-12, FLT-02 |
| `uploads` | (inside Airlines and Hotels) | GEN-08 |
| `health`, `diagnostics` | Health, Diagnostics (dev only) | TRVL-128, GEN-02, GEN-05, GEN-13 |

## Quality gate

Run this in `backend/` before opening a pull request. CI runs the same checks:

```bash
npm run verify    # prettier, eslint (0 warnings), tsc, unit + e2e tests, build, Swagger contract, architecture rules
```

## Workflow

Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first branch. In short: branch from the latest `develop` as `feature/<REQ-ID>-<desc>`, write Conventional Commits, open a PR into `develop` with the template filled in, and get every check green plus a team-leader review.
