# RTM: Flights, airlines, airports (V&V track B, M1)

Scope: FLT-01, FLT-02, FLT-03, FLT-04, FLT-05 (Partial), FLT-08, FLT-09, FLT-11, FLT-15, FLT-17, FLT-30, GEN-06.
Baseline: branch `test/vv-m1-acceptance` from develop @ fc610e0.

Path abbreviations:
- Code `fs` = backend/src/modules/flights/flights.service.ts, `as` = .../airlines.service.ts, `ac` = .../airlines.controller.ts, `fc` = .../flights.controller.ts, `ss` = .../flight-search.service.ts, `st` = .../flight-status.service.ts, `fv` = .../flight-view.ts, `fn` = .../flight-schedule-notifier.ts, `adto` = .../dto/airline.dto.ts, `fdto` = .../dto/flight.dto.ts, `cdto` = .../dto/cabin.dto.ts, `sdto` = .../dto/flight-search.dto.ts, `fsch` = .../schemas/flight.schema.ts, `asch` = .../schemas/airline.schema.ts, `dates` = backend/src/common/utils/dates.ts, `pol` = backend/src/common/contracts/policies.contract.ts, `ref` = backend/src/modules/reference/reference.controller.ts.
- Existing tests (backend/test/): `air` = airlines.e2e-spec.ts, `cab` = cabins.e2e-spec.ts, `flt` = flights.e2e-spec.ts, `edit` = flight-edit.e2e-spec.ts, `srch` = flight-search.e2e-spec.ts, `filt` = flight-search-filters.e2e-spec.ts, `det` = flight-details.e2e-spec.ts, `stat` = flight-status.e2e-spec.ts, `fsch-e2e` = flight-schemas.e2e-spec.ts, `refe` = reference.e2e-spec.ts, `mods` = admin-moderators.e2e-spec.ts.
- VV test `V:n` = backend/test/vv/flights.vv.e2e-spec.ts line n. All VV tests use real cookie sessions: admin (loginAs), airline moderator created via POST /api/admin/moderators, logged in, temporary password changed.

| Rule | Source | Rule text | Endpoint | Code (file:line) | Existing test (spec:line) | VV test | Verdict | Finding |
|---|---|---|---|---|---|---|---|---|
| R-FLT-01-01 | workbook | Admin creates an airline profile (name, code, logo) | POST /api/airlines | ac:44-72, as:36-43 | air:26 | V:149 | PASS | |
| R-FLT-01-02 | jira-dod | Only admins create airlines: guest 401, user and moderator 403, nothing stored | POST /api/airlines | ac:45 | air:72 | V:149 | PASS | |
| R-FLT-01-03 | workbook | The airline moderator edits their airline's name, code, logo | PATCH /api/airlines/:id | ac:88-126, as:49-72 | air:106, mods:53 | V:205 | PASS | |
| R-FLT-01-04 | jira-dod | Another airline's moderator, admin, user get 403 (guest 401) and the DB is unchanged; a stub header cannot widen a real session | PATCH /api/airlines/:id | as:55, common/auth/auth.guard.ts:56-61 | air:125, air:136 | V:205 | PASS | |
| R-FLT-01-05 | derived | Code 2-3 letters/digits, stored in capitals, unique regardless of case/spaces, on create, edit and under a race (409) | POST/PATCH /api/airlines | adto:28-35, asch:79-87 | air:47, air:149, fsch-e2e:48 | V:170 | PASS | |
| R-FLT-01-06 | jira-dod | Invalid input returns 400 VALIDATION_FAILED with fieldErrors (GEN-02) | POST/PATCH /api/airlines | adto:26-48 | air:56, air:162 | | PASS | |
| R-FLT-01-07 | jira-dod | Unknown fields (isActive, policy, id) rejected, nothing changes (GEN-13) | POST/PATCH /api/airlines | common/pipes/validation.pipe.ts:36-39 | air:192 | V:267 | PASS | |
| R-FLT-01-08 | workbook | Logo is an uploaded JPG/PNG up to 5 MB, one per airline (dependsOn GEN-08) | (upload not built) | adto:51-52 | | | BLOCKED-BY GEN-08 | |
| R-FLT-01-09 | derived | Until GEN-08: logoUrl must be an http(s) URL (javascript:, ftp:, data:, relative rejected); null removes it | PATCH /api/airlines/:id | adto:36-48 | air:162 | V:299 | PASS | |
| R-FLT-02-01 | workbook | Predefined airport list with IATA code, name, city, country, IANA zone, loaded at setup; zones exact | GET /api/airports | ref:53-63, seed/data/Airports.csv | refe:110 | V:326 | PASS | |
| R-FLT-02-02 | workbook | The list is read-only (no create/update/delete route) | POST/PATCH/DELETE /api/airports | ref:24-63 | refe:130 | | PASS | |
| R-FLT-02-03 | workbook | Flight creation accepts only listed airports (XXX rejected, malformed rejected) | POST /api/flights | fs:62-75, fdto:18-25 | flt:151, edit:203 | V:357 | PASS | |
| R-FLT-02-04 | workbook | Flight search accepts only listed airports | GET /api/flights/search | ss:152-165 | srch:303 | V:390 | PASS | |
| R-FLT-02-05 | derived | IATA codes are case-insensitive (lhr = LHR) on create and search | POST /api/flights, GET search | fdto:10-11, sdto:39-62 | flt:48 | V:357, V:390 | PASS | |
| R-FLT-02-06 | jira-dod | GEN-05: page size 10, `limit` rejected | GET /api/airports | common/pagination/pagination.ts:31-53 | refe:110, refe:144 | V:326 | PASS | |
| R-FLT-03-01 | workbook | Moderator creates a flight (number, airports, local dep/arr) entered in each airport's local time and stored in UTC; correct for all 8 zones in winter and summer | POST /api/flights | fs:52-119, dates:36-59 | flt:48 | V:439 | PASS | |
| R-FLT-03-02 | workbook | Reject identical airports | POST /api/flights | fs:76-80 | flt:103 | V:390 (search) | PASS | |
| R-FLT-03-03 | workbook | Reject an arrival not after departure, compared in UTC (equal instant refused; local-earlier but UTC-later accepted, incl. date line) | POST /api/flights | fs:94-98 | flt:103 | V:530 | PASS | |
| R-FLT-03-04 | workbook | Reject a departure in the past | POST /api/flights | fs:89-93 | flt:103 | V:570 | PASS | |
| R-FLT-03-05 | workbook | Reject a duplicate flight number for the same airline on the same (local) departure date; allowed on another local date or another airline; exactly one under a race | POST /api/flights | fs:112-114, fsch:180-183 | flt:76, flt:90, fsch-e2e:57 | V:584, V:633 | PASS | |
| R-FLT-03-06 | derived | Flight number 2-8 letters/digits, compared in capitals (ab1 = AB1) | POST /api/flights | fdto:58-62 | | V:584 | PASS | |
| R-FLT-03-07 | derived | A local time skipped by spring-forward (LHR 2027-03-28T01:30, JFK 2027-03-14T02:30) is rejected per field | POST /api/flights | dates:48-52, fs:514-527 | | V:469 | PASS | |
| R-FLT-03-08 | derived | A local time in the repeated autumn hour (LHR 2027-10-31T01:30) is rejected; 00:30 BST and 02:30 GMT convert correctly | POST /api/flights | dates:53-57 | | V:494 | PASS | SQ-B-01 |
| R-FLT-03-09 | jira-dod | Only an airline moderator (real session) creates flights, always for the session's airline; admin/user 403, guest 401; status/departureUtc/cabins/airlineId in the body rejected | POST /api/flights | fc:95, fs:57, fs:497-511 | flt:162, flt:173 | V:648, V:671 | PASS | |
| R-FLT-03-10 | derived | A deactivated airline's moderator cannot create flights (ACC-15) | POST /api/flights | fs:59, as:156-166 | flt:198 | V:648 | PASS | |
| R-FLT-03-11 | jira-dod | Swagger examples are documented and valid when run | POST /api/flights, PATCH /api/flights/:id | fc:105-124, fc:190-199, fdto:39-47 | | V:694 (it.failing) | FAIL | F-B-01 |
| R-FLT-04-01 | workbook | Cabin class from the fixed set {Economy, Premium Economy, Business, First} | POST /api/flights/:id/cabins | cdto:55-62, fsch:14-19 | cab:138 | V:753 | PASS | |
| R-FLT-04-02 | workbook | Each class at most once per flight, also under parallel requests | POST /api/flights/:id/cabins | fs:277-304, fsch:161-169 | cab:95, cab:122 | V:753 | PASS | |
| R-FLT-04-03 | workbook | Seat count whole number > 0 (1 accepted; 0, fractions, text rejected) | POST/PATCH cabins | cdto:10-11 | cab:138, cab:204 | V:753, V:782 | PASS | |
| R-FLT-04-04 | workbook | Price > 0 (whole minor units) | POST/PATCH cabins | cdto:12-16 | cab:138 | V:753, V:782 | PASS | |
| R-FLT-04-05 | workbook | Free baggage allowance (bag count) and maximum kg per bag per cabin | POST/PATCH cabins | cdto:17-24 | cab:76, cab:138 | V:753 | PASS | |
| R-FLT-04-06 | derived | freeBags >= 0, maxKgPerBag 1..100 | POST/PATCH cabins | cdto:17-24 | cab:350 | | PASS | |
| R-FLT-04-07 | jira-dod | Only the flight's airline moderator adds cabins; others 403/401, DB unchanged | POST /api/flights/:id/cabins | fs:465-484 | cab:161 | V:745 | PASS | |
| R-FLT-04-08 | jira-dod | seatsAvailable and _id cannot be mass-assigned (GEN-13) | POST /api/flights/:id/cabins | validation.pipe.ts:36-39 | | V:782 | PASS | |
| R-FLT-05-01 | workbook | Moderator edits departure/arrival times of their own Scheduled flights | PATCH /api/flights/:id | fs:130-265 | edit:110, edit:141 | V:1499 | PASS | |
| R-FLT-05-02 | workbook | Moderator edits cabin prices and seat counts | PATCH /api/flights/:id/cabins/:cabinId | fs:324-409 | cab:228, cab:241, edit:178 | V:1499 | PASS | |
| R-FLT-05-03 | workbook | Only their own flights: other airline/admin/user 403, guest 401, DB unchanged | PATCH flight and cabin | fs:477 | edit:251 | V:845 | PASS | |
| R-FLT-05-04 | workbook | Only Scheduled flights are editable (Departed, Cancelled -> 409) | PATCH flight and cabin, POST cabin | fs:478-480 | edit:251, stat:128, cab:328 | V:1388, V:1438 | PASS | |
| R-FLT-05-05 | workbook | Airports cannot be changed once the flight has any booking | PATCH /api/flights/:id | fs:153-157, fs:223, fs:529-549 | edit:155 | V:919 | PARTIAL | SQ-B-03 |
| R-FLT-05-06 | workbook | Seat counts cannot be reduced below seats already booked or held (race-safe) | PATCH cabins | fs:352-355, fs:369-376 | cab:253, cab:283, edit:178 | | PASS | |
| R-FLT-05-07 | workbook | Price changes do not affect existing bookings | PATCH cabins | fs:317-323 (comment only) | | | BLOCKED-BY FLT-22 | |
| R-FLT-05-08 | workbook | Any time change sends an in-app notification to passengers with Confirmed bookings | PATCH /api/flights/:id | fs:254-263, fn:39-45 | edit:110 (fake providers) | | BLOCKED-BY GEN-01 | |
| R-FLT-05-09 | derived | Edited times pass the FLT-03 checks again (past, order, DST gap, duplicate number) | PATCH /api/flights/:id | fs:184-206 | edit:203, edit:268 | V:893 | PASS | |
| R-FLT-05-10 | jira-dod | status, airlineId, cabins, departureUtc, flightNumber, seatsAvailable, class, _id rejected (GEN-13) | PATCH flight and cabin | validation.pipe.ts:36-39 | edit:203, cab:307 | V:868 | PASS | |
| R-FLT-05-11 | derived | A time not sent keeps its local wall-clock time at the (new) airport when an airport changes | PATCH /api/flights/:id | fs:184-187 | edit:155 | V:907 | PASS | SQ-B-02 |
| R-FLT-08-01 | workbook | Price per extra bag > 0 (whole minor units; 0, text rejected) | PUT /api/airlines/:id/baggage-policy | adto:107-116 | air:256, air:222 | V:950, V:969 | PASS | |
| R-FLT-08-02 | workbook | Max extra bags per passenger >= 0, whole (0 accepted; -1, 0.5, "2" rejected) | PUT baggage-policy | adto:118-126 | air:244, air:256 | V:950, V:969 | PASS | |
| R-FLT-08-03 | workbook | Each extra bag has the same max weight as the cabin's free allowance: no separate weight is stored or accepted; details show one kg value per cabin | PUT baggage-policy, GET /api/flights/:id | adto:103-106, fsch:87-89, fs:432-447 | det:59 | V:969, V:1009 | PASS | |
| R-FLT-08-04 | workbook | The limit is applied when extra bags are bought | (booking not built) | | | | BLOCKED-BY FLT-19 | |
| R-FLT-08-05 | jira-dod | Only this airline's moderator; others 403/401, DB unchanged | PUT baggage-policy | as:81 | air:272 | V:950 | PASS | |
| R-FLT-09-01 | workbook | Thresholds are unique | PUT /api/airlines/:id/cancellation-policy | pol:73-105 | air:342 | | PASS | |
| R-FLT-09-02 | workbook | Threshold integer >= 0 | PUT cancellation-policy | adto:130-139 | air:363, air:398 | V:1103 | PASS | |
| R-FLT-09-03 | workbook | Refund 0-100% (0 and 100 accepted; 100.01, -0.01 rejected) | PUT cancellation-policy | adto:141-153 | air:363 | V:1103 | PASS | |
| R-FLT-09-04 | workbook | Refund uses the tier with the highest threshold not exceeding the days remaining (table incl. exactly-equal threshold, 0-day tier) | GET /api/airlines/:id/cancellation-policy/refund-preview | pol:46-60, as:121-137 | air:316 | V:1065, V:1088 | PASS | |
| R-FLT-09-05 | workbook | No tier applies (below all, or empty list) -> 0% | refund-preview | as:135 | air:333, air:410 | V:1065, V:1088 | PASS | |
| R-FLT-09-06 | derived | Refund up to 2 decimals; at most 20 tiers; unknown tier fields rejected | PUT cancellation-policy | adto:147-166 | | V:1103 | PASS | |
| R-FLT-09-07 | jira-dod | Only this airline's moderator; others 403/401, DB unchanged | PUT cancellation-policy | as:102 | air:420 | V:1127 | PASS | |
| R-FLT-09-08 | workbook | The rule is applied to the refund of a real cancellation | (cancellation not built) | dates:121-123 | | | BLOCKED-BY PAY-03 | SQ-B-05 |
| R-FLT-11-01 | workbook | Guests (no cookie) and registered users can search, same results | GET /api/flights/search | fc:54-75 (@Public) | srch:179 | V:1155 | PASS | |
| R-FLT-11-02 | workbook | Search by departure airport, arrival airport, departure date, passengers | GET search | sdto:47-84 | srch:179, srch:303 | | PASS | |
| R-FLT-11-03 | workbook | Departure date is the local date at the departure airport (positive and negative offsets, 00:00, 23:59, 23 h and 25 h DST days) | GET search | dates:68-82, ss:184-206 | srch:238, srch:255 | V:1155, V:1193 | PASS | |
| R-FLT-11-04 | workbook | Only Scheduled flights (Cancelled, Departed, and already-left-but-not-yet-marked excluded) | GET search | ss:202-205 | srch:179, stat:115 | V:1262, V:1388, V:1438 | PASS | |
| R-FLT-11-05 | workbook | Only flights of active airlines | GET search | ss:208-225 | srch:179 | | PASS | |
| R-FLT-11-06 | workbook | Only cabins whose available seats (total - booked - held) cover the passengers (equal included, +1 excluded) | GET search | ss:227, fsch:25-29 | srch:216 | V:1223 | PARTIAL | held seats come from FLT-22 (not built); proven only with simulated decrements |
| R-FLT-11-07 | workbook | User selects a flight and cabin to continue | GET search (flightId + cabinId) | ss:285-321 | srch:179 | | BLOCKED-BY FLT-22 | |
| R-FLT-11-08 | workbook | "No flights found" when nothing matches (empty page shape) | GET search | ss:262-266 | srch:289 | | PASS | |
| R-FLT-11-09 | jira-dod | Field errors (GEN-02), `limit` rejected, page size 10 (GEN-05) | GET search | sdto:47-121 | srch:303 | V:1334 | PASS | |
| R-FLT-15-01 | workbook | Inclusive min and max price (fares equal to either bound kept) | GET search | ss:274-283 | filt:138, filt:173 | V:1356 | PASS | |
| R-FLT-15-02 | workbook | Price filter preserves the other criteria (date, passengers/seats) | GET search | ss:197-236 | filt:138 | V:1356 | PASS | |
| R-FLT-15-03 | workbook | Error if min > max (400, field maxPriceMinor) | GET search | ss:172-182 | filt:191 | V:1356 | PASS | |
| R-FLT-15-04 | workbook | Sort by price, duration or departure time | GET search | ss:58-73 | filt:101, filt:115, filt:122 | V:1334 | PASS | |
| R-FLT-15-05 | derived | The range applies to the fare per passenger, not the party total | GET search | ss:270-283 | filt:138 | | PASS | SQ-B-04 |
| R-FLT-15-06 | derived | Ties broken deterministically: 11 tied rows give pages of 10 + 1 with no repeats or gaps for every sort | GET search | ss:58-73 | | V:1334 | PASS | |
| R-FLT-15-07 | jira-dod | Invalid prices and sort keys -> 400 fieldErrors | GET search | sdto:86-120 | filt:205 | | PASS | |
| R-FLT-17-01 | workbook | Details show airline, flight number, airports | GET /api/flights/:id | fs:416-459 | det:59 | | PASS | |
| R-FLT-17-02 | workbook | Local departure and arrival times (winter and summer offsets) | GET /api/flights/:id | fv:13-56 | det:59 | V:1499, V:1542 | PASS | |
| R-FLT-17-03 | workbook | Duration | GET /api/flights/:id | dates:84-86 | det:59 | V:1542 | PASS | |
| R-FLT-17-04 | workbook | Each cabin with price, seats remaining, baggage allowance | GET /api/flights/:id | fv:44-52 | det:59, det:154 | V:1009 | PASS | |
| R-FLT-17-05 | workbook | The airline's cancellation policy (empty list when none) | GET /api/flights/:id | fs:448-453 | det:59 | V:1542 | PASS | |
| R-FLT-17-06 | derived | Public; Cancelled/Departed/deactivated still open with bookable=false; 404 unknown, 400 malformed id | GET /api/flights/:id | fs:454-457 | det:179, det:198, det:207 | V:1388 | PASS | |
| R-FLT-30-01 | workbook | Status is Scheduled, Cancelled or Departed; new flights Scheduled | (schema) | fsch:7-11 | stat:79 | V:648 | PASS | |
| R-FLT-30-02 | workbook | A flight becomes Departed once its departure time has passed (boundary: at dep-1 ms still Scheduled, at dep Departed) | FlightStatusService.markDeparted | st:42-53, st:55-66 | stat:85 | V:1388 | PASS | SQ-B-06 |
| R-FLT-30-03 | workbook | Only Scheduled flights are searchable | GET search | ss:202-205 | stat:115 | V:1388, V:1438 | PASS | |
| R-FLT-30-04 | workbook | Only Scheduled flights are editable (flight, add cabin, edit cabin) | PATCH flight/cabin, POST cabin | fs:478-480 | stat:128, cab:328 | V:1388, V:1438 | PASS | |
| R-FLT-30-05 | workbook | Only Scheduled flights are bookable | (booking not built) | fs:454-457 (bookable flag) | det:179 | | BLOCKED-BY FLT-22 | |
| R-FLT-30-06 | workbook | A flight can become Cancelled | (FLT-06 not built) | | | | BLOCKED-BY FLT-06 | |
| R-GEN-06-01 | workbook | Flight times in each airport's local zone in every flight response (create, add/edit cabin, edit flight, details, search) | all flight endpoints | fv:13-56, ss:300-311 | flt:48, det:59, srch:179 | V:1499 | PASS | |
| R-GEN-06-02 | derived | Offsets follow DST (London +01:00 / New York -04:00 in July) | all flight endpoints | dates:61-65 | | V:439, V:1542 | PASS | |

## Verdict counts

| Req | PASS | FAIL | PARTIAL | BLOCKED-BY | UNTESTED |
|---|---|---|---|---|---|
| FLT-01 | 8 | 0 | 0 | 1 (GEN-08) | 0 |
| FLT-02 | 6 | 0 | 0 | 0 | 0 |
| FLT-03 | 10 | 1 | 0 | 0 | 0 |
| FLT-04 | 8 | 0 | 0 | 0 | 0 |
| FLT-05 | 8 | 0 | 1 | 2 (FLT-22, GEN-01) | 0 |
| FLT-08 | 4 | 0 | 0 | 1 (FLT-19) | 0 |
| FLT-09 | 7 | 0 | 0 | 1 (PAY-03) | 0 |
| FLT-11 | 7 | 0 | 1 | 1 (FLT-22) | 0 |
| FLT-15 | 7 | 0 | 0 | 0 | 0 |
| FLT-17 | 6 | 0 | 0 | 0 | 0 |
| FLT-30 | 4 | 0 | 0 | 2 (FLT-22, FLT-06) | 0 |
| GEN-06 | 2 | 0 | 0 | 0 | 0 |

Brief §8 endpoints: all 12 airline/flight/airport endpoints exist with the brief's paths and methods. One extra public endpoint exists: GET /api/airlines/:id/cancellation-policy/refund-preview (FLT-09). Nothing is missing or renamed.

## Findings

- **F-B-01** (Low, FLT-03; Jira DoD "examples ... documented")
  - Expected: the Swagger request examples labelled "Valid" create a flight when run from Swagger UI, so they stay usable for the life of the project.
  - Actual: the POST /api/flights examples `cairoToDubai` and `londonToNewYork` (and the CreateFlightDto property examples) depart on 2026-12-01. From 2026-12-02 they fail with 400 "Departure must be in the future" (FLT-03 "reject ... a departure in the past"). The PATCH examples (2027-12-01) expire a year later.
  - Repro: on or after 2026-12-02, as an airline moderator, send `POST /api/flights` with `{"flightNumber":"MS777","from":"CAI","to":"DXB","departureLocal":"2026-12-01T14:30","arrivalLocal":"2026-12-01T18:45"}`. Result: 400, fieldErrors `[{"field":"departureLocal","message":"Departure must be in the future"}]`.
  - Code: flights.controller.ts:105-124 and 190-199; dto/flight.dto.ts:39-47. backend/scripts/openapi-rules.ts does not run examples.
  - Proven by: `it.failing('the Swagger "valid" create examples stay valid after 1 Dec 2026')` (V:694). It calls FlightsService.create with `now` = 2026-12-02.

No other defects were found. Every other workbook rule in scope that is built passed, using real cookie sessions.

## Spec questions

- **SQ-B-01** (FLT-03, derived): the backend rejects a local time inside the repeated autumn hour (for example LHR 2027-10-31T01:30) instead of picking one of the two instants. The workbook only asks for local-to-UTC storage. Should moderators be able to schedule a 01:30 departure on that night, for example with an explicit offset?
- **SQ-B-02** (FLT-05): when an airport changes and a time is not resent, the old wall-clock time is reinterpreted in the new airport's zone (flights.service.ts:184-187). For example, Cairo 14:30 (12:30Z) moved to RUH becomes Riyadh 14:30 (11:30Z). Swagger documents this, and airports can only change while nothing is booked, so no passenger is affected. We record it as a spec question, not a defect. Should the UTC instant be kept instead?
- **SQ-B-03** (FLT-05): "has any booking" is approximated by "any seat currently booked or held" (flights.service.ts:529-549). Once a booking is cancelled or expires, its seats return and the airports unlock again (V:919). Does a Cancelled or Expired booking still count as "any booking"? This cannot be settled until the bookings module (FLT-22) exists.
- **SQ-B-04** (FLT-15): the inclusive price range applies to the fare per passenger, not to the party total (decided in PR #17). The workbook says only "price".
- **SQ-B-05** (FLT-09): "days remaining" is computed as whole 24-hour periods, rounded down (dates.ts:121-123), not as calendar days at the departure airport. For example, 6 days 23 hours before departure counts as 6. Please confirm before PAY-03 applies it.
- **SQ-B-06** (FLT-30): outside tests the Departed job runs every 60 s (flight-status.service.ts:17, 55-66). For up to a minute after departure, GET /api/flights/:id can still show `status: SCHEDULED`. Search and edits already treat the flight as departed (they compare with the clock), and `bookable` is false. Is that lag acceptable on the details page?
- Note on planning risk 2, "`new Date()` instead of the injected `now`": update/addCabin/updateCabin use `new Date()` only in their atomic DB filters (flights.service.ts:219, 287, 385, 480). The controllers never pass `now`, so HTTP callers see no difference, and this is not a defect. It does mean the services' `now` parameter cannot fully simulate time in unit tests.
