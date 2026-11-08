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
  src/common/       shared infrastructure: config, validation, errors, pagination, auth decorators, contracts
  src/modules/      one folder per feature module (auth, flights, hotels, payments, itineraries, blog, admin, ...)
  scripts/          OpenAPI generation and Swagger contract checks used by CI
frontend/           Next.js app (Milestone 2)
docs/requirements/  requirements.json (from the official workbook) and traceability.md
docs/architecture/  ERD and architecture decision records (ADRs)
docs/api/           API notes and the Swagger demo script
docs/setup/         environment and MongoDB Atlas setup
AI_PROMPTS.txt      mandatory AI prompt log (brief section 11.1)
.env.example        every environment variable the backend needs, without values
```

## Getting started

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

## Quality gate

Run this in `backend/` before opening a pull request. CI runs the same checks:

```bash
npm run verify    # prettier, eslint (0 warnings), tsc, unit + e2e tests, build, Swagger contract, architecture rules
```

## Workflow

Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first branch. In short: branch from the latest `develop` as `feature/<REQ-ID>-<desc>`, write Conventional Commits, open a PR into `develop` with the template filled in, and get every check green plus a team-leader review.
