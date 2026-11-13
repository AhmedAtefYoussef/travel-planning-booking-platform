# Milestone 1 verification & validation report

Scope: every requirement that is **Done** or **Partial** in [traceability.md](../../requirements/traceability.md) on `develop` @ `fc610e0` (PRs #1 to #53). Open PR #54 (HTL-05) was reviewed before merge on a local merge with `develop`.
Run on 2026-11-13 by the team leader with Claude Code (AI-assisted, logged in AI_PROMPTS.txt). Milestone 1 is evaluated through Swagger UI on 2026-11-20.

**Result: no Critical or High defects. 239 of 279 atomic rules pass.**

| | Count |
|---|---|
| Atomic rules traced | 279 |
| PASS | 239 |
| FAIL | 11 |
| PARTIAL | 5 |
| BLOCKED-BY a feature not built yet | 22 |
| UNTESTED (frontend half of a rule, or HTL-02 not built) | 2 |

The 11 FAIL rows come from 10 findings. Some of these were later downgraded to spec questions by an independent verifier (see [Defect log](#defect-log)).

All four tracks' new e2e specs pass. Each defect is pinned by an `it.failing` test, so CI stays green and the defect stays visible.

## Sources and order of authority

1. The workbook `Technical Requirements.xlsx` (mirrored in [requirements.json](../../requirements/requirements.json)).
2. The Jira TRVL story: the verbatim requirement plus the Definition of Done (400 with `fieldErrors`, scope checks, Swagger summary and error responses, a test for each rule).
3. Brief §8 endpoint table.
4. `Mock Data.xlsx` reference records.

Rules the code enforces but the workbook does not state are tagged `derived`. A derived rule can only produce a spec question, never a defect against its owner.

## Method

| Practice | How it was applied |
|---|---|
| V-model | *Verification*: code, DTOs and tests against each rule. *Validation*: live Swagger journeys per actor (guest, user, admin, airline moderator, hotel moderator) against workbook intent |
| Requirements-based testing | Each "shall" clause split into atomic rules `R-<ID>-nn`, each linked to code, an existing or new test, and evidence ([RTM files](#traceability-matrices)) |
| Test design | Equivalence classes and boundaries (password 7/8, failed login 4/5/6, lock 14/15 min, idle 29/31 min, seats 0/1, refund % -1/0/100/101, 10/11 rows per page), a login decision table, state transitions (Scheduled to Departed), time zones (DST gap and repeated hour, Tokyo +9 across the UTC date, local-date search window) |
| OWASP API Top 10 (2023) | Live matrix of 39 cells: BOLA (other airline, hotel and user ids), BFLA (admin and moderator routes as lower roles), broken authentication (stub header ignored, refresh reuse), mass assignment (`role`, `status`, `airlineId`, `isActive`). Every refusal was followed by a database check that nothing changed |
| Oracles | MongoDB state checked after mutating calls: UTC storage, salted bcrypt hashes (same password gives different hashes), `lockedUntil` +15 min, unchanged documents after refused calls |
| Concurrency | Parallel registration with one email, parallel moderator creation, parallel flight and airline creation, an 8-request parallel login burst |
| Consistency | Full e2e suite run twice on a fresh in-memory replica set (see [Consistency](#consistency)) |
| Independent verification | Every FAIL re-checked by a separate verifier agent that tried to refute it |

## Environment

- **Static baseline** (`npm run verify` on `fc610e0`): green. 598 unit tests, 335 e2e tests, 92.35 % line coverage, OpenAPI contract check and dependency-cruiser clean.
- **Live runs**: backend in `NODE_ENV=development` with `AUTH_STUB=false`, so every request used real httpOnly cookie sessions. The database was a separate Atlas database `travel_vv` on the team cluster; the shared team database was not touched.
- **e2e**: in-memory MongoDB replica set (the existing harness in `backend/test/support`).
- **Fixtures**, all created through the API: the seeded admin, users A to D, airlines X and Y each with a moderator, hotels P and Q each with a moderator.
  - User C was set SUSPENDED by a direct database write, because ACC-16 is not built yet.
  - User D deactivated their own account through the API (ACC-12).

## Reference data (GEN-12, FLT-02) against `Mock Data.xlsx`

These all match the official records exactly through the API and in the database:
- 8 countries with their currencies
- 8 cities (`cairo` to `frankfurt`)
- 8 airports with their IANA zones (FRA uses `Europe/Berlin`)
- 7 currencies (JPY with 0 minor units)
- attractions `att-1` to `att-8`, including the UTF-8 "Römerberg"

Re-running the seed changes no counts.

## Per-requirement verdicts

PASS, FAIL, PARTIAL and BLOCKED count atomic rules. *Live* means the rule was also run against the real server through Swagger or the browser.

| Requirement | Owner | PASS | FAIL | PARTIAL | BLOCKED | Live | Verdict |
|---|---|---|---|---|---|---|---|
| ACC-01 | Abdelrahman | 11 | | | | yes | PASS |
| ACC-04 | Abdelrahman | 8 | | | | yes | PASS |
| ACC-05 | Abdelrahman | 9 | 1 | 1 | | yes | PASS (spec question SQ-1) |
| ACC-06 | Abdelrahman | 5 | | | | | PASS |
| ACC-07a | Abdelrahman | 7 | | | | | PASS |
| ACC-08 | Abdelrahman | 6 | | | | yes | PASS |
| ACC-09 | Abdelrahman | 6 | | | | | PASS |
| ACC-11 | Abdelrahman | 3 | 1 | | 2 | yes (39-cell matrix) | PASS (spec question SQ-2) |
| ACC-12 | Abdelrahman | 3 | | | 3 | yes | PARTIAL, as declared (bookings block and content hiding wait for FLT-22/HTL-18 and BLG/ITN) |
| ACC-13 | Abdelrahman | 8 | | | | yes | PASS |
| ACC-14 | Abdelrahman | 6 | | | | yes | PASS |
| ACC-18 | Abdelrahman | 4 | | | | yes | PASS |
| ACC-19 | Abdelrahman | 4 | | | 1 | yes | PASS (frontend half in M2) |
| FLT-01 | Joudy | 8 | | | 1 | yes | PASS (logo upload waits for GEN-08) |
| FLT-02 | Joudy | 6 | | | | yes | PASS |
| FLT-03 | Joudy | 10 | 1 | | | yes | PASS, with D-01 on the Swagger example |
| FLT-04 | Joudy | 8 | | | | yes | PASS |
| FLT-05 | Joudy | 8 | | 1 | 2 | yes | PARTIAL, as declared (notification waits for GEN-01, price snapshot for FLT-22) |
| FLT-08 | Joudy | 4 | | | 1 | yes | PASS |
| FLT-09 | Joudy | 7 | | | 1 | yes | PASS |
| FLT-11 | Joudy | 7 | | 1 | 1 | yes | PARTIAL: held seats come from FLT-22 (see [Jira drift](#jira-drift)) |
| FLT-15 | Joudy | 7 | | | | yes | PASS |
| FLT-17 | Joudy | 6 | | | | yes | PASS |
| FLT-30 | Joudy | 4 | | | 2 | yes (live Departed) | PASS |
| GEN-06 | Joudy | 2 | | | | yes | PASS |
| GEN-12 | Joudy | 7 | | | | yes | PASS |
| HTL-01 | Sandra | 13 | 1 | 1 | 1 | yes | PASS, with D-03 |
| HTL-03 | Sandra | 12 | | | | yes | PASS |
| HTL-04 | Sandra | 14 | 1 | | | yes | PASS (spec question SQ-3) |
| HTL-05 (PR #54) | Sandra | 10 | 2 | | 2 | | Review notes for the PR (see [PR #54](#pr-54-htl-05-pre-merge-review)) |
| GEN-02 | Ahmed | 5 | 1 | | | yes | PASS, with D-02 |
| GEN-05 | Ahmed | 4 | | | | yes | PASS |
| GEN-13 | Ahmed | 5 | 1 | | | yes | PASS, with D-04 (hardening) |
| PAY-01, PAY-03, PAY-04, GEN-07, GEN-11, HTL-10 | Ahmed / Sandra | 9 | | | 5 | | The schema-only parts claimed in traceability.md are verified |
| Swagger (Jira DoD) | all | 3 | 2 | 1 | | yes | D-01, D-05 |

## Defect log

Every FAIL was given to an independent verifier that tried to refute it. Only CONFIRMED items are proposed as Jira Bugs; the rest are in [Spec questions](#spec-questions).

| ID | Sev | Req | Owner | Defect | Where | Proof | Evidence |
|---|---|---|---|---|---|---|---|
| D-01 (F-B-01, F-D-03) | Low | FLT-03, FLT-11 (Swagger DoD) | Joudy | The "Valid" Swagger examples for `POST /api/flights` depart on 2026-12-01. From 2026-12-02 they return 400 "Departure must be in the future", and the search example then returns an empty list. They still work on the M1 evaluation day but will fail at M2 (2026-12-11) | `flights.controller.ts:111-112,122-123`; `dto/flight.dto.ts:40,45`; `dto/flight-search.dto.ts:65` | `it.failing` in `vv/flights.vv.e2e-spec.ts` and `vv/foundation.vv.e2e-spec.ts` | code |
| D-02 (F-D-01) | Low | GEN-02 | Ahmed | A malformed JSON body returns the raw `JSON.parse` message, which echoes fragments of the body (e.g. `Unexpected token '"', ""Travel2026x"" is not valid JSON`). The filter's intended "Malformed JSON request body" branch is never reached: Nest converts the body-parser `SyntaxError` into a `BadRequestException` before the filter runs | `common/filters/all-exceptions.filter.ts:79-88` vs `:144-157` | `it.failing` in `vv/foundation.vv.e2e-spec.ts` | reproduced live |
| D-03 (F-C-01) | Low | HTL-01, GEN-02 | Sandra | An unknown `cityId` on `POST /api/hotels` returns 400 `BAD_REQUEST` without `fieldErrors`. Unknown airports in flights return a `fieldErrors` entry, so the API is inconsistent for the same kind of input | `hotels.service.ts:128-136` (compare `flights.service.ts:66-75`) | `it.failing` in `vv/hotels.vv.e2e-spec.ts` | [06](#evidence) |
| D-04 (F-D-02) | Low | GEN-13 (hardening, not a workbook rule) | Ahmed | The production config check does not treat `.env.example`'s `ADMIN_SEED_PASSWORD` as a placeholder, because the regex `/change-me\|replace_me\|placeholder/i` does not match it. A deployment could seed an admin with a password published in the repo | `config/env.validation.ts:137` | `it.failing` in `vv/foundation.vv.e2e-spec.ts` | code |
| D-05 (F-D-04, F-D-05, F-C-03) | Trivial | Swagger DoD | Abdelrahman, Sandra | Example text that does not match its values: the "Seeded admin" login example password differs from `.env.example` (401 when run); the moderator "traveller role" example sends `ADMIN`; the hotel "too many photos" example sends one bad URL | `auth.controller.ts:137-139`; `admin-accounts.controller.ts:93-101`; `hotels.controller.ts:50-56` | `it.failing` (D-05a) in `vv/foundation.vv.e2e-spec.ts`; code | code |

## Spec questions

Each of these is raised for the TAs or the team, not filed as a bug.

| ID | Req | Question | From |
|---|---|---|---|
| SQ-1 | ACC-04/05/12 | The lock check runs before the account-status check, so a **deactivated** account accumulates failed logins and then answers 403 `ACCOUNT_LOCKED` even with the right password, while an unknown email always answers the generic 401. Lockout already reveals that an active email exists, so this adds no new enumeration, but it contradicts the method's own docstring. Should ACC-05 apply to deactivated (and suspended) accounts? | F-A-01, reproduced live ([03](#evidence) vs [04](#evidence)) |
| SQ-2 | ACC-11 | The `x-dev-user` stub skips session, status and forced-change checks. It works only with `AUTH_STUB=true`, outside production, from loopback. ACC-11 has landed, yet `.env.example` still ships `AUTH_STUB=true` and Swagger advertises the scheme. Should it be switched off by default before evaluation? | F-A-02 |
| SQ-3 | HTL-04 | Overlapping ranges inside one request return 400 `BAD_REQUEST` without `fieldErrors`. conventions.md allows business-rule errors without field errors; does GEN-02 or the DoD require `ranges[i]` errors? | F-C-02, reproduced live ([10](#evidence)) |
| SQ-4 | ACC-05 | Simultaneous wrong logins can return 429 `TOO_MANY_REQUESTS`, which is not in the workbook. It is explained in the operation text but not listed as a response | F-A-03, reproduced live |
| SQ-5 | ACC-12 | The `DELETE /users/me` text promises the upcoming-bookings block. Its provider is optional and unbound until the bookings module exists, so wire it in M1 or M2 | F-A-04 |
| SQ-6 | FLT-03 | The repeated autumn DST hour (e.g. LHR 2027-10-31 01:30) is rejected. The workbook is silent; the error message is clear | Track B |
| SQ-7 | FLT-05 | Changing an airport keeps the old wall-clock time in the new zone instead of the UTC instant. Also, does a Cancelled or Expired booking still lock the airports? | Track B |
| SQ-8 | FLT-09, HTL-10 | "Days remaining" is counted in whole 24-hour periods, not calendar days in the provider's zone | Tracks B and D |
| SQ-9 | GEN-05 | Arrays inside one resource (room availability ranges) are not paginated. Does "every list" cover them? | Track D |
| SQ-10 | PAY-04 | `PLATFORM_CURRENCY` is validated but never read. No response states the currency of minor-unit amounts, and the payment and refund schemas accept any 3-letter code. Enforce this when PAY-01 lands | Track D |

Each track's RTM lists its full spec questions.

## PR #54 (HTL-05) pre-merge review

PR #54 was merged locally onto `develop` (never pushed). One `AI_PROMPTS.txt` conflict needs both sides kept; there are no code conflicts. Its tests, 44 hotel e2e tests and 118 hotel unit tests pass after the merge.

- **F-C-51** (Low, latent until HTL-18; CONFIRMED by an independent verifier across 9 interleavings): the availability replace reads `room_nights` but writes only the room. Once a room's `everReserved` is already true, a hold that sets it again (driver `$set`, or Mongoose `doc.save()`, which skips unchanged documents) writes nothing. The two transactions then do not conflict, and a held night can end up outside every range. Proposed contract wording for Sandra: *"The HTL-18 hold transaction must make a write to the room document that always changes it, e.g. `$inc: { reservationVersion: 1 }` alongside `$set: { everReserved: true }`; do not rely on Mongoose timestamps or `doc.save()`."*
- **F-C-52** (Low): protected nights start at the UTC date, while `room_nights.date` is the hotel's local date. In a hotel west of UTC in the evening, tonight's booked night is not protected.
- **Spec question:** unexpired HELD nights also block removal. The workbook protects only confirmed reservations, so the PR is stricter.

These are posted as review notes on the PR rather than as Jira Bugs, because the code is not merged.

## Jira drift

- **FLT-11** is Done in Jira and traceability.md, but "available = total - booked - **held**" cannot hold until FLT-22 exists. Proposal: set the traceability row to `Partial: held seats wait for FLT-22`. Jira can stay Done or move back to In Progress, as you decide.
- ACC-12, FLT-05 and HTL-01 are In Progress in Jira and `Partial` in traceability.md. This is consistent, so no change.

## Evaluator-facing observations (Swagger, 2026-11-20)

- **Ids an evaluator cannot discover.** There is no `GET` for the airline list, a hotel (HTL-02 not built), rooms or room availability. An evaluator must copy ids from the create responses. Consider a demo script with the order of calls and where each id comes from.
- **Authorization.** The `dev-user` security scheme is visible. Evaluators should use the cookie flow: `POST /api/auth/login`, after which Swagger sends the cookie automatically.
- **Money.** Amounts are in minor units (`priceMinor: 15000` = 150.00).
- **Diagnostics.** The routes are visible in development and absent in production (verified).

## Consistency

The full e2e suite (the 32 existing specs plus the 4 V&V specs) ran twice in a row on a fresh in-memory replica set. Both runs gave identical results, `Test Suites: 36 passed` and `Tests: 543 passed, 543 total`, with no flaky tests. The 543 tests are 335 existing ones plus 208 new ones, including 9 `it.failing` defect proofs.

The live checks were also repeated where state allowed (for example, the login decision table after the lock expired), with the same outcome.

## Evidence

Screenshots of Swagger UI against the live `travel_vv` server are on the never-merged branch `evidence/vv-swagger`, pinned at commit [`0631fb0`](https://github.com/AhmedAtefYoussef/travel-planning-booking-platform/tree/0631fb08f1c30c8ad777b15ebd2079445763a13f/vv-m1). The branch [README](https://github.com/AhmedAtefYoussef/travel-planning-booking-platform/blob/0631fb08f1c30c8ad777b15ebd2079445763a13f/README.md) describes each file.

| # | Shows |
|---|---|
| 01 | ACC-01 register 201 (no password in the response) |
| 02 | ACC-01 / GEN-02 register 400 with `fieldErrors` (name, email, password, acceptTerms, injected `role`) |
| 03 | SQ-1: deactivated account answers 403 `ACCOUNT_LOCKED` |
| 04 | ACC-04: unknown email answers the generic 401 |
| 05 | ACC-14: admin account search |
| 06 | D-03: unknown city returns 400 without `fieldErrors` |
| 07 | FLT-03: DST-gap local time rejected with a clear field error |
| 08 | FLT-11 / GEN-06: search by local departure date (HND 00:30 local = previous UTC day) |
| 09 | FLT-30 / FLT-05: a Departed flight cannot be edited (409) |
| 10 | SQ-3: overlap inside one availability request |
| 11 | ACC-11: hotel moderator on an admin route gets 403 |
| 12 | GEN-05: page-size parameter rejected |

## Traceability matrices

- [Accounts and auth](rtm-accounts.md): `backend/test/vv/accounts.vv.e2e-spec.ts`
- [Flights, airlines and airports](rtm-flights.md): `backend/test/vv/flights.vv.e2e-spec.ts`
- [Hotels and the PR #54 review](rtm-hotels.md): `backend/test/vv/hotels.vv.e2e-spec.ts`
- [Foundation, reference data and the Swagger contract](rtm-foundation.md): `backend/test/vv/foundation.vv.e2e-spec.ts`

## CI

`.github/scripts/check-test-traceability.mjs` runs as a non-blocking step in `pr-governance`. It lists every Done or Partial requirement with the e2e and unit specs whose `describe()` title cites it. At the time of this report it covers 38 of 38 implemented requirements.
