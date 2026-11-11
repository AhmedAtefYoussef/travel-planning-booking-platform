# Swagger verification evidence: Sandra's requirements

**Evidence only:** this branch is never merged. It holds the Swagger UI screenshots that Sandra's pull requests
embed (same convention as `evidence/sprint-0-swagger` and `evidence/joudy-swagger`).

- **How the app ran:** local server on Sandra's machine on 9 Nov 2026, against her own test database
  (`sandra_demo`), with the `x-dev-user` stub auth header.
- **How the screenshots were taken:** each one comes from a real Swagger "Try it out → Execute" run in the browser.
  19 runs, all matched the expected result.
- **Demo data:** hotel **Sandra Demo Nile Hotel** (`6af212b1056f1cbae3f7892e`), room `6af21b0a056f1cbae3f78939`.
  The `x-dev-user` header in each curl shows who made the call.

## HTL-01 (TRVL-47, PR #22) admin creates hotel; hotel moderator edits hotel profile

| File | What it shows |
|---|---|
| `htl-01/00-hotels-operations.png` | `GET /api/docs`: the Hotels section lists the four hotel operations |
| `htl-01/01-htl01-admin-creates-201.png` | `POST /api/hotels` as `ADMIN`: 201, city `cairo` resolves to `countryCode` EG |
| `htl-01/02-htl01-invalid-input-400.png` | `POST /api/hotels` with invalid input: 400 `VALIDATION_FAILED` |
| `htl-01/03-htl01-unknown-city-400.png` | `POST /api/hotels` with an unknown city: 400 `BAD_REQUEST` |
| `htl-01/04-htl01-traveller-creates-403.png` | `POST /api/hotels` as a traveller (`USER`): 403 `FORBIDDEN` |
| `htl-01/05-htl01-moderator-edits-200.png` | `PATCH /api/hotels/{id}` as the hotel's moderator: 200, name and starClass updated |
| `htl-01/06-htl01-moderator-changes-city-200.png` | `PATCH /api/hotels/{id}` changing the city: 200, `countryCode` AE |
| `htl-01/07-htl01-empty-edit-400.png` | `PATCH /api/hotels/{id}` with an empty body: 400 `BAD_REQUEST` |
| `htl-01/08-htl01-other-moderator-403.png` | `PATCH /api/hotels/{id}` as another hotel's moderator: 403 `FORBIDDEN` |

## HTL-03 (TRVL-49, PR #23) add room

| File | What it shows |
|---|---|
| `htl-03/01-htl03-add-room-201.png` | `POST /api/hotels/{id}/rooms` as the hotel's moderator: 201, availability empty |
| `htl-03/02-htl03-duplicate-room-number-409.png` | The same room number again: 409 `DUPLICATE_KEY` |
| `htl-03/03-htl03-invalid-input-400.png` | Invalid room input: 400 `VALIDATION_FAILED` |
| `htl-03/04-htl03-other-moderator-403.png` | Another hotel's moderator: 403 `FORBIDDEN` |
| `htl-03/05-htl03-admin-adds-room-403.png` | `ADMIN` tries to add a room: 403 `FORBIDDEN` |

## HTL-04 (TRVL-50, PR #24) bookable date ranges per room

| File | What it shows |
|---|---|
| `htl-04/01-htl04-add-two-ranges-201.png` | `POST .../rooms/{roomId}/availability` with two ranges: 201, ranges sorted earliest first |
| `htl-04/02-htl04-touching-range-201.png` | A range that touches an existing one: 201 |
| `htl-04/03-htl04-overlaps-existing-409.png` | A range overlapping an existing one: 409 `CONFLICT`, nothing added |
| `htl-04/04-htl04-ranges-overlap-each-other-400.png` | Two ranges in one request that overlap each other: 400 `BAD_REQUEST` |
| `htl-04/05-htl04-invalid-dates-400.png` | Invalid dates: 400 with errors on `ranges[0].from` and `ranges[1].to` |
| `htl-04/06-htl04-other-moderator-403.png` | Another hotel's moderator: 403 `FORBIDDEN` |
