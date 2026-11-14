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

## HTL-05 (TRVL-51, PR #54) edit a room and replace its availability

Captured on 13 Nov 2026 on `feature/HTL-05-edit-room`, against `sandra_demo`. Hotel `6af7596315dd5acc6878d0ea`,
room 101 `6af75a6515dd5acc6878d0f1`. There is no booking endpoint yet, so for runs 6 and 7 one BOOKED night
(2027-01-10) was inserted into `room_nights` by hand. Two screenshots of one run are stacked (grey divider).

| File | What it shows |
|---|---|
| `htl-05/00-htl05-routes-listed.png` | The Hotels section lists both HTL-05 routes |
| `htl-05/01-htl05-edit-room-200.png` | `PATCH /api/hotels/{id}/rooms/{roomId}` with beds 3, maxOccupancy 4, priceMinor 12500: 200, number and type unchanged |
| `htl-05/02-htl05-empty-edit-400.png` | `{}`: 400 "Send at least one of beds, maxOccupancy, priceMinor" |
| `htl-05/03-htl05-null-beds-400.png` | `{"beds": null}`: 400 `VALIDATION_FAILED` with `beds` field errors (null is rejected, not ignored) |
| `htl-05/04-htl05-replace-ranges-200.png` | `PATCH .../availability` with two ranges: 200, replaced and sorted earliest first |
| `htl-05/05-htl05-past-range-400.png` | A range ending in 2000: 400 on `ranges[0].to` |
| `htl-05/06-htl05-booked-night-409.png` | Replacing with 2027-01-15 to 2027-01-20 while 2027-01-10 is booked: 409 naming that night, nothing changed |
| `htl-05/07-htl05-keep-booked-night-200.png` | 2027-01-10 to 2027-01-12 keeps the booked night inside a range: 200 (run at 19:10:34) |
| `htl-05/08-htl05-other-moderator-403.png` | Another hotel's moderator: 403 "You can only manage your assigned hotel" |

## HTL-09 (TRVL-54, PR #56) check-in and check-out times

Captured on 14 Nov 2026 on `feature/HTL-09-check-in-out-times`, against `sandra_demo`, hotel
`6af887d93345c3faf4ed1043` (Policy Demo Hotel). Two screenshots of one run are stacked (grey divider).

| File | What it shows |
|---|---|
| `htl-09/00-htl09-hotel-created-201.png` | `POST /api/hotels` as `ADMIN`: 201, `checkInTime` and `checkOutTime` are `null` |
| `htl-09/01-htl09-set-times-200.png` | `PUT /api/hotels/{id}/policies` with 14:00 / 12:00 as the hotel's moderator: 200, both times returned |
| `htl-09/02-htl09-invalid-times-400.png` | `2pm` / `24:00`: 400 `VALIDATION_FAILED` with errors on both fields |
| `htl-09/03-htl09-missing-checkout-400.png` | Check-in only: 400 on `checkOutTime` |
| `htl-09/04-htl09-other-moderator-403.png` | Another hotel's moderator: 403 "You can only manage your assigned hotel" |
