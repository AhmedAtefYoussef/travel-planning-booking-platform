# Onboarding: from clone to your first merged PR

Follow this page top to bottom on your first day. It takes about 15 minutes. Each step names the command and what you should see. If a step fails, stop and ask in the team chat. Don't work around it.

## 1. Get access

1. Accept the GitHub invitation: open the email, or go to <https://github.com/AhmedAtefYoussef/travel-planning-booking-platform/invitations>. **You cannot push until you accept it.**
2. Check that you can see the TRVL project in Jira and the issues labelled with your name (`owner-<name>`).
3. Ask the team leader, **privately**, for the MongoDB Atlas connection string. Never post it in a chat group, an issue, a PR or an AI tool.

## 2. Install and configure

Prerequisites: Node.js 22 LTS or newer, and Git.

```bash
git clone https://github.com/AhmedAtefYoussef/travel-planning-booking-platform.git
cd travel-planning-booking-platform
npm install                 # git hooks and commit linting for the whole repo
cd backend
npm ci
cp ../.env.example .env     # backend/.env is gitignored
```

Open `backend/.env` and set:

| Variable | Value |
|---|---|
| `MONGODB_URI` | The string you were given. **It must end in `/travel_platform`** (before any `?`). Without that you write to a database called `test`. |
| `JWT_SECRET` | Any random string of 32 or more characters, e.g. the output of `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_SEED_PASSWORD` | Any password of 12 or more characters. Don't reuse a real one. |

Leave the rest as it is. The Stripe and FX placeholders are fine until you work on PAY-01 or ITN-18.

## 3. Check the database, seed it, run the API

```bash
npm run db:check     # expect: replica set, transactions supported, database travel_platform
npm run seed         # loads the official countries, cities, airports and attractions; safe to run again
npm run start:dev    # API on http://localhost:3000/api
```

- Open <http://localhost:3000/api/health>. You should see `"db": "up"`.
- Open <http://localhost:3000/api/docs>; this is Swagger.
- `http://localhost:3000/api` on its own returns 404 by design.

## 4. Call a protected route in Swagger

Real login (ACC-04, ACC-19) isn't built yet. Until it is, the backend accepts a **stub header** from localhost when `AUTH_STUB=true`:

1. In Swagger, click **Authorize** and fill in **dev-user** with one of the values below.
2. `<userId>` and `<providerId>` are any 24-character hex ids, e.g. `65a000000000000000000001`. For a moderator, use the `_id` of an airline or hotel that exists.

| You want to act as | `dev-user` value |
|---|---|
| Administrator | `ADMIN` |
| A registered traveller | `USER:65a000000000000000000001` |
| An airline moderator | `AIRLINE_MODERATOR:65a000000000000000000002:<airlineId>` |
| A hotel moderator | `HOTEL_MODERATOR:65a000000000000000000003:<hotelId>` |

For example, `POST /api/airlines` as `ADMIN` creates an airline. `PATCH /api/airlines/{id}` as that airline's moderator edits it, and as any other user it returns 403.

Write your module against `@CurrentUser()`, `@Roles()` and `@Public()`. When the real cookie login replaces the stub, your code doesn't change (`docs/api/conventions.md`, "Authentication and authorization"). The plan for switching to real login is in [docs/architecture/auth-migration.md](architecture/auth-migration.md).

## 5. Start your first issue

1. In Jira, move the issue to **In Progress**.
2. Create the branch from the latest `develop`:
   ```bash
   git checkout develop && git pull origin develop
   git checkout -b feature/HTL-11-hotel-search      # feature/<REQ-ID>-<short-desc>, one requirement per branch
   ```
3. Build it the way the flights module is built (section 7 below).
4. Commit small, working steps with Conventional Commits that end in the requirement ID, e.g. `feat(hotels): search hotels by city and dates [HTL-11]`. The commit hook rejects anything else.

## 6. Open the pull request (within a day of starting)

**Open a PR early,** as a draft if it isn't finished. A 300-line PR is reviewed in an hour. Ten PRs opened at once wait two days and conflict with each other.

1. Run the local gate in `backend/`: `npm run verify`. CI runs the same steps.
2. Add your entry at the bottom of `AI_PROMPTS.txt` if AI helped (the format is at the top of the file).
3. Push, then open the PR **into `develop`** (never `main`, and never another feature branch). Fill in every template section. Tick a checklist item that doesn't apply and write `(N/A)` after it.
4. Now that the PR has a number, update your requirement's row in `docs/requirements/traceability.md`: the endpoint, the PR number (e.g. `#31`) and the status it will have once merged (`Done`, or `Partial: <what is done>`). Commit and push it. CI fails until the row cites this PR.
5. Comment the PR link on the Jira issue.
6. Check your own diff against [docs/process/review-checklist.md](process/review-checklist.md), then request a review from the team leader (@AhmedAtefYoussef). They are the only reviewer and the only person who merges, so never press Merge yourself.
7. Once they have merged it, move the Jira issue to **Done** and delete your local branch.

Don't stack PRs on top of each other's branches. CI and the security scans only run for PRs into `develop` or `main`. If your work depends on an unmerged PR, wait for it or ask for it to be merged first.

## 7. Module starter: copy the flights layout

Every feature module looks like `backend/src/modules/flights`:

```
modules/<module>/
  index.ts                 public API: the module class, and the schemas/types other modules may use
  <module>.module.ts       MongooseModule.forFeature([...EVERY schema of the module...]), controllers, providers
  <thing>.controller.ts    HTTP only: DTO in, service call, DTO out. Never touches a Mongoose model.
  <thing>.service.ts       business rules, ownership/provider checks, database access
  <thing>.service.spec.ts  unit tests for the rules
  dto/                     class-validator DTOs (+ .spec.ts)
  schemas/                 one file per collection, using SCHEMA_OPTIONS from common/contracts
backend/test/<thing>.e2e-spec.ts   HTTP-level tests against an in-memory replica set
```

Checklist for a new module:
- [ ] Every schema is registered in `forFeature`. An unregistered schema never gets its indexes, so a unique index (`{roomId, date}`) silently protects nothing.
- [ ] The module is imported in `src/app.module.ts`.
- [ ] Schemas spread `SCHEMA_OPTIONS`, use `isActive` (what `ACTIVE_PROVIDER_FILTER` matches) and `@Prop({ type: MongooseSchema.Types.ObjectId })` for references (never `Types.ObjectId`).
- [ ] DTOs use `Omittable`, `IsWholeNumber` and `safeInteger` from `common/validation` (see the table in `docs/api/conventions.md`).
- [ ] Other modules reach you only through `index.ts` or a token in `common/contracts` (`docs/architecture/contracts.md`). If you provide a token, add it to the table there.
- [ ] Every Swagger summary starts with the requirement ID, e.g. `HTL-11 Search hotels`.

## Where to find things

| Question | Read |
|---|---|
| Errors, lists, money, time, auth, validation helpers | [docs/api/conventions.md](api/conventions.md) |
| How modules call each other | [docs/architecture/contracts.md](architecture/contracts.md) |
| Collections and relationships | [docs/architecture/erd.md](architecture/erd.md) |
| Why things are built this way (holds, payments, cookies) | [docs/architecture/adr/](architecture/adr/) |
| What each requirement needs and its status | [docs/requirements/traceability.md](requirements/traceability.md) and the Jira issue |
| Branches, commits, PR rules, Definition of Done | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| What the team leader checks in review | [docs/process/review-checklist.md](process/review-checklist.md) |
