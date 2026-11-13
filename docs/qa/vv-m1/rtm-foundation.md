# V&V M1, Track D: Foundation, reference data, API contract

Scope: GEN-02, GEN-05, GEN-12, GEN-13, plus the schema-only Partial rows PAY-01, PAY-03, PAY-04, GEN-07, GEN-11 and HTL-10. For these partial rows, only what traceability.md claims is done was verified.

- Baseline: branch `test/vv-m1-acceptance` @ fc610e0.
- New tests: `backend/test/vv/foundation.vv.e2e-spec.ts`. The file has 105 cases: 101 pass, and 4 are `it.failing` cases that prove defects.
- Paths are relative to `backend/src` unless they start with `test/`, `scripts/` or `seed/`. In the "VV test" column, `vv:NNN` means line NNN of the vv spec.
- Contract check: `backend/openapi.json` is a gitignored build artifact, not a committed file. The `openapi-contract` CI job generates it from the running app and checks it with `scripts/check-openapi.ts`, so there is no committed copy that could go stale.

| Rule | Source | Rule text | Endpoint | Code (file:line) | Existing test (spec:line) | VV test | Verdict | Finding |
|---|---|---|---|---|---|---|---|---|
| R-GEN-12-01 | workbook | The airports are seeded and served exactly as the official records: 8 rows, with iata, name, city, country and IANA zone | GET /api/airports | modules/reference/seed/reference-dataset.ts:191, modules/reference/reference.service.ts:200 | test/reference.e2e-spec.ts:110 (CAI only) | vv:272 | PASS | |
| R-GEN-12-02 | workbook | The cities are seeded exactly: 8 rows with cityId, name and countryCode | GET /api/cities | reference-dataset.ts:169, reference.service.ts:192 | reference.e2e-spec.ts:73 (one city) | vv:261 | PASS | |
| R-GEN-12-03 | workbook | The countries are seeded exactly: 8 rows with code, name and currency | GET /api/countries | reference-dataset.ts:148, reference.service.ts:184 | reference.e2e-spec.ts:55 (EG only) | vv:250 | PASS | |
| R-GEN-12-04 | workbook | The supported currencies are seeded: the 7 distinct currencies of Countries.csv, with ISO minor units (JPY 0) | GET /api/currencies | reference-dataset.ts:254 | reference.e2e-spec.ts:91 | vv:283 | PASS | |
| R-GEN-12-05 | derived | The attractions are seeded exactly (att-1..att-8). `Römerberg` is valid UTF-8 (C3 B6, NFC) in both the CSV and the DB | (no route) | reference-dataset.ts:232, seed/data/Attractions.csv:9 | reference.e2e-spec.ts:175 (att-5 only) | vv:302 | PASS | |
| R-GEN-12-06 | derived | Seeding is idempotent: a second run inserts and updates 0 rows, and every count stays at 8/8/8/8/7 | npm run seed | modules/reference/reference-seed.service.ts:42-70 | reference.e2e-spec.ts:31 (3 of 5 collections) | vv:212 | PASS | |
| R-GEN-12-07 | derived | Reference data is read-only, so no write routes exist | POST/PATCH/DELETE /api/airports | reference.controller.ts:23 | reference.e2e-spec.ts:130 | - | PASS | |
| R-GEN-02-01 | workbook | Invalid input returns 400 VALIDATION_FAILED, with fieldErrors that name each field | all (e.g. POST /api/auth/register) | common/pipes/validation.pipe.ts:28-38 | test/common-layer.e2e-spec.ts:46, test/diagnostics.e2e-spec.ts:28 | vv:338 | PASS | |
| R-GEN-02-02 | workbook | Nested fields use dotted and indexed paths, and unknown nested properties are reported by path | PUT /api/airlines/:id/cancellation-policy | validation.pipe.ts:8-23 | common-layer.e2e-spec.ts:46 (probe route) | vv:348 | PASS | |
| R-GEN-02-03 | jira-dod | Every error status (400/401/403/404/409/413/500) uses the single envelope {statusCode,error,code,message,fieldErrors?,path,timestamp} and leaks nothing internal | all | common/filters/all-exceptions.filter.ts:44-68 | common-layer.e2e-spec.ts:27-131 (probe routes; 500 at :127) | vv:338-489 (real routes, exact key set) | PASS | |
| R-GEN-02-04 | jira-dod | A malformed JSON body returns 400 with a generic message: no parser internals, and no echo of the request body | all JSON routes | all-exceptions.filter.ts:80-88, :144-157 | common-layer.e2e-spec.ts:79 (code only) | vv:390, vv:399 (regression test) | PASS (fixed in #55) | F-D-01 (fixed) |
| R-GEN-02-05 | derived | An array body or a text/plain body is a 400 with fieldErrors, not a 500 | POST /api/auth/login | validation.pipe.ts:28 | - | vv:378 | PASS | |
| R-GEN-02-06 | derived | An error `path` never echoes the query string | all | all-exceptions.filter.ts:63-64 | common-layer.e2e-spec.ts:181 | vv:449 | PASS | |
| R-GEN-02-07 | workbook | Field-level messages are *shown on all forms* (the UI part) | frontend | frontend/ (README only) | - | - | UNTESTED | |
| R-GEN-05-01 | workbook | Every list endpoint is paginated with page size 10. The inventory is countries, cities, airports, currencies, admin/accounts, flights/search and diagnostics/rows | 7 GET lists | common/pagination/pagination.ts:7, :110-131 | pipes.spec.ts:114 | vv:522 (inventory equals the routes that take `page`) | PASS | |
| R-GEN-05-02 | workbook | 11 rows are served as 10 + 1 on 2 pages, with no overlap | countries, cities, airports, currencies, flights/search | pagination.ts:81-93, modules/flights/flight-search.service.ts:254-266 | admin-accounts.e2e-spec.ts:85 (12 rows), diagnostics.e2e-spec.ts:69 (23 rows) | vv:557, vv:611 | PASS | |
| R-GEN-05-03 | jira-dod | `limit`, `pageSize`, `per_page` and `LIMIT` are rejected with 400 on every list | 7 GET lists | common/pagination/reject-page-size.middleware.ts:7-38, common.module.ts:55 | common-layer.e2e-spec.ts:186, reference.e2e-spec.ts:150 | vv:650 | PASS | |
| R-GEN-05-04 | derived | page=0, -1, abc, 1.5 or a repeated page is a 400 on page; a page beyond the total is an empty page with the real total | 7 GET lists | pagination.ts:15-53 | common-layer.e2e-spec.ts:160, :186 | vv:650, vv:671 | PASS | |
| R-GEN-13-01 | workbook | Authorisation is enforced in the backend: global deny-by-default guards, and every route declares @Public or @Roles. The public routes are the 18 reviewed ones | all | common.module.ts:46-47, common/auth/auth.guard.ts:225, common/auth/roles.guard.ts:23-37 | auth-guards.e2e-spec.ts:203, diagnostics.e2e-spec.ts:149 | vv:694 | PASS | |
| R-GEN-13-02 | workbook | Validation is enforced in the backend: every @Body/@Query input is a class-validator DTO. ValidationPipe uses whitelist + forbidNonWhitelisted | all | validation.pipe.ts:28-38 | common-layer.e2e-spec.ts:69, users-profile.e2e-spec.ts:150, auth-register.e2e-spec.ts:158 | vv:738 | PASS | |
| R-GEN-13-03 | workbook | Passwords are stored only as salted bcrypt hashes (cost 12). The same password gives different hashes, and no response returns a hash | register, login, auth/me, users/me, admin/accounts | common/security/password.service.ts:7, :22; modules/users/schemas/user.schema.ts:48 | password.service.spec.ts:18, diagnostics.e2e-spec.ts:134, users-profile.e2e-spec.ts:50 | vv:777 | PASS | |
| R-GEN-13-04 | derived | A production configuration refuses AUTH_STUB=true and COOKIE_SECURE=false | startup | config/env.validation.ts:147-153 | src/config/env.validation.spec.ts:72 | vv:876 | PASS | |
| R-GEN-13-05 | derived | A production configuration refuses the .env.example secret placeholders | startup | env.validation.ts:137, :155 | env.validation.spec.ts:72 (STRIPE only) | vv:887 (regression test) | PASS (fixed in #55) | F-D-02 (fixed) |
| R-GEN-13-06 | derived | The diagnostics demo module is not registered when NODE_ENV=production | /api/diagnostics/* | app.module.ts:33, modules/diagnostics/diagnostics.module.ts:11 | diagnostics.e2e-spec.ts:20 (function only) | vv:824 (AppModule imports) | PASS | |
| R-PAY-04-01 | workbook | One platform currency (PLATFORM_CURRENCY), validated as ISO 4217 at startup | env | env.validation.ts:80-83 | env.validation.spec.ts:38 | - | PASS | |
| R-PAY-04-02 | workbook | Money utilities use integer minor units (no floats). Refund shares round down, and 100% refunds exactly | money utils | common/utils/money.ts:43-124 | money.spec.ts:13-79 | - | PASS | |
| R-PAY-04-03 | workbook | Prices, payments and refunds all use that single currency | flights, rooms, payments, refunds | flight.schema.ts:69, room.schema.ts:50 (no currency field); payment.schema.ts:43, refund.schema.ts:51 (any `[A-Z]{3}`) | contracts-schemas.e2e-spec.ts:115 | - | BLOCKED-BY PAY-01 | |
| R-PAY-01-01 | workbook | The payment schema stores only the Stripe id, amount, currency and status (no card data), with integer amounts, unique PaymentIntent ids and one success per booking | (schema) | modules/payments/schemas/payment.schema.ts:17-76 | contracts-schemas.e2e-spec.ts:126, :135, :143, :158 | - | PASS | |
| R-PAY-01-02 | workbook | Payment endpoints, Stripe flow and webhook | POST /api/payments... | not implemented | - | - | BLOCKED-BY PAY-01 | |
| R-PAY-03-01 | workbook | The refund schema has PENDING/REFUNDED/FAILED, at most one refund per booking, and unique Stripe refund ids | (schema) | modules/payments/schemas/refund.schema.ts:21-92 | contracts-schemas.e2e-spec.ts:177, :186 | - | PASS | |
| R-PAY-03-02 | workbook | Refund quote: provider cancellations refund 100%; user cancellations use the tier and round down; no user cancellation after start | (util) | common/contracts/refunds.contract.ts:85-111 | contracts.spec.ts:101-150 | - | PASS | |
| R-GEN-11-01 | workbook | The transition table is exactly PP->Confirmed->Completed, PP->Expired and Confirmed->Cancelled | (util) | common/contracts/booking.contract.ts:22-37 | contracts.spec.ts:16, :30 | - | PASS | |
| R-GEN-11-02 | workbook | The lifecycle is enforced on real bookings | bookings | not implemented | - | - | BLOCKED-BY FLT-22/HTL-18 | |
| R-HTL-10-01 | workbook | Tier rule: the highest threshold not exceeding days remaining; otherwise 0% (shared with FLT-09) | (util) | common/contracts/policies.contract.ts:41-55 | contracts.spec.ts:60, :68 | - | PASS | |
| R-HTL-10-02 | workbook | Tier validation: unique integer thresholds >= 0, refund 0-100 | (util) | policies.contract.ts:68-101 | contracts.spec.ts:75, :155 | - | PASS | |
| R-HTL-10-03 | workbook | Hotel policy endpoint (PUT /api/hotels/:id/policies) | PUT /api/hotels/:id/policies | not implemented | - | - | BLOCKED-BY HTL-10 | |
| R-GEN-07-01 | workbook | AUDIT_SERVICE records admin actions, strips secrets, is append-only, and is transactional with the action | (service) | modules/audit/audit-log.service.ts:24-48, modules/audit/schemas/audit-log.schema.ts:46-76 | contracts-schemas.e2e-spec.ts:66, :84, :101; audit-log.service.spec.ts:4 | - | PASS | |
| R-GEN-07-02 | workbook | Suspensions and deletions are audited, and the audit log is readable (GET /api/admin/audit-logs) | admin | AuditAction has SUSPEND_ACCOUNT and DELETE_CONTENT (common/contracts/services.contract.ts:141-151); no endpoint | - | - | BLOCKED-BY ACC-15/ACC-16/GEN-10 | |
| R-DOD-SW-01 | jira-dod | Every Swagger summary starts with a requirement ID | all 40 ops | scripts/openapi-rules.ts | scripts/openapi-rules.spec.ts | vv:997 | PASS | |
| R-DOD-SW-02 | jira-dod | Every positive request example passes its own DTO (Try it out does not return 400) | 20 ops, 33 positive of 56 named examples | controllers' @ApiBody | - | vv:1011 | PASS | |
| R-DOD-SW-03 | jira-dod | Every negative example is really rejected, and its summary describes its value | 20 ops | hotels.controller.ts:50, users/admin-accounts.controller.ts:94 | - | vv:1024 | PASS (fixed in #55) | F-D-05 (fixed) |
| R-DOD-SW-04 | jira-dod | Example values still work when the evaluator runs them (dates still in the future at M2) | POST /api/flights, GET /api/flights/search | flights.controller.ts:111-123, flights/dto/flight.dto.ts:40-45, flights/dto/flight-search.dto.ts:65 | - | vv:1047 (regression test) | PASS (fixed in #55) | F-D-03 (fixed) |
| R-DOD-SW-05 | jira-dod | The "Seeded admin" login example works against the documented seed | POST /api/auth/login | modules/auth/auth.controller.ts:136-139 | - | vv:1069 (regression test) | PASS (fixed in #55) | F-D-04 (fixed) |
| R-DOD-SW-06 | jira-dod | The OpenAPI contract is generated from the code, so it cannot go stale | - | scripts/generate-openapi.ts; .github/workflows/ci.yml (openapi-contract) | CI openapi-contract job | - | PASS | |

## Findings

**F-D-01: Low, GEN-02. Malformed JSON leaks parser text and can echo the request body.**
- Expected: "invalid input returns 400 with fieldErrors". The filter intends the fixed message `Malformed JSON request body` and promises "Internal details ... never reach the client" (all-exceptions.filter.ts:35-39, :150-152).
- Actual: Nest's RoutesResolver turns body-parser's `SyntaxError` into `BadRequestException(err.message)`. The `HttpException` branch (all-exceptions.filter.ts:80-88) then passes the raw `JSON.parse` text through, so the intended branch at :144-157 is dead for parse errors.
  - Example: `Expected ',' or '}' after property value in JSON at position 40`.
  - A non-object body is echoed back in the message.
- Repro: `POST /api/auth/login` with `Content-Type: application/json` and body `"Travel2026x"` returns 400 `{"message":"Unexpected token '\"', \"\"Travel2026x\"\" is not valid JSON"}`.
- Proof: `malformed JSON gets the generic message, never parser text or the request body` (vv:399, it.failing).

**F-D-02: Low, GEN-13 (derived TRVL-130 hardening, not a workbook rule).**
- Expected: the production check rejects ".env.example placeholder value[s]" for the secrets, including ADMIN_SEED_PASSWORD (env.validation.ts:139-160).
- Actual: the placeholder regex `/change-me|replace_me|placeholder/i` (env.validation.ts:137) does not match the published `ADMIN_SEED_PASSWORD=ChangeMe!2026` (.env.example:41). A production deployment can therefore seed an admin with a publicly known password.
- Repro: call `validateEnv({...hardened production env, ADMIN_SEED_PASSWORD: 'ChangeMe!2026'})`. It does not throw.
- Proof: `refuses the .env.example ADMIN_SEED_PASSWORD placeholder in production` (vv:887, it.failing).

**F-D-03: Low, DoD (FLT-03/FLT-11 Swagger examples). The flight examples expire before the M2 evaluation.**
- Expected: the DoD says "examples ... documented", and an evaluator's "Valid" example should succeed.
- Actual:
  - The "Valid: Cairo...", "Valid: arrives..." and property examples depart on `2026-12-01` (flights.controller.ts:111, :122; flight.dto.ts:40, :45).
  - The search example also uses `departureDate=2026-12-01` (flight-search.dto.ts:65).
  - From 2026-12-01 (before M2 on 2026-12-11), POST returns 400 "departure in the past" and search returns an empty page.
- Repro: on or after 2026-12-02, send `POST /api/flights` as AIRLINE_MODERATOR with `{"flightNumber":"MS777","from":"CAI","to":"DXB","departureLocal":"2026-12-01T14:30","arrivalLocal":"2026-12-01T18:45"}`.
- Proof: vv:1047 (it.failing).

**F-D-04: Low, DoD (ACC-04 Swagger example).**
- Expected: the summary says "Seeded admin (values from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD)".
- Actual: the example password is `Admin2026x` (auth.controller.ts:139), but .env.example seeds `ChangeMe!2026`. An evaluator who seeds with the documented values and clicks the example gets 401 INVALID_CREDENTIALS.
- Repro: `POST /api/auth/login {"email":"admin@example.com","password":"Admin2026x"}` after `npm run seed` with .env.example values.
- Proof: vv:1069 (it.failing).

**F-D-05: Low, DoD (ACC-13, HTL-01 Swagger examples). Negative example summaries do not match their values.**
- `POST /api/admin/moderators [invalid]` says "a traveller role", but its value is `role: "ADMIN"` (users/admin-accounts.controller.ts:94).
- `POST /api/hotels [invalid]` says "too many photos", but its value has 1 photo (hotels.controller.ts:50).
- Both are still rejected (vv:1024), so this is documentation only. Proof: code citation; there is no failing test.

## Spec questions

1. **GEN-02:** "show field-level validation messages on all forms" is a UI requirement. The frontend does not exist yet (M2), so only the backend contract was verified.
2. **GEN-05:** Embedded arrays are returned unpaginated:
   - `availability` ranges on a room (POST /api/hotels/:id/rooms/...): these can grow past 10.
   - flight `cabins`, hotel `amenities` and `photos`: these are capped by their DTOs.
   Does "every list longer than 10 rows" apply to arrays nested inside a single resource?
3. **GEN-12:** There is no attractions route (`listAttractions` only exists in REFERENCE_SERVICE). This is not a GEN-12 defect, because GEN-12 lists airports, cities, countries and currencies. It is a gap for the itinerary features (ITN-*), which need to discover attraction ids. Also, seeding is manual (`npm run seed`, documented in README:40). Should seeding also run on first start?
4. **HTL-10 / FLT-09:** "Days remaining" is computed as `floor(hours / 24)` (common/utils/dates.ts:121). Hotels may need calendar days in the hotel's time zone instead.
5. **PAY-04:** PLATFORM_CURRENCY is validated but never read at runtime.
   - No response or endpoint tells a client which currency `*Minor` amounts are in.
   - Swagger text hard-codes "250.00" (2 decimals), which would be wrong for JPY.
   - Payment and refund schemas accept any `[A-Z]{3}` currency.
   - PLATFORM_CURRENCY is not required to be one of the seeded currencies.
   These should be enforced when PAY-01 lands.

## Evaluator-facing observations (Swagger)

- **ID discoverability gaps.** Some path params need ids that no GET lists:
  - airline `{id}`: there is no `GET /api/airlines` list. The id is visible only in the POST response, or to the moderator via `GET /api/users/me` `assignedProvider`.
  - hotel `{id}`: there is no GET at all (HTL-02 not started).
  - room `{roomId}`: there is no GET.
  - `{cabinId}`: discoverable via GET /api/flights/{id}. Flight ids are discoverable via search.
  - Admin `providerId` for POST /api/admin/moderators: there is no list.
  - `reset-password` `{id}`: discoverable via GET /api/admin/accounts.
- **Missing brief §8 endpoints** belong to other tracks: GET /api/hotels/:id, PATCH /api/hotels/:id/rooms/:roomId, and PATCH .../availability. This track's endpoints (countries, cities, currencies, airports) are all present.
- **Dev-user scheme.** The `dev-user` (x-dev-user) security scheme is always listed in Swagger, in production too (swagger.setup.ts:30-40), even though the stub is disabled there. Swagger UI is also always mounted (main.ts:11).
- **Money in minor units.** Amounts are integer minor units with no currency field (see spec question 5).
- **No documented 413.** No operation documents 413, although every JSON route can return it (body limit 100 kB).
- **DELETE with a body.** DELETE /api/users/me requires a JSON body. Some clients and proxies drop DELETE bodies.
