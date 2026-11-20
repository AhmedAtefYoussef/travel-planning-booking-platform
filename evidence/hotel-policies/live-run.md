# HTL-09 / HTL-10 / PAY-02 live Swagger run (feature/HTL-10-hotel-policies)

- **Date:** 2026-11-17
- **Run by:** Claude Code for Ahmed
- **Branch:** `feature/HTL-10-hotel-policies`
- **Setup:**
  - The API was built from that branch (`node dist/main`, port 3100).
  - The database was a throw-away in-memory MongoDB replica set (`mongodb-memory-server`, one node, wiredTiger), never Atlas.
  - The run used `NODE_ENV=development` and `AUTH_STUB=false`, so login was real, with httpOnly cookie sessions.
  - `npm run seed` and then `npm run seed:demo` created the data, using test-only passwords generated for this run.
- **Client:** Swagger UI at `http://localhost:3100/api/docs`. Every call used "Try it out", then "Execute".

| # | Actor | Call | Body | Expected | Actual |
|---|---|---|---|---|---|
| 1 | Hotel moderator | `POST /api/auth/login` | demo.hotel@example.com | 200, session cookies | 200, role HOTEL_MODERATOR, assignedProvider = Demo Nile Hotel |
| 2 | Hotel moderator | `PUT /api/hotels/{demo hotel}/policies` | Swagger example `valid`: 14:00 / 12:00, tiers [7 d → 100 %, 2 d → 50 %] | 200; tiers returned sorted (HTL-09, HTL-10) | 200; `cancellationTiers` = [2 d → 50, 7 d → 100]; times 14:00 / 12:00 |
| 3 | Hotel moderator | same | example `duplicateThreshold`: two tiers with daysBefore 3 | 400 VALIDATION_FAILED, field `cancellationTiers[1].daysBefore` | 400; fieldErrors = [`cancellationTiers[1].daysBefore`: "daysBefore 3 is duplicated"] |
| 4 | Hotel moderator | same | example `invalidTimes`: "2pm" / "24:00" | 400, one error per time (GEN-02) | 400; fieldErrors on `checkInTime` and `checkOutTime` |
| 5 | Hotel moderator | same | edited body (BVA): daysBefore -1; refund 100.01; refund 33.333 | 400 naming each tier | 400; `cancellationTiers[0].daysBefore` (< 0), `[1].refundPercent` (> 100), `[2].refundPercent` (more than 2 decimals) |
| 6 | Hotel moderator | `PUT /api/hotels/{another hotel id}/policies` | valid body | 403 (ACC-11) | 403 FORBIDDEN "You can only manage your assigned hotel" |
| 7 | Hotel moderator | `POST /api/auth/logout` | | 204 | 204 |
| 8 | Traveller | `POST /api/auth/login` | demo.traveller@example.com | 200 | 200, role USER |
| 9 | Traveller | `POST /api/hotel-bookings` | room 101, 2028-03-10 → 2028-03-12, 2 adults | 201 PENDING_PAYMENT | 201 PENDING_PAYMENT, 2 nights |
| 10 | Traveller | `GET /api/bookings/hotel/{reservation}/policies` | | 200; the hotel terms equal exactly what step 2 set (PAY-02) | 200; `hotel.cancellationTiers` = [2 d → 50, 7 d → 100]; checkInTime 14:00; checkOutTime 12:00; accepted false |

**Consistency check:** step 10 shows exactly the values set in step 2. This also proves that the refused requests in steps 3 to 6 changed nothing.

**Automated checks on the same commit:**
- `npm run verify` is green: 1000 unit tests and 810 e2e tests, the OpenAPI contract (67 operations) and the dependency rules.
- `hotel-policies.e2e-spec.ts` and `booking-policies.e2e-spec.ts` were run 3 more times, passing 23/23 each time.
