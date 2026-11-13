# V&V M1, track C (Hotels): requirements traceability

Scope: HTL-01, HTL-03 and HTL-04 as merged on `test/vv-m1-acceptance` (develop @ fc610e0), plus a pre-merge review of open PR #54 (HTL-05, `origin/feature/HTL-05-edit-room`). HTL-02 is not started.

- VV spec, merged scope: `backend/test/vv/hotels.vv.e2e-spec.ts` (written `vv:<line>` below). Every request uses a real cookie session. The admin creates hotels P and Q, then a hotel moderator for each through `POST /api/admin/moderators`, and each moderator completes the forced password change.
- VV spec, PR #54: written in a throw-away local worktree (develop merged with the PR branch, never pushed) and kept as a record in the session scratchpad as `htl05-vv.e2e-spec.ts` (written `htl05:<line>` below). It is not in this repository because the endpoints it calls are not merged yet.
- Existing specs are cited as `hotels.e2e`, `rooms.e2e` and `room-availability.e2e` (`ra.e2e`), all under `backend/test/`, plus the PR's own `room-edit.e2e`. All of them use the x-dev-user stub, so the VV specs repeat the auth-sensitive rules with real cookies.

## Brief endpoints (§8) vs implementation

| Brief endpoint | Status |
|---|---|
| POST /api/hotels | Present (hotels.controller.ts:27) |
| GET /api/hotels/:id (HTL-02) | Missing: HTL-02 is not started. The vv test at vv:317 confirms the route returns 404. This is a gap in what users can find, not a defect. |
| PATCH /api/hotels/:id | Present (hotels.controller.ts:67) |
| POST /api/hotels/:id/rooms | Present (rooms.controller.ts:26) |
| POST /api/hotels/:id/rooms/:roomId/availability | Present (rooms.controller.ts:69) |
| PATCH /api/hotels/:id/rooms/:roomId (HTL-05) | Only on PR #54 (rooms.controller.ts:122 on the PR branch) |
| PATCH /api/hotels/:id/rooms/:roomId/availability (HTL-05) | Only on PR #54 (rooms.controller.ts:156 on the PR branch) |

GEN-05 (paging): no list endpoints in this track, so it does not apply.

## Traceability matrix

| Rule | Source | Rule text | Endpoint | Code (file:line) | Existing test (spec:line) | VV test | Verdict | Finding |
|---|---|---|---|---|---|---|---|---|
| R-HTL-01-01 | workbook | Only an admin creates a hotel profile: 401 without a session, 403 for a traveller and for hotel and airline moderators, and nothing is created | POST /api/hotels | hotels.controller.ts:28 | hotels.e2e:127 (stub) | vv:129 | PASS | |
| R-HTL-01-02 | workbook | The profile holds name, address, city and country, description, photos, star class and amenities | POST /api/hotels | hotels.service.ts:36-49 | hotels.e2e:36 | vv:147 | PASS | |
| R-HTL-01-03 | derived | The city must be a seeded city (GEN-12), and the country is taken from that city | POST, PATCH /api/hotels | hotels.service.ts:128-138 | hotels.e2e:80, 176, 183 | vv:147, 226 | PASS | |
| R-HTL-01-04 | jira-dod | A `countryCode` in the body is rejected as an unknown field, so it cannot contradict the city | POST, PATCH /api/hotels | validation.pipe.ts:38 | none | vv:174 | PASS | |
| R-HTL-01-05 | workbook | The assigned hotel moderator edits every profile field of their own hotel | PATCH /api/hotels/:id | hotels.service.ts:57-92 | hotels.e2e:151 (stub) | vv:226 | PASS | |
| R-HTL-01-06 | jira-dod | The moderator of another hotel gets 403 and the hotel is unchanged, including `updatedAt` | PATCH /api/hotels/:id | hotels.service.ts:62 | hotels.e2e:209 (stub) | vv:273 | PASS | |
| R-HTL-01-07 | jira-dod | An airline moderator, an admin or a signed-out caller cannot edit a hotel (403/401) | PATCH /api/hotels/:id | hotels.controller.ts:68 | hotels.e2e:209 (stub) | vv:273 | PASS | |
| R-HTL-01-08 | workbook | Photos are uploaded images (GEN-08) | POST, PATCH /api/hotels | hotel.dto.ts:55-68 (URLs only) | none | none | BLOCKED-BY GEN-08 | |
| R-HTL-01-09 | derived | At most 5 photos, each an http(s) URL | POST, PATCH /api/hotels | hotel.dto.ts:58 | hotels.e2e:114, 193 | vv:147, 255 | PASS | |
| R-HTL-01-10 | derived | Star class is a whole number from 1 to 5 (`0`, `6`, `3.5` and `"4"` are rejected) | POST, PATCH /api/hotels | hotel.dto.ts:49-54 | hotels.e2e:88, 193 | vv:255 | PASS | |
| R-HTL-01-11 | jira-dod | Fields sent for mass assignment (`isActive`, `ratingAvg`, `hotelId`) are rejected and nothing changes | PATCH /api/hotels/:id | validation.pipe.ts:38 | none | vv:197 | PASS | |
| R-HTL-01-12 | jira-dod | Invalid DTO input returns 400 VALIDATION_FAILED with fieldErrors | POST, PATCH /api/hotels | hotel.dto.ts:41-76 | hotels.e2e:88, 193 | vv:255 | PASS | |
| R-HTL-01-13 | jira-dod | An unknown city returns 400 VALIDATION_FAILED with a field error on `cityId` (GEN-02) | POST, PATCH /api/hotels | hotels.service.ts:128-136 | hotels.e2e:80 (status only) | vv:300 (regression test) | PASS (fixed in #55) | F-C-01 (fixed) |
| R-HTL-01-14 | derived | A moderator still on the temporary password gets 403 PASSWORD_CHANGE_REQUIRED (ACC-13) | PATCH /api/hotels/:id | (auth guard) | admin-moderators.e2e:83 (airline only) | vv:216 | PASS | |
| R-HTL-01-15 | derived | A deactivated hotel cannot be edited (ACC-15) | PATCH /api/hotels/:id | hotels.service.ts:112-126 | hotels.e2e:236 | none | PASS | |
| R-HTL-01-16 | jira-dod | The Swagger summary starts with HTL-01 and every error the endpoint can return is documented | POST, PATCH /api/hotels | hotels.controller.ts:93; hotels.service.ts:87-91 | openapi-rules | none | PASS (fixed in #55) | F-C-03 (fixed) |
| R-HTL-02-01 | workbook | Hotel details page | GET /api/hotels/:id | none | none | vv:317 (route returns 404) | UNTESTED | (HTL-02 not started) |
| R-HTL-03-01 | workbook | The hotel moderator adds a room with number or name, type, beds, maximum occupancy and price | POST /api/hotels/:id/rooms | rooms.service.ts:29-44 | rooms.e2e:57 | vv:353 | PASS | |
| R-HTL-03-02 | workbook | The room number is unique within the hotel (409) | POST /api/hotels/:id/rooms | room.schema.ts:87-91 | rooms.e2e:78 | vv:326 | PASS | |
| R-HTL-03-03 | workbook | The same number may be used in another hotel | POST /api/hotels/:id/rooms | room.schema.ts:88 | rooms.e2e:95 | vv:326 | PASS | |
| R-HTL-03-04 | derived | Uniqueness ignores case and surrounding spaces | POST /api/hotels/:id/rooms | room.schema.ts:87; room.dto.ts:22-23 | rooms.e2e:83 | vv:326 | PASS | |
| R-HTL-03-05 | derived | Two simultaneous creates with the same number: exactly one room is created | POST /api/hotels/:id/rooms | room.schema.ts:88-91 | rooms.e2e:99 | none | PASS | |
| R-HTL-03-06 | workbook | Maximum occupancy is at least 1 | POST /api/hotels/:id/rooms | room.dto.ts:32-37 | rooms.e2e:110 | vv:353 | PASS | |
| R-HTL-03-07 | workbook | The price per night is greater than 0 | POST /api/hotels/:id/rooms | room.dto.ts:38-42 | rooms.e2e:137 | vv:353 | PASS | |
| R-HTL-03-08 | derived | Beds, occupancy and price are whole numbers; strings are not converted to numbers | POST /api/hotels/:id/rooms | room.dto.ts:26-42 | rooms.e2e:110 | vv:353 | PASS | |
| R-HTL-03-09 | jira-dod | The moderator of Q, an airline moderator and a signed-out caller cannot add rooms to P, and nothing is created | POST /api/hotels/:id/rooms | rooms.service.ts:34 | rooms.e2e:150 (stub) | vv:335 | PASS | |
| R-HTL-03-10 | jira-dod | Fields sent for mass assignment (`hotelId`, `isActive`, `availability`, `everReserved`) are rejected | POST /api/hotels/:id/rooms | validation.pipe.ts:38 | none | vv:379 | PASS | |
| R-HTL-03-11 | jira-dod | An unknown hotel returns 404 and a malformed id returns 400 | POST /api/hotels/:id/rooms | hotels.service.ts:95-105 | rooms.e2e:170 | none | PASS | |
| R-HTL-03-12 | derived | A deactivated hotel cannot get new rooms (ACC-15) | POST /api/hotels/:id/rooms | hotels.service.ts:118-124 | rooms.e2e:180 | none | PASS | |
| R-HTL-04-01 | workbook | The moderator defines bookable date ranges for a room | POST .../rooms/:roomId/availability | rooms.service.ts:50-110 | ra.e2e:71 | vv:430 | PASS | |
| R-HTL-04-02 | workbook | A range that overlaps an existing range is refused with 409 and nothing is added | same | rooms.service.ts:66-77, 105-109 | ra.e2e:93 | vv:430 | PASS | |
| R-HTL-04-03 | workbook | Ranges that overlap inside one request are refused with 400 | same | rooms.service.ts:57-65 | ra.e2e:103 | vv:444 | PASS | |
| R-HTL-04-04 | derived | An identical range is refused: 409 against an existing range, 400 inside one request | same | rooms.service.ts:58, 73 | none | vv:423, 444 | PASS | |
| R-HTL-04-05 | derived | Half-open ranges [from, to) that touch on either side are accepted | same | rooms.service.ts:75 | ra.e2e:82 | vv:430 | PASS | |
| R-HTL-04-06 | derived | A range that has already ended (`to` on or before today, UTC) returns 400 | same | room.dto.ts:142; validators.ts:72-85 | ra.e2e:121 | vv:466 | PASS | |
| R-HTL-04-07 | derived | No unbounded ranges: `to` is required and at most 366 nights after `from` | same | room.dto.ts:139-141 | ra.e2e:109 | vv:466 | PASS | |
| R-HTL-04-08 | derived | A range that started in the past but ends in the future is stored as sent | same | validators.ts:80-85 | none | vv:486 | PASS | SQ-2 |
| R-HTL-04-09 | jira-dod | Another hotel's moderator or an airline moderator cannot add ranges (403), and the room is unchanged | same | rooms.service.ts:56 | ra.e2e:167 (stub) | vv:493 | PASS | |
| R-HTL-04-10 | jira-dod | A room that is not in the hotel in the path, or an unknown room, returns 404 | same | rooms.service.ts:87-97 | ra.e2e:182 | vv:493, 506 | PASS | |
| R-HTL-04-11 | derived | Two simultaneous overlapping requests: exactly one wins | same | rooms.service.ts:66-84 | ra.e2e:155 | none | PASS | |
| R-HTL-04-12 | derived | A room holds at most 200 ranges (409) | same | rooms.service.ts:98-104 | ra.e2e:130 | none | PASS | |
| R-HTL-04-13 | jira-dod | An overlap inside one request returns 400 VALIDATION_FAILED and names the range (GEN-02) | same | rooms.service.ts:58-65 | ra.e2e:103 (status only) | vv:455 (regression test) | PASS (fixed in #55) | F-C-02 (fixed) |
| R-HTL-04-14 | jira-dod | Unknown keys inside a range (for example `kind`) are rejected | same | validation.pipe.ts:38 | none | vv:466 | PASS | |
| R-HTL-04-15 | derived | A deactivated hotel cannot change its room dates (ACC-15) | same | hotels.service.ts:118-124 | ra.e2e:194 | none | PASS | |
| R-HTL-05-01 | workbook | The moderator edits a room's beds, occupancy and price; other fields stay as they were | PATCH .../rooms/:roomId (PR #54) | PR rooms.service.ts:126-155 | room-edit.e2e:97 | htl05:184 | PASS | |
| R-HTL-05-02 | jira-dod | Edits must be whole numbers, occupancy at least 1 and price above 0; strings, `null` and an empty body are rejected | same | PR room.dto.ts (UpdateRoomDto) | room-edit.e2e:129 | htl05:200 | PASS | |
| R-HTL-05-03 | jira-dod | Fields sent for mass assignment (`number`, `type`, `hotelId`, `isActive`, `everReserved`, `availability`) are rejected | same | validation.pipe.ts:38 | room-edit.e2e:129 (partly) | htl05:226 | PASS | |
| R-HTL-05-04 | jira-dod | The moderator of Q gets 403 through P's path and 404 through Q's path; other roles get 403 and signed-out callers 401; the room is unchanged | both PATCH endpoints | PR rooms.service.ts:132, 169 | room-edit.e2e:144, 229 (stub) | htl05:252 | PASS | |
| R-HTL-05-05 | workbook | Price changes do not affect existing reservations | PATCH .../rooms/:roomId | contracts.md (PR) "Room edits" | room-edit.e2e:117 | none | BLOCKED-BY HTL-17 | |
| R-HTL-05-06 | workbook | The moderator edits availability by replacing the room's ranges | PATCH .../availability (PR #54) | PR rooms.service.ts:163-210 | room-edit.e2e:158 | htl05:274 | PASS | |
| R-HTL-05-07 | workbook | Availability cannot be removed for dates with confirmed (BOOKED) reservations: 409, nothing changes, and `to` is exclusive | same | PR rooms.service.ts:187-201, 225-243 | room-edit.e2e:181 | htl05:274, 290 | PASS | |
| R-HTL-05-08 | derived | An unexpired HELD (pending) night also blocks removal | same | PR rooms.service.ts:235 | room-edit.e2e:181 | htl05:298 | PASS | SQ-3 |
| R-HTL-05-09 | derived | Booked nights before today are not protected | same | PR rooms.service.ts:232 | room-edit.e2e:202 | none | PASS | SQ-4 |
| R-HTL-05-10 | workbook | The protection also holds against a booking hold that runs at the same time | same | PR rooms.service.ts:181-204; contracts.md (PR) | none | htl05:391, 404 (pass); htl05:413 (regression test) | PASS (fixed in PR #54) | F-C-51 (fixed) |
| R-HTL-05-11 | workbook | "Today" for a booked night is the hotel's local date, so tonight's booked night is protected | same | PR rooms.service.ts:232; validators.ts:72 | none | htl05:431 (regression test) | PASS (fixed in PR #54) | F-C-52 (fixed) |
| R-HTL-05-12 | jira-dod | HTL-04 range rules and unknown keys apply to the replacement list | same | PR room.dto.ts (ReplaceAvailabilityDto) | room-edit.e2e:215 | htl05:310 | PASS | (F-C-02 also applies) |
| R-HTL-05-13 | derived | Lowering occupancy below an existing reservation's party size | PATCH .../rooms/:roomId | none | none | none | BLOCKED-BY HTL-17 | SQ-5 |
| R-HTL-05-14 | jira-dod | The Swagger summaries start with HTL-05, and 400/404/409 are documented | both PATCH endpoints | PR rooms.controller.ts:146, 188 | openapi-rules | none | PASS | |

## Findings

**F-C-01**: Low, HTL-01 / GEN-02. An unknown city returns no field error.
- Expected (GEN-02): "The system shall show field-level validation messages on all forms". An unknown `cityId` should return 400 VALIDATION_FAILED with `fieldErrors: [{ field: "cityId" }]`. The flights module already does this for unknown airports (flights.service.ts:65-74).
- Actual: the response is 400 `code: "BAD_REQUEST"` with no `fieldErrors`, so the form cannot mark the city field.
- Repro: `POST /api/hotels` with the admin cookie and `{"name":"Nowhere Inn","address":"1 Nowhere Road","cityId":"atlantis"}`. The same happens on `PATCH /api/hotels/:id` with `{"cityId":"atlantis"}`.
- Code: backend/src/modules/hotels/hotels.service.ts:128-136.
- Proof: failing test "an unknown city returns 400 VALIDATION_FAILED with a field error on cityId (GEN-02)" (vv:300).

**F-C-02**: Low, HTL-04 (also HTL-05 on PR #54) / GEN-02. Overlapping ranges in one request return no field error.
- Expected: 400 VALIDATION_FAILED with a field error that names the failing range, e.g. `ranges[1].from`.
- Actual: 400 `BAD_REQUEST` with only a message and no `fieldErrors`.
- Repro: `POST /api/hotels/{P}/rooms/{room}/availability` with `{"ranges":[{"from":"2031-03-01","to":"2031-03-10"},{"from":"2031-03-05","to":"2031-03-12"}]}`. The same body sent to the PR's PATCH .../availability gives the same response.
- Code: backend/src/modules/hotels/rooms.service.ts:57-65 (the PR copies it into replaceAvailability).
- Proof: failing test "an overlap inside one request names the failing range in fieldErrors (GEN-02)" (vv:455).

**F-C-03**: Low, HTL-01 (Swagger, Jira DoD). The 409 from the hotel edit is not documented.
- Expected: every error status the endpoint can return is documented.
- Actual: `PATCH /api/hotels/:id` can return 409 CONFLICT ("The hotel changed while it was being edited"), but the controller documents only 400 and 404 (plus the automatic 401 and 403).
- Code: backend/src/modules/hotels/hotels.controller.ts:93 and hotels.service.ts:87-91.
- Proof: none. The 409 only happens when the edit races a deactivation, so it cannot be triggered deterministically; this finding rests on the code citation.
- Also minor: the "invalid" Swagger example for POST /api/hotels is summarised as "too many photos" but sends only one photo (hotels.controller.ts:50-57).

**F-C-51**: Medium (latent until HTL-18), HTL-05, PR #54. A concurrent hold can leave a held night outside every range (write skew).
- Expected (workbook): "availability cannot be removed for dates with confirmed reservations". This must also hold when a booking hold runs at the same time.
- Actual: `replaceAvailability` reads `room_nights` but writes only the room document (PR rooms.service.ts:181-204). Its safety depends on the HTL-18 hold transaction also writing the room. contracts.md (PR) says the hold "sets `everReserved: true`". Once `everReserved` is already true, a plain `$set` is a no-op on the server, so the two transactions no longer conflict. The replace commits (200), then the hold commits, and the held night is left outside every range.
- Mongoose's `updateOne` only conflicts by accident, because its timestamps also change `updatedAt` (htl05:404). The first reservation (false to true) conflicts correctly and gets 409 (htl05:391).
- Repro (test): open a transaction, read the room, insert a HELD night for 2030-01-26 and run `rooms.collection.updateOne({_id},{$set:{everReserved:true}},{session})`. Then send `PATCH /api/hotels/{P}/rooms/{room}/availability` with `{"ranges":[{"from":"2030-03-01","to":"2030-03-05"}]}`: the response is 200. Commit the hold: it succeeds, and 2030-01-26 is held but no range covers it.
- Fix: the contract should require a write that always changes the room (e.g. `$inc` a version field), or the replace should write something the hold must read or write.
- Proof: failing test "later reservations (everReserved already true, plain $set): the held night must not end up outside every range" (htl05:413).

**F-C-52**: Low, HTL-05, PR #54. "Today" is the UTC date, not the hotel's local date.
- Expected: tonight's BOOKED night is protected in the hotel's own time zone. `room_nights.date` is documented as "the hotel's local calendar date" (room-night.schema.ts).
- Actual: the filter uses `date >= todayUtc(now)` (PR rooms.service.ts:232; validators.ts:72). For a hotel west of UTC in the evening, the UTC date is already tomorrow, so tonight's booked night is not checked and the moderator can remove it.
- Example: a New York hotel at 21:00 local (2030-01-11T02:00Z) with a BOOKED night on 2030-01-10. The filter does not select that night.
- The same UTC rule is in IsAfterToday (HTL-04). Hotels and cities have no time zone today; airports do (new_york is America/New_York).
- Proof: failing test "a New York hotel at 21:00 local (02:00 UTC next day): tonight's BOOKED night is still protected" (htl05:431). It calls the exported `nightsOutside` with a fixed `now`.

## PR #54 merge notes

- `git diff develop...origin/feature/HTL-05-edit-room --stat`: 9 files changed, 750 insertions and 9 deletions (rooms service, controller and DTO; unit and e2e specs; contracts.md; traceability.md; AI_PROMPTS.txt).
- Merging into develop @ fc610e0 gives one conflict, in `AI_PROMPTS.txt`, where both sides append entries at the same place. Keeping both entries resolves it; no code conflicts.
- In the merged worktree, the PR's own tests and four existing hotel e2e specs pass (44 e2e), 118 hotel unit tests pass, and `tsc` and eslint are clean.

## Spec questions

- **SQ-1** (HTL-02): GET /api/hotels/:id does not exist, so a moderator cannot read the profile back except from the PATCH response.
- **SQ-2** (HTL-04): a range whose `from` is in the past is stored as sent, so past nights are listed as "bookable". Should the start be trimmed to today, or should the request be rejected?
- **SQ-3** (HTL-05): HELD (pending payment) nights block removal of availability. The workbook protects only "confirmed reservations", so the PR is stricter. Is that intended? (It is reasonable, and the hold expires after 10 minutes.)
- **SQ-4** (HTL-05): booked nights in the past are not protected, but the workbook sentence has no "future" qualifier.
- **SQ-5** (HTL-05): may beds or occupancy be lowered below the party size of an existing reservation? The workbook protects only the price.
- **SQ-6** (HTL-04, HTL-05): what is the hotel's time zone for "today"? The city, or the city's airport time zone, would need to be stored (see F-C-52).
