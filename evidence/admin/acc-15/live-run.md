# ACC-15 / ACC-16 live Swagger run: suspensions and provider deactivation

**When:** 17 Nov 2026, 19:59:54 to 19:59:57 UTC.

**Environment:**
- Code: branch `feature/ACC-15-admin-suspensions` at `3400423` (fresh `npm run build`, then `node dist/main` on `localhost:3107`).
- Database: a throw-away `MongoMemoryReplSet` (single node, wiredTiger) on `127.0.0.1`, created for this run and destroyed after it. Atlas was never used, and the worktree has no `backend/.env`.
- `NODE_ENV=development`, `AUTH_STUB=false`: every call uses the real httpOnly cookie session from `POST /api/auth/login`. No `x-dev-user` header was sent.
- Data: `npm run seed` (reference data and the admin), then `npm run seed:demo` (Demo Air with DM101/DM102, Demo Nile Hotel with rooms 101/102, the two demo moderators and the demo traveller). The admin and demo passwords were random values generated for this run only.
- Stripe and the FX service had placeholder keys, so no payment was taken.

**Method:**
- A recorder sent each request to the running API with the cookies the API set, as Swagger "Try it out" does, and kept the request, the status and a digest of the body. Passwords are never recorded.
- Swagger UI at `/api/docs` was opened in a browser to check that the four routes render under "Admin: accounts" and "Admin: providers" with their ACC-15/ACC-16 summaries.
- Some steps use the throw-away database directly and are marked `mongo` in the transcript. Two are fixture writes; the others are reads:
  - marking the traveller's flight hold and hotel hold CONFIRMED, because Stripe is not configured in this run;
  - inserting a second admin account, because admins are only created by the seed;
  - reading statuses back where no endpoint shows them (the hotel reservation, the traveller after the refused calls).

## Verdicts

| Journey | Requirements | Result | Evidence (rows below) |
|---|---|---|---|
| S Swagger contract | ACC-15, ACC-16 | **PASS**. All four PATCH routes are in the document, summaries start with ACC-15/ACC-16, 400/401/403/404/409 documented. | 1–1 |
| J1 suspend a registered user | ACC-16, GEN-07 | **PASS**. Both devices and the refresh token stop at once (401); the right password gives 403 ACCOUNT_SUSPENDED; the Confirmed flight booking and hotel reservation stay CONFIRMED; a repeat is 409. | 16–23 |
| J2 reactivate a registered user | ACC-16, GEN-01 | **PASS**. Login works again; both ACCOUNT_SUSPENDED and ACCOUNT_REACTIVATED are in the inbox; reactivating an active account is 409. | 24–27 |
| J3 suspend and reactivate a moderator | ACC-15, GEN-07 | **PASS**. The moderator session ends at once; login gives 403 ACCOUNT_SUSPENDED until reactivation, then 200. | 28–32 |
| J4 deactivate and reactivate an airline | ACC-15, GEN-01 | **PASS**. DM101 disappears from search and a hold gets 409 PROVIDER_INACTIVE; the Confirmed booking stays CONFIRMED; the moderator gets PROVIDER_DEACTIVATED then PROVIDER_REACTIVATED; reactivation restores search and holds. | 33–44 |
| J5 deactivate and reactivate a hotel | ACC-15, GEN-01 | **PASS**. A hold gets 409 PROVIDER_INACTIVE while the hotel is inactive; the Confirmed reservation stays CONFIRMED; the moderator is notified; reactivation restores holds. | 45–50 |
| E negative and authorization | ACC-15, ACC-16, ACC-11, GEN-02 | **PASS**. Self and other admin 403; self-deactivated 409; malformed id, bad type, long reason and unknown field 400 on the exact field; unknown ids 404; no session 401; traveller and moderators 403; nothing changed. | 51–74 |
| A audit trail | GEN-07 | **PASS**. Exactly one entry per successful action (2 suspensions, 2 reactivations, 2 deactivations, 2 provider reactivations), none for the refused calls, each with the admin as actor and the reason given. | 75–79 |

**Totals:** 79 recorded steps; 0 returned a status other than the one expected.

**Finding in the live run (fixed):**
- **LR-1, message typo (Low, ACC-16).** The first run, at `a9ee729` with 79 steps and every status as expected, showed the 409 for a self-deactivated account as "...and cannot be suspendd". This was fixed in `3400423`, and the unit test now checks the exact text. The transcript below is the re-run at `3400423` on a new throw-away database (row 58 shows the corrected message).

**Notes:**
- **Login status for a suspended account.** The brief asked for 401 ACCOUNT_SUSPENDED. The auth module (ACC-04, merged) answers **403** ACCOUNT_SUSPENDED for the right password, and its Swagger text documents that. This PR keeps that contract. An open cookie or refresh token of a suspended account gets **401**, because the suspension revokes the session.
- **Hotel search.** There is no hotel search endpoint yet (HTL-11). For hotels, ACC-15 is shown through the 409 PROVIDER_INACTIVE on a new hold. When HTL-11 is built, it must apply `ACTIVE_PROVIDER_FILTER`.
- **Reactivation and sessions.** Only a suspension revokes sessions. A suspended account cannot hold one (login, refresh and the guard all refuse it), so reactivation has none to revoke.

## Transcript

Ids are shortened to their last 6 hex characters. "Expect" is the status the recorder required.

| # | UTC | Step | Caller | Request | Status | Expect | Response digest |
|---|---|---|---|---|---|---|---|
| 1 | 19:59:54 | SWAGGER docs-json lists the new routes | anonymous | `GET /api/docs-json` | 200 | 200 | accounts/{id}/suspend: ACC-16; accounts/{id}/reactivate: ACC-16; providers/{type}/{id}/deactivate: ACC-15; providers/{type}/{id}/reactivate: ACC-15 |
| 2 | 19:59:54 | AUTH admin | admin | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=ADMIN |
| 3 | 19:59:54 | AUTH traveller device 1 | traveller | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=USER |
| 4 | 19:59:54 | AUTH traveller device 2 | traveller (2nd device) | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=USER |
| 5 | 19:59:54 | AUTH airline moderator | demo.airline | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=AIRLINE_MODERATOR |
| 6 | 19:59:55 | AUTH hotel moderator | demo.hotel | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=HOTEL_MODERATOR |
| 7 | 19:59:55 | AUTH admin session | admin | `GET /api/auth/me` | 200 | 200 | role=ADMIN |
| 8 | 19:59:55 | FIX airline id | demo.airline | `GET /api/auth/me` | 200 | 200 | provider …3a3e45 |
| 9 | 19:59:55 | FIX hotel id | demo.hotel | `GET /api/auth/me` | 200 | 200 | provider …3a3e71 |
| 10 | 19:59:55 | FIX hotel moderator id | demo.hotel | `GET /api/auth/me` | 200 | 200 |  |
| 11 | 19:59:55 | FIX traveller id | traveller | `GET /api/auth/me` | 200 | 200 |  |
| 12 | 19:59:55 | FIX search CAI-LHR 15 Mar 2028 | traveller | `GET /api/flights/search?from=CAI&to=LHR&departureDate=2028-03-15&passengers=1` | 200 | 200 | flights=[DM101] |
| 13 | 19:59:55 | FIX traveller holds DM101 | traveller | `POST /api/flight-bookings/hold {"outbound":{"flightId":"…3a3e53","cabinId":"…3a3e59"},"` | 201 | 201 | status=PENDING_PAYMENT |
| 14 | 19:59:55 | FIX traveller holds room 101 | traveller | `POST /api/hotel-bookings {"hotelId":"…3a3e71","checkIn":"2028-03-10","checkOut":"2028-03-12","room` | 201 | 201 | status=PENDING_PAYMENT |
| 15 | 19:59:55 | FIX DB: mark both holds CONFIRMED (Stripe is not configured on the throw-away run) | mongo | `updateOne flight_bookings, hotel_reservations` | - | - | modified=1+1 |
| 16 | 19:59:55 | J1 admin suspends the traveller | admin | `PATCH /api/admin/accounts/…3a3e87/suspend {"reason":"Abusive comments on the blog"}` | 200 | 200 | status=SUSPENDED role=USER |
| 17 | 19:59:55 | J1 device 1 cookie after suspension | traveller | `GET /api/auth/me` | 401 | 401 | code=UNAUTHENTICATED |
| 18 | 19:59:55 | J1 device 2 cookie after suspension | traveller (2nd device) | `GET /api/auth/me` | 401 | 401 | code=UNAUTHENTICATED |
| 19 | 19:59:55 | J1 device 1 refresh after suspension | traveller | `POST /api/auth/refresh` | 401 | 401 | code=UNAUTHENTICATED |
| 20 | 19:59:55 | J1 traveller logs in with the right password | traveller | `POST /api/auth/login (credentials redacted)` | 403 | 403 | code=ACCOUNT_SUSPENDED |
| 21 | 19:59:55 | J1 admin reads the flight booking | admin | `GET /api/flight-bookings/…d6792c` | 200 | 200 | status=CONFIRMED |
| 22 | 19:59:55 | J1 DB: hotel reservation status | mongo | `findOne hotel_reservations` | - | - | status=CONFIRMED |
| 23 | 19:59:55 | J1 suspend again | admin | `PATCH /api/admin/accounts/…3a3e87/suspend {}` | 409 | 409 | code=CONFLICT |
| 24 | 19:59:55 | J2 admin reactivates the traveller | admin | `PATCH /api/admin/accounts/…3a3e87/reactivate {}` | 200 | 200 | status=ACTIVE |
| 25 | 19:59:55 | J2 traveller logs in again | traveller | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=USER |
| 26 | 19:59:55 | J2 traveller notifications | traveller | `GET /api/notifications` | 200 | 200 | ACCOUNT_REACTIVATED,ACCOUNT_SUSPENDED |
| 27 | 19:59:55 | J2 reactivate again | admin | `PATCH /api/admin/accounts/…3a3e87/reactivate {}` | 409 | 409 | code=CONFLICT |
| 28 | 19:59:55 | J3 admin suspends the hotel moderator | admin | `PATCH /api/admin/accounts/…3a3e75/suspend {"reason":"Posted wrong prices"}` | 200 | 200 | status=SUSPENDED role=HOTEL_MODERATOR |
| 29 | 19:59:55 | J3 moderator cookie after suspension | demo.hotel | `GET /api/auth/me` | 401 | 401 | code=UNAUTHENTICATED |
| 30 | 19:59:55 | J3 moderator logs in | demo.hotel | `POST /api/auth/login (credentials redacted)` | 403 | 403 | code=ACCOUNT_SUSPENDED |
| 31 | 19:59:55 | J3 admin reactivates the moderator | admin | `PATCH /api/admin/accounts/…3a3e75/reactivate {}` | 200 | 200 | status=ACTIVE |
| 32 | 19:59:56 | J3 moderator logs in again | demo.hotel | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=HOTEL_MODERATOR |
| 33 | 19:59:56 | J4 register traveller B | traveller B | `POST /api/auth/register (credentials redacted)` | 201 | 201 | status=ACTIVE |
| 34 | 19:59:56 | J4 traveller B logs in | traveller B | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=USER |
| 35 | 19:59:56 | J4 admin deactivates Demo Air | admin | `PATCH /api/admin/providers/airline/…3a3e45/deactivate {"reason":"Licence expired"}` | 200 | 200 | type=AIRLINE isActive=false |
| 36 | 19:59:56 | J4 search after deactivation | traveller B | `GET /api/flights/search?from=CAI&to=LHR&departureDate=2028-03-15&passengers=1` | 200 | 200 | flights=[] |
| 37 | 19:59:56 | J4 traveller B holds DM101 | traveller B | `POST /api/flight-bookings/hold {"outbound":{"flightId":"…3a3e53","cabinId":"…3a3e59"},"` | 409 | 409 | code=PROVIDER_INACTIVE |
| 38 | 19:59:56 | J4 admin reads the confirmed booking | admin | `GET /api/flight-bookings/…d6792c` | 200 | 200 | status=CONFIRMED |
| 39 | 19:59:56 | J4 airline moderator notifications | demo.airline | `GET /api/notifications` | 200 | 200 | PROVIDER_DEACTIVATED: Your airline has been deactivated |
| 40 | 19:59:56 | J4 deactivate again | admin | `PATCH /api/admin/providers/airline/…3a3e45/deactivate {}` | 409 | 409 | code=CONFLICT |
| 41 | 19:59:56 | J4 admin reactivates Demo Air | admin | `PATCH /api/admin/providers/airline/…3a3e45/reactivate {}` | 200 | 200 | isActive=true |
| 42 | 19:59:56 | J4 search after reactivation | traveller B | `GET /api/flights/search?from=CAI&to=LHR&departureDate=2028-03-15&passengers=1` | 200 | 200 | flights=[DM101] |
| 43 | 19:59:56 | J4 traveller B holds DM101 again | traveller B | `POST /api/flight-bookings/hold {"outbound":{"flightId":"…3a3e53","cabinId":"…3a3e59"},"` | 201 | 201 | status=PENDING_PAYMENT |
| 44 | 19:59:56 | J4 airline moderator notifications | demo.airline | `GET /api/notifications` | 200 | 200 | PROVIDER_REACTIVATED |
| 45 | 19:59:56 | J5 admin deactivates Demo Nile Hotel | admin | `PATCH /api/admin/providers/hotel/…3a3e71/deactivate {"reason":"Health inspection"}` | 200 | 200 | type=HOTEL isActive=false |
| 46 | 19:59:56 | J5 traveller B holds room 102 | traveller B | `POST /api/hotel-bookings {"hotelId":"…3a3e71","checkIn":"2028-03-20","checkOut":"2028-03-22","room` | 409 | 409 | code=PROVIDER_INACTIVE |
| 47 | 19:59:56 | J5 DB: confirmed reservation status | mongo | `findOne hotel_reservations` | - | - | status=CONFIRMED |
| 48 | 19:59:56 | J5 hotel moderator notifications | demo.hotel | `GET /api/notifications` | 200 | 200 | PROVIDER_DEACTIVATED |
| 49 | 19:59:56 | J5 admin reactivates the hotel | admin | `PATCH /api/admin/providers/hotel/…3a3e71/reactivate {}` | 200 | 200 | isActive=true |
| 50 | 19:59:56 | J5 traveller B holds room 102 again | traveller B | `POST /api/hotel-bookings {"hotelId":"…3a3e71","checkIn":"2028-03-20","checkOut":"2028-03-22","room` | 201 | 201 | status=PENDING_PAYMENT |
| 51 | 19:59:56 | FIX DB: a second admin account (admins are only seeded) | mongo | `insertOne users` | - | - | id=…9e6ab6 |
| 52 | 19:59:56 | E register traveller C | traveller C | `POST /api/auth/register (credentials redacted)` | 201 | 201 |  |
| 53 | 19:59:57 | E traveller C logs in | traveller C | `POST /api/auth/login (credentials redacted)` | 200 | 200 | role=USER |
| 54 | 19:59:57 | E traveller C id | traveller C | `GET /api/auth/me` | 200 | 200 |  |
| 55 | 19:59:57 | E traveller C deactivates own account (ACC-12) | traveller C | `DELETE /api/users/me (credentials redacted)` | 204 | 204 |  |
| 56 | 19:59:57 | E suspend yourself | admin | `PATCH /api/admin/accounts/…29ca06/suspend {}` | 403 | 403 | code=FORBIDDEN "You cannot suspend your own account" |
| 57 | 19:59:57 | E suspend another admin | admin | `PATCH /api/admin/accounts/…9e6ab6/suspend {}` | 403 | 403 | code=FORBIDDEN |
| 58 | 19:59:57 | E suspend a self-deactivated account | admin | `PATCH /api/admin/accounts/…d679ee/suspend {}` | 409 | 409 | code=CONFLICT "This account was deactivated by its owner (ACC-12) and cannot be suspended" |
| 59 | 19:59:57 | E malformed account id | admin | `PATCH /api/admin/accounts/not-an-id/suspend {}` | 400 | 400 | code=INVALID_ID field=id |
| 60 | 19:59:57 | E unknown account id | admin | `PATCH /api/admin/accounts/…9e6ab7/suspend {}` | 404 | 404 | code=NOT_FOUND |
| 61 | 19:59:57 | E reason over 500 characters | admin | `PATCH /api/admin/accounts/…3a3e87/suspend {"reason":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | 400 | 400 | code=VALIDATION_FAILED field=reason |
| 62 | 19:59:57 | E unknown body field | admin | `PATCH /api/admin/accounts/…3a3e87/suspend {"status":"ACTIVE"}` | 400 | 400 | code=VALIDATION_FAILED field=status |
| 63 | 19:59:57 | E no session | anonymous | `PATCH /api/admin/accounts/…3a3e87/suspend {}` | 401 | 401 | code=UNAUTHENTICATED |
| 64 | 19:59:57 | E traveller tries to suspend | traveller B | `PATCH /api/admin/accounts/…3a3e87/suspend {}` | 403 | 403 | code=FORBIDDEN |
| 65 | 19:59:57 | E moderator tries to suspend | demo.airline | `PATCH /api/admin/accounts/…3a3e87/suspend {}` | 403 | 403 | code=FORBIDDEN |
| 66 | 19:59:57 | E provider type train | admin | `PATCH /api/admin/providers/train/…3a3e45/deactivate {}` | 400 | 400 | code=VALIDATION_FAILED field=type |
| 67 | 19:59:57 | E malformed provider id | admin | `PATCH /api/admin/providers/hotel/nope/deactivate {}` | 400 | 400 | code=INVALID_ID field=id |
| 68 | 19:59:57 | E unknown airline id | admin | `PATCH /api/admin/providers/airline/…9e6ab8/deactivate {}` | 404 | 404 | code=NOT_FOUND |
| 69 | 19:59:57 | E hotel id under airline | admin | `PATCH /api/admin/providers/airline/…3a3e71/deactivate {}` | 404 | 404 | code=NOT_FOUND |
| 70 | 19:59:57 | E reactivate an active hotel | admin | `PATCH /api/admin/providers/hotel/…3a3e71/reactivate {}` | 409 | 409 | code=CONFLICT |
| 71 | 19:59:57 | E provider: no session | anonymous | `PATCH /api/admin/providers/hotel/…3a3e71/deactivate {}` | 401 | 401 | code=UNAUTHENTICATED |
| 72 | 19:59:57 | E provider: traveller | traveller B | `PATCH /api/admin/providers/hotel/…3a3e71/deactivate {}` | 403 | 403 | code=FORBIDDEN |
| 73 | 19:59:57 | E provider: its own moderator | demo.hotel | `PATCH /api/admin/providers/hotel/…3a3e71/deactivate {}` | 403 | 403 | code=FORBIDDEN |
| 74 | 19:59:57 | E DB: the traveller is still ACTIVE after the refused calls | mongo | `findOne users` | - | - | status=ACTIVE |
| 75 | 19:59:57 | A audit log SUSPEND_ACCOUNT | admin | `GET /api/admin/audit-logs?action=SUSPEND_ACCOUNT` | 200 | 200 | total=2: USER …3a3e75 "Posted wrong prices"; USER …3a3e87 "Abusive comments on the blog" |
| 76 | 19:59:57 | A audit log REACTIVATE_ACCOUNT | admin | `GET /api/admin/audit-logs?action=REACTIVATE_ACCOUNT` | 200 | 200 | total=2: USER …3a3e75; USER …3a3e87 |
| 77 | 19:59:57 | A audit log DEACTIVATE_PROVIDER | admin | `GET /api/admin/audit-logs?action=DEACTIVATE_PROVIDER` | 200 | 200 | total=2: HOTEL …3a3e71 "Health inspection"; AIRLINE …3a3e45 "Licence expired" |
| 78 | 19:59:57 | A audit log REACTIVATE_PROVIDER | admin | `GET /api/admin/audit-logs?action=REACTIVATE_PROVIDER` | 200 | 200 | total=2: HOTEL …3a3e71; AIRLINE …3a3e45 |
| 79 | 19:59:57 | A audit log as a traveller | traveller B | `GET /api/admin/audit-logs` | 403 | 403 | code=FORBIDDEN |
