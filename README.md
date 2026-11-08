# Swagger verification evidence: Joudy's requirements

**Evidence only:** this branch is never merged. It holds the Swagger UI screenshots that Joudy's pull requests
embed (same convention as `evidence/sprint-0-swagger`).

- **How the app ran:** `npm run start:dev` on Joudy's machine with `NODE_ENV=development` and stub auth, against the
  team's MongoDB Atlas cluster, after `npm run seed`.
- **How the screenshots were taken:** each one comes from a real Swagger "Try it out → Execute" run in the browser.
  Where a response is taller than the screen, two screenshots of the same run are stacked (grey divider).

## GEN-12 (TRVL-110) reference data

| File | What it shows |
|---|---|
| `gen-12/01-gen12-reference-operations.png` | The Reference data tag; every summary starts with GEN-12 |
| `gen-12/02-gen12-countries-200.png` | `GET /api/countries`: the 8 seeded countries by name, page envelope `{page: 1, limit: 10, total: 8}` |
| `gen-12/03-gen12-cities-filter-200.png` | `GET /api/cities?countryCode=ae`: lower-case filter accepted, returns Dubai only |
| `gen-12/04-gen12-cities-invalid-400.png` | `GET /api/cities?countryCode=EGY`: 400 `VALIDATION_FAILED` with a `countryCode` field error |
| `gen-12/05-gen12-currencies-200.png` | `GET /api/currencies`: the 7 distinct currencies of Countries.csv, JPY with 0 minor units |

## FLT-02 (TRVL-29) predefined airport list

Captured on the stacked branch `feature/TRVL-138-flight-schemas` (contains GEN-12 and FLT-02), so the app also
booted with the new airlines and flights models ("Indexes ready for 12 model(s)").

| File | What it shows |
|---|---|
| `flt-02/01-flt02-airports-200.png` | `GET /api/airports`: the FLT-02 summary, then the 8 airports by IATA code with city, country and IANA time zone, `{page: 1, limit: 10, total: 8}` |
| `flt-02/02-flt02-page-invalid-400.png` | `GET /api/airports?page=1.5`: Swagger lets it through and the backend rejects it with 400 `VALIDATION_FAILED` and a `page` field error |

## FLT-01 (TRVL-28) airline profiles and FLT-03 + GEN-06 (TRVL-30, TRVL-101) flight creation

Captured on `feature/FLT-03-create-flight` (contains FLT-01) against the team Atlas cluster. Demo data is clearly
named: airline **Joudy Demo Air** (`JD`, id `6af0ea42c77901aa9f22864e`) and flight **JD777**. The `x-dev-user`
header in each curl shows who made the call.

| File | What it shows |
|---|---|
| `flt-01/01-flt01-admin-creates-201.png` | `POST /api/airlines` as `ADMIN`: 201, code `jd` stored as `JD`, active, empty policy |
| `flt-01/02-flt01-duplicate-code-409.png` | The same request again: 409 `DUPLICATE_KEY` on `code` |
| `flt-01/03-flt01-moderator-edits-200.png` | `PATCH /api/airlines/{id}` as the JD moderator: 200, new name and logo |
| `flt-01/04-flt01-other-moderator-403.png` | The same edit as a moderator of another airline: 403 "You can only manage your assigned airline" |
| `flt-03/01-flt03-create-cai-dxb-201.png` | `POST /api/flights`: Cairo 14:30 (UTC+2) to Dubai 18:45 (UTC+4) stored as 12:30Z to 14:45Z, local times returned (GEN-06), 135 min |
| `flt-03/02-flt03-duplicate-same-day-409.png` | JD777 again on the same local date: 409 `DUPLICATE_KEY` |
| `flt-03/03-flt03-arrival-before-departure-400.png` | 17:00 Cairo to 18:00 Dubai (15:00Z to 14:00Z): 400, `arrivalLocal` field error |
| `flt-03/04-flt03-departure-in-past-400.png` | Departure in 2024: 400, `departureLocal` field error |
