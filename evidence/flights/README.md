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

## FLT-04 (TRVL-31) cabin categories

Captured on `feature/FLT-04-cabins` as the Joudy Demo Air moderator, on flight JD777 (`6af0eaaec77901aa9f228658`).

| File | What it shows |
|---|---|
| `flt-04/01-flt04-add-economy-201.png` | `POST /api/flights/{id}/cabins` Economy: 201, 150 of 150 seats available, fare 25000 minor units, 1 bag of 23 kg |
| `flt-04/02-flt04-duplicate-class-409.png` | Economy again: 409 "This flight already has a ECONOMY cabin; edit it instead" |
| `flt-04/03-flt04-invalid-cabin-400.png` | Unknown class, zero seats, fractional price, negative bags, 0 kg: 400 with five field errors |
| `flt-04/04-flt04-change-fare-200.png` | `PATCH /api/flights/{id}/cabins/{cabinId}` fare 27500: 200, seats unchanged |

The seat floor (cannot go below seats booked or held) needs bookings, which do not exist yet; it is covered by the e2e
tests, including 20 parallel holds racing a seat reduction.

## FLT-08 (TRVL-34) extra baggage policy and FLT-11 (TRVL-36) one-way flight search

Captured on `feature/FLT-11-flight-search` (contains FLT-08) against the team Atlas cluster.

| File | What it shows |
|---|---|
| `flt-08/01-flt08-set-policy-200.png` | `PUT /api/airlines/{id}/baggage-policy` as the JD moderator: 200, 40.00 per extra bag, up to 2 per passenger |
| `flt-08/02-flt08-invalid-policy-400.png` | Price 0 and cap -1: 400 with two field errors |
| `flt-11/01-flt11-guest-search-200.png` | `GET /api/flights/search` CAI to DXB on 2026-12-01 for 2 passengers, **no `x-dev-user` (guest)**: JD777 Economy with Cairo and Dubai local times, 150 seats left, 275.00 per passenger, 550.00 total |
| `flt-11/02-flt11-no-flights-empty-page.png` | The same search on 2026-12-02: an empty page, the "no flights found" result |
| `flt-11/03-flt11-unknown-airport-400.png` | `to=XXX`: 400 "Unknown airport" field error |

## FLT-30 (TRVL-107) flight status lifecycle

Captured on `feature/FLT-05-edit-flight` (contains FLT-30, FLT-09, FLT-17, FLT-15 and FLT-05). Demo flight JD430 was
created to depart three minutes later; after its departure time the status job marked it Departed on its own.

| File | What it shows |
|---|---|
| `flt-30/01-flt30-departed-details.png` | `GET /api/flights/:id` for JD430 after departure: `"status": "DEPARTED"`, `"bookable": false` |
| `flt-30/02-flt30-departed-edit-409.png` | `PATCH /api/flights/:id/cabins/:cabinId` on the departed flight: 409 "Only Scheduled flights can be changed (FLT-30)" |

## FLT-09 (TRVL-35) cancellation tiers

| File | What it shows |
|---|---|
| `flt-09/01-flt09-set-tiers-200.png` | `PUT /api/airlines/:id/cancellation-policy` as the moderator with 30/100%, 7/50%, 1/25%: 200, tiers returned sorted 1/7/30 |
| `flt-09/02-flt09-duplicate-threshold-400.png` | Threshold 7 used twice: 400 on `tiers[1].daysBefore` |
| `flt-09/03-flt09-invalid-values-400.png` | Negative and fractional days, refund 120%: 400 with one field error per problem |
| `flt-09/04-flt09-preview-10-days-50pct.png` | `GET .../refund-preview?daysRemaining=10`: the 7-day tier, 50% |
| `flt-09/05-flt09-preview-0-days-0pct.png` | `daysRemaining=0`: no tier applies, `tierApplied: null`, 0% |

## FLT-17 (TRVL-39) flight details

| File | What it shows |
|---|---|
| `flt-17/01-flt17-flight-details-200.png` | `GET /api/flights/:id` (JD401, public): local times RUH 06:00+03:00 / DXB 10:00+04:00, 180 min, Economy and Business cabins with price, seats and bags, airline, extra baggage, tiers, `bookable: true` |
| `flt-17/02-flt17-unknown-flight-404.png` | Unknown flight id: 404 `NOT_FOUND` |

## FLT-15 (TRVL-38) price range and sort

Demo data: JD401 (Economy 200.00, Business 900.00), JD402 (350.00), JD403 (150.00) RUH -> DXB on 2027-12-20, 2 passengers.

| File | What it shows |
|---|---|
| `flt-15/01-flt15-price-range-sort-price-200.png` | `minPriceMinor=40000&maxPriceMinor=70000&sort=price`: JD401 Economy (40000) then JD402 (70000), both ends included, total 2 |
| `flt-15/02-flt15-sort-duration-200.png` | `maxPriceMinor=40000&sort=duration`: JD403 (120 min) before JD401 (180 min) |
| `flt-15/03-flt15-min-above-max-400.png` | `minPriceMinor=90000&maxPriceMinor=30000`: 400 on `maxPriceMinor` |

## FLT-05 (TRVL-32) edit Scheduled flights

| File | What it shows |
|---|---|
| `flt-05/01-flt05-change-times-200.png` | `PATCH /api/flights/:id` on JD403 with new local times: 200, 14:00+03:00 / 17:00+04:00, 120 min |
| `flt-05/02-flt05-change-airport-200.png` | `{"to": "CAI"}` with nothing booked: arrival now Cairo at the same local time 17:00+02:00, 240 min |
| `flt-05/03-flt05-arrival-before-departure-400.png` | Arrival not after departure (compared in UTC): 400 on `arrivalLocal` |
