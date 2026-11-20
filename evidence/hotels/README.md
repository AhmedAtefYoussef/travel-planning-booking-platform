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

## HTL-02, HTL-06, HTL-08, HTL-11, HTL-12 and HTL-15: how they were captured

Captured on 18 Nov 2026 from a local build of the HTL-08 branch, which includes every story below: HTL-02, HTL-11,
HTL-12, HTL-15 and HTL-08 stacked on top of each other, plus HTL-06. It ran against a throwaway in-memory database
with the `x-dev-user` stub auth header. The demo data:

- **Nile Demo Hotel** (`6afd943f4304c71ce1f51472`, Cairo) with rooms 101 Double 10000 (`…51478`), 102 Family Suite
  for 4 at 25000 (`…5147f`), 103 Single 6000 (`…51486`) and 104 Double 9000 (`…5148d`). All are bookable 1 Jan to
  1 Mar 2027. Room 101 is booked on 20 and 21 Jan (`HT-DEMO0001`) and held on 25 Jan (unpaid booking). Room 102 is
  blocked on 14 and 15 Jan. It has two reviews (5 and 4).
- **Tahrir Budget Inn** (Cairo, rooms at 7000 and 5000, one review of 3), **Marina Demo Resort** (Dubai) and
  **Other Demo Hotel** (Paris), whose moderator plays "another hotel's moderator".

Where one run needed more than one screenshot (the request, then scrolling through the response), they are
stacked in one file with a grey divider. Only the "Server response" part counts; Swagger's built-in "Example
Value" boxes are left out.

## HTL-02 (TRVL-48, PR #89) hotel details page

| File | What it shows |
|---|---|
| `htl-02/00-htl02-setup-policies-200.png` | Setup: `PUT /api/hotels/{id}/policies` as the hotel's moderator: check-in 14:00, check-out 12:00, tiers 30 days → 100 % and 7 days → 50 %: 200 |
| `htl-02/01-htl02-public-page-no-dates-200.png` | `GET /api/hotels/{id}` with no login and no dates: 200 with the profile, check-in/out times, both tiers, `ratingAvg` 4.5 from 2 reviews, `stay: null`, and all four rooms with no stay totals |
| `htl-02/02-htl02-free-rooms-with-dates-200.png` | `?checkIn=2027-01-10&checkOut=2027-01-13`: 200, `stay.nights` 3, rooms 104, 101 and 102 with `stayTotalMinor` = 3 × price. Taken before the policies were set, so the times are still null |
| `htl-02/03-htl02-checkin-only-400.png` | `?checkIn=2027-01-20` alone: 400 on `checkOut`, "Send both checkIn and checkOut to see the free rooms, or neither" |
| `htl-02/04-htl02-unknown-hotel-404.png` | An unknown hotel id: 404 "Hotel not found" |

## HTL-11 (PR to follow) hotel search

| File | What it shows |
|---|---|
| `htl-11/01-htl11-search-cairo-200.png` | `GET /api/hotels/search?cityId=cairo`, 20 → 22 Jan, 2 guests, 1 room, no login: Tahrir Budget Inn from 7000 and Nile Demo Hotel from 9000, `total` 2 |
| `htl-11/02-htl11-search-country-ae-200.png` | `countryCode=AE`: only Marina Demo Resort (Dubai), `total` 1 |
| `htl-11/03-htl11-four-guests-one-room-200.png` | 4 guests in 1 room: only Nile Demo Hotel, from 25000 (the Family Suite, the only room for 4) |
| `htl-11/04-htl11-four-guests-two-rooms-200.png` | 4 guests in 2 rooms: Nile Demo Hotel from 31000 (the cheapest pair that holds 4 guests) |
| `htl-11/05-htl11-checkout-before-checkin-400.png` | checkIn 22 Jan, checkOut 20 Jan: 400 on `checkOut`, "checkOut must be after checkIn, at most 30 nights later" |
| `htl-11/06-htl11-city-and-country-400.png` | Both `cityId` and `countryCode` sent: 400 on `countryCode`, "Send exactly one of cityId or countryCode" |

## HTL-12 (PR to follow) search filters and sorting

| File | What it shows |
|---|---|
| `htl-12/01-htl12-min-rating-200.png` | `minRating=4`: only Nile Demo Hotel (rating 4.5) |
| `htl-12/02-htl12-max-price-200.png` | `maxPriceMinor=8000`: only Tahrir Budget Inn (7000), `total` 1 |
| `htl-12/03-htl12-sort-price-200.png` | `sort=price`: Tahrir (7000) first, then Nile (9000) |
| `htl-12/04-htl12-sort-rating-200.png` | `sort=rating`: Nile (4.5) first, then Tahrir (3) |
| `htl-12/05-htl12-min-above-max-400.png` | `minPriceMinor=9000&maxPriceMinor=8000`: 400 on `maxPriceMinor`, "must be greater than or equal to minPriceMinor (9000)" |

## HTL-15 (PR to follow) free rooms for the chosen dates

| File | What it shows |
|---|---|
| `htl-15/01-htl15-free-rooms-200.png` | `GET /api/hotels/{id}/rooms/available`, 20 → 22 Jan: rooms 103, 104 and 102, cheapest first, with `stayTotalMinor`; 101 is missing (booked) |
| `htl-15/02-htl15-blocked-room-hidden-200.png` | 14 → 16 Jan: rooms 103, 104 and 101, `total` 3; 102 is missing (blocked by the moderator) |
| `htl-15/03-htl15-held-room-hidden-200.png` | 25 → 26 Jan: rooms 103, 104 and 102, `total` 3; 101 is missing (held for an unpaid booking) |
| `htl-15/04-htl15-stay-over-30-nights-400.png` | 1 Jan → 15 Feb: 400 on `checkOut`, "checkOut must be after checkIn, at most 30 nights later" |
| `htl-15/05-htl15-fourteen-night-stay-200.png` | Extra: 1 → 15 Jan (14 nights) is allowed: 104 at 126000 and 101 at 140000 (14 × price); 102 and 103 are hidden because they are blocked in that period |

## HTL-08 (PR to follow) moderator's room calendar

| File | What it shows |
|---|---|
| `htl-08/01-htl08-booked-held-blocked-200.png` | `GET /api/hotels/{id}/availability?from=2027-01-14&to=2027-01-27` as the hotel's moderator: room 101 `BOOKED` on 20 and 21 Jan with reference `HT-DEMO0001`, `HELD` on 25 Jan with `holdExpiresAt`, and room 102 `BLOCKED` on 14 and 15 Jan |
| `htl-08/02-htl08-not-bookable-200.png` | 27 Feb → 3 Mar: every room `AVAILABLE` on 27 and 28 Feb and `NOT_BOOKABLE` on 1 and 2 Mar (after its bookable range ends), `total` 4 |
| `htl-08/03-htl08-other-moderator-403.png` | Another hotel's moderator: 403 "You can only manage your assigned hotel" |

## HTL-06 (TRVL-52, PR #87) block dates, deactivate and delete rooms

Run in this order, as the Nile Demo Hotel's moderator unless stated. Step 1 was captured last, after a reset,
on room 101, which has free nights on 10 and 11 Jan.

| File | What it shows |
|---|---|
| `htl-06/01-htl06-block-nights-201.png` | `POST .../rooms/{roomId}/blocks` on room 101, 10 → 12 Jan: 201, `blocked` 10 → 12 |
| `htl-06/02-htl06-already-blocked-409.png` | The same block again on room 103: 409 "Already blocked: 2027-01-10, 2027-01-11. Nothing was blocked" |
| `htl-06/03-htl06-unblock-one-night-200.png` | `DELETE .../blocks` for 11 Jan on room 103: 200, only 10 → 11 is still blocked |
| `htl-06/04-htl06-reserved-night-409.png` | Blocking 20 Jan on room 101, which is booked: 409 "These nights have reservations: 2027-01-20. Nothing was blocked" |
| `htl-06/05-htl06-deactivate-reserved-room-409.png` | `PATCH .../rooms/{roomId}` `{"isActive": false}` on room 101: 409 "Room 101 has reservations on 2027-01-20, 2027-01-21, 2027-01-25. Nothing was changed". Swagger labels it "Undocumented" here; PR #87 now documents the 409 (commit 4af722c) |
| `htl-06/06-htl06-deactivate-room-200.png` | `{"isActive": false}` on room 103: 200, `isActive` false |
| `htl-06/07-htl06-reactivate-room-200.png` | `{"isActive": true}` on room 103: 200, `isActive` true |
| `htl-06/08-htl06-delete-unused-room-204.png` | `DELETE .../rooms/{roomId}` on room 104, never reserved: 204 |
| `htl-06/09-htl06-delete-reserved-room-409.png` | `DELETE` on room 101: 409 "Room 101 has been reserved, so it cannot be deleted. Deactivate it instead (isActive: false)" |
| `htl-06/10-htl06-other-moderator-403.png` | Another hotel's moderator deletes room 103: 403 "You can only manage your assigned hotel" |
