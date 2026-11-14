# Milestone 1 verification & validation report

Scope: every requirement that is **Done** or **Partial** in [traceability.md](../../requirements/traceability.md) on `develop` @ `fc610e0` (PRs #1 to #53). Open PR #54 (HTL-05) was reviewed before merge on a local merge with `develop`.
Run on 2026-11-13 by the team leader with Claude Code (AI-assisted, logged in AI_PROMPTS.txt). Milestone 1 is evaluated through Swagger UI on 2026-11-20.

**Result: no Critical or High defects. Every confirmed defect and every actionable finding is now fixed, so 253 of 279 atomic rules pass and none fails.**

| | First run | After fixes |
|---|---|---|
| Atomic rules traced | 279 | 279 |
| PASS | 239 | 253 |
| FAIL | 11 | 0 |
| PARTIAL (waits for FLT-22 seat holds) | 5 | 2 |
| BLOCKED-BY a feature not built yet | 22 | 22 |
| UNTESTED (frontend half of a rule, or HTL-02 not built) | 2 | 2 |

**How the fixes were made.**
- **Merged code, in this PR:** each defect was first pinned by an `it.failing` test. The fix commit turned that test into a regular passing test, so the history shows red, then green.
- **PR #54, before it merges:** two findings were fixed with commits on that PR's branch (see [PR #54](#pr-54-htl-05-pre-merge-review)).
- **Spec questions:** the ones that need a team or TA decision stay in [Spec questions](#spec-questions).

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
| ACC-05 | Abdelrahman | 11 | | | | yes | PASS (SQ-1 and SQ-4 fixed in #55) |
| ACC-06 | Abdelrahman | 5 | | | | | PASS |
| ACC-07a | Abdelrahman | 7 | | | | | PASS |
| ACC-08 | Abdelrahman | 6 | | | | yes | PASS |
| ACC-09 | Abdelrahman | 6 | | | | | PASS |
| ACC-11 | Abdelrahman | 4 | | | 2 | yes (39-cell matrix) | PASS (SQ-2 fixed in #55) |
| ACC-12 | Abdelrahman | 3 | | | 3 | yes | PARTIAL, as declared (bookings block and content hiding wait for FLT-22/HTL-18 and BLG/ITN) |
| ACC-13 | Abdelrahman | 8 | | | | yes | PASS |
| ACC-14 | Abdelrahman | 6 | | | | yes | PASS |
| ACC-18 | Abdelrahman | 4 | | | | yes | PASS |
| ACC-19 | Abdelrahman | 4 | | | 1 | yes | PASS (frontend half in M2) |
| FLT-01 | Joudy | 8 | | | 1 | yes | PASS (logo upload waits for GEN-08) |
| FLT-02 | Joudy | 6 | | | | yes | PASS |
| FLT-03 | Joudy | 11 | | | | yes | PASS (D-01 fixed in #55) |
| FLT-04 | Joudy | 8 | | | | yes | PASS |
| FLT-05 | Joudy | 8 | | 1 | 2 | yes | PARTIAL, as declared (notification waits for GEN-01, price snapshot for FLT-22) |
| FLT-08 | Joudy | 4 | | | 1 | yes | PASS |
| FLT-09 | Joudy | 7 | | | 1 | yes | PASS |
| FLT-11 | Joudy | 7 | | 1 | 1 | yes | PARTIAL: held seats come from FLT-22 (traceability row set to Partial in #55) |
| FLT-15 | Joudy | 7 | | | | yes | PASS |
| FLT-17 | Joudy | 6 | | | | yes | PASS |
| FLT-30 | Joudy | 4 | | | 2 | yes (live Departed) | PASS |
| GEN-06 | Joudy | 2 | | | | yes | PASS |
| GEN-12 | Joudy | 7 | | | | yes | PASS |
| HTL-01 | Sandra | 15 | | | 1 | yes | PASS (D-03 and the PATCH 409 fixed in #55) |
| HTL-03 | Sandra | 12 | | | | yes | PASS |
| HTL-04 | Sandra | 15 | | | | yes | PASS (SQ-3 fixed in #55) |
| HTL-05 (PR #54) | Sandra | 12 | | | 2 | | PASS on PR #54 after its two fix commits (see [PR #54](#pr-54-htl-05-pre-merge-review)) |
| GEN-02 | Ahmed | 6 | | | | yes | PASS (D-02 fixed in #55) |
| GEN-05 | Ahmed | 4 | | | | yes | PASS |
| GEN-13 | Ahmed | 6 | | | | yes | PASS (D-04 fixed in #55) |
| PAY-01, PAY-03, PAY-04, GEN-07, GEN-11, HTL-10 | Ahmed / Sandra | 9 | | | 5 | | The schema-only parts claimed in traceability.md are verified |
| Swagger (Jira DoD) | all | 6 | | | | yes | PASS (D-01 and D-05 fixed in #55) |

## Defect log

Every FAIL went to an independent verifier that tried to refute it. Every confirmed defect, and every finding the verifier downgraded but that had a clear fix, is now fixed. Each fix commit cites the requirement.

| ID | Sev | Req | Owner | Defect | Fix | Status |
|---|---|---|---|---|---|---|
| D-01 (F-B-01, F-D-03) | Low | FLT-03, FLT-11 (Swagger DoD) | Joudy | The "Valid" Swagger examples for `POST /api/flights` departed on 2026-12-01, so from 2026-12-02 they returned 400 "Departure must be in the future", and the search example returned an empty list | The create and search examples now use 2027-12-01, like the PATCH examples | Fixed in #55 (`3f2185f`) |
| D-02 (F-D-01) | Low | GEN-02 | Ahmed | A malformed JSON body returned the raw `JSON.parse` message, which echoes fragments of the body. Nest converted the body-parser `SyntaxError` into a `BadRequestException` before the filter ran | `configureApp` registers the JSON parser followed by `maskMalformedJson`, which hands the filter a client error. The answer is now "Malformed JSON request body"; `rawBody` is kept | Fixed in #55 (`86faa28`) |
| D-03 (F-C-01) | Low | HTL-01, GEN-02 | Sandra | An unknown `cityId` on `POST/PATCH /api/hotels` returned 400 `BAD_REQUEST` without `fieldErrors` | Now 400 `VALIDATION_FAILED` with a `cityId` field error, like unknown airports in flights | Fixed in #55 (`11f1b5d`) |
| D-04 (F-D-02) | Low | GEN-13 (hardening) | Ahmed | The production config check did not treat `.env.example`'s `ADMIN_SEED_PASSWORD` as a placeholder | The placeholder pattern now also matches it (`/change-?me\|replace_?me\|placeholder/i`) | Fixed in #55 (`249ff7d`) |
| D-05 (F-D-04, F-D-05, F-C-03) | Trivial | Swagger DoD | Abdelrahman, Sandra | Example text that did not match its values. The "Seeded admin" login example password differed from `.env.example`; the moderator "traveller role" example sent `ADMIN`; the hotel "too many photos" example sent one bad URL. `PATCH /api/hotels/:id` could return an undocumented 409 | Examples and summaries corrected; 409 documented | Fixed in #55 (`86c0fa8`, `8b68587`) |

## Spec questions

These items were raised as questions. Five (SQ-1 to SQ-5) had a clear fix that matches the existing design, so they were fixed. The rest need a team or TA decision and are left open.

| ID | Req | Question | Outcome |
|---|---|---|---|
| SQ-1 | ACC-04/05/12 | A deactivated account accumulated failed logins and then answered 403 `ACCOUNT_LOCKED`, while an unknown email always answered the generic 401. This contradicted the login method's own docstring | **Fixed in #55** (`affffe4`): a deactivated account is handled like an unknown email before the lockout gate, so it is never counted or locked |
| SQ-2 | ACC-11 | The `x-dev-user` stub skipped the status and forced-change checks for real accounts (development only: `AUTH_STUB=true`, not production, loopback) | **Fixed in #55** (`19bf639`): a stub caller naming a real account gets the same status and forced-change checks as a cookie request; stub ids with no account are unaffected. Whether to ship `AUTH_STUB=false` in `.env.example` before the evaluation is still the team's call |
| SQ-3 | HTL-04 | Overlapping ranges inside one request returned 400 `BAD_REQUEST` without `fieldErrors` | **Fixed in #55** (`11f1b5d`): 400 `VALIDATION_FAILED` with `ranges[i].from` for each range that overlaps an earlier one |
| SQ-4 | ACC-05 | Simultaneous wrong logins can return 429 `TOO_MANY_REQUESTS`, which was explained but not listed as a response | **Fixed in #55** (`86c0fa8`): 429 is now documented on `POST /api/auth/login` (the workbook stays silent on it) |
| SQ-5 | ACC-12 | The `DELETE /users/me` text promised the upcoming-bookings block, whose provider is unbound until the bookings module exists | **Fixed in #55** (`6f7e374`): the text says the block takes effect once FLT-22/HTL-18 provide `UPCOMING_BOOKINGS` |
| SQ-6 | FLT-03 | The repeated autumn DST hour (e.g. LHR 2027-10-31 01:30) is rejected. The workbook is silent; the error message is clear | Open (TA question) |
| SQ-7 | FLT-05 | Changing an airport keeps the old wall-clock time in the new zone instead of the UTC instant. Does a Cancelled or Expired booking still lock the airports? | Open (decide when FLT-22 lands) |
| SQ-8 | FLT-09, HTL-10 | "Days remaining" is counted in whole 24-hour periods, not calendar days in the provider's zone | Open (TA question) |
| SQ-9 | GEN-05 | Arrays inside one resource (room availability ranges) are not paginated. Does "every list" cover them? | Open (TA question) |
| SQ-10 | PAY-04 | `PLATFORM_CURRENCY` is validated but never read; payment and refund schemas accept any 3-letter code | Closed for payments (#61, #62): limited to the seeded currencies at startup; every payment passes the gate, which refuses any other currency; refunds follow with PAY-03 |

Each track's RTM lists its full spec questions.

## PR #54 (HTL-05) pre-merge review

PR #54 was first merged locally onto `develop` (never pushed). One `AI_PROMPTS.txt` conflict needs both sides kept; there are no code conflicts. Its tests, 44 hotel e2e tests and 118 hotel unit tests passed after the merge. Two findings were then fixed by commits pushed to the PR's own branch:

- **F-C-51** (Low, latent until HTL-18; CONFIRMED by an independent verifier across 9 interleavings). The availability replace reads `room_nights` but writes only the room. A hold that only sets `everReserved: true` when it is already true writes nothing (the same goes for Mongoose `doc.save()`), so the transactions did not conflict.
  - **Fix:** the contract now requires the hold to `$inc` a new `reservationVersion` field, a write that always changes the room.
  - The schema gains `reservationVersion`, and `contracts.md` plus the service comment explain why.
- **F-C-52** (Low). Protected nights started at the UTC date, while `room_nights.date` is the hotel's local date.
  - **Fix:** "today" is now the hotel's local date, taken from the time zone of an airport in the hotel's city. When the zone is unknown it falls back to UTC-12, so tonight's night is never unprotected. Unit tests cover New York at 21:00 and the fallback.
- **Spec question (open):** unexpired HELD nights also block removal. The workbook protects only confirmed reservations, so the PR is stricter.

Merging note: PR #54 merged first (`330b658`). This PR then merged `develop` and resolved the `AI_PROMPTS.txt`, traceability and `rooms.service.spec.ts` conflicts. HTL-05's `replaceAvailability` now reports overlapping ranges with `overlapFieldErrors` too, so both availability endpoints answer the same way (SQ-3); the unused `firstOverlap` helper is removed.

## Jira drift

- **FLT-11** was Done in Jira and traceability.md, but "available = total - booked - **held**" cannot hold until FLT-22 exists. This PR sets the traceability row to `Partial`, and the Jira story moves back to In Progress.
- ACC-12, FLT-05 and HTL-01 are In Progress in Jira and `Partial` in traceability.md. This is consistent, so no change.

## Evaluator-facing observations (Swagger, 2026-11-20)

- **Ids an evaluator cannot discover.** There is no `GET` for the airline list, a hotel (HTL-02 not built), rooms or room availability. An evaluator must copy ids from the create responses. Consider a demo script with the order of calls and where each id comes from.
- **Authorization.** The `dev-user` security scheme is visible. Evaluators should use the cookie flow: `POST /api/auth/login`, after which Swagger sends the cookie automatically.
- **Money.** Amounts are in minor units (`priceMinor: 15000` = 150.00).
- **Diagnostics.** The routes are visible in development and absent in production (verified).

## Consistency

The full e2e suite (the 32 existing specs plus the 4 V&V specs) ran twice in a row on a fresh in-memory replica set. Both runs gave identical results, `Test Suites: 36 passed` and `Tests: 543 passed, 543 total`, with no flaky tests. The 543 tests were 335 existing ones plus 208 new ones, including 9 `it.failing` defect proofs.

After the fixes the full suite gives `Tests: 542 passed, 542 total` with no `it.failing` left. One V&V test compared against `backend/openapi.json`, which is a gitignored build artifact, so it was removed; the openapi-contract CI job already generates and checks that file.

The live checks were also repeated where state allowed (for example, the login decision table after the lock expired), with the same outcome.

## Evidence

Screenshots of Swagger UI against the live `travel_vv` server are on the never-merged branch `evidence/vv-swagger`, pinned at commit [`0631fb0`](https://github.com/AhmedAtefYoussef/travel-planning-booking-platform/tree/0631fb08f1c30c8ad777b15ebd2079445763a13f/vv-m1). The branch [README](https://github.com/AhmedAtefYoussef/travel-planning-booking-platform/blob/0631fb08f1c30c8ad777b15ebd2079445763a13f/README.md) describes each file.

| # | Shows |
|---|---|
| 01 | ACC-01 register 201 (no password in the response) |
| 02 | ACC-01 / GEN-02 register 400 with `fieldErrors` (name, email, password, acceptTerms, injected `role`) |
| 03 | SQ-1 before the fix: deactivated account answers 403 `ACCOUNT_LOCKED` (fixed in #55) |
| 04 | ACC-04: unknown email answers the generic 401 |
| 05 | ACC-14: admin account search |
| 06 | D-03 before the fix: unknown city returns 400 without `fieldErrors` (fixed in #55) |
| 07 | FLT-03: DST-gap local time rejected with a clear field error |
| 08 | FLT-11 / GEN-06: search by local departure date (HND 00:30 local = previous UTC day) |
| 09 | FLT-30 / FLT-05: a Departed flight cannot be edited (409) |
| 10 | SQ-3 before the fix: overlap inside one availability request without `fieldErrors` (fixed in #55) |
| 11 | ACC-11: hotel moderator on an admin route gets 403 |
| 12 | GEN-05: page-size parameter rejected |

## Traceability matrices

- [Accounts and auth](rtm-accounts.md): `backend/test/vv/accounts.vv.e2e-spec.ts`
- [Flights, airlines and airports](rtm-flights.md): `backend/test/vv/flights.vv.e2e-spec.ts`
- [Hotels and the PR #54 review](rtm-hotels.md): `backend/test/vv/hotels.vv.e2e-spec.ts`
- [Foundation, reference data and the Swagger contract](rtm-foundation.md): `backend/test/vv/foundation.vv.e2e-spec.ts`

## CI

`.github/scripts/check-test-traceability.mjs` runs as a non-blocking step in `pr-governance`. It lists every Done or Partial requirement with the e2e and unit specs whose `describe()` title cites it. At the time of this report it covers 38 of 38 implemented requirements.
