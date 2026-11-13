# V&V M1: Track A (Accounts/Auth) requirements traceability matrix

Scope: ACC-01, ACC-04, ACC-05, ACC-06, ACC-07a, ACC-08, ACC-09, ACC-11, ACC-12 (Partial), ACC-13, ACC-14, ACC-18, ACC-19.
Branch `test/vv-m1-acceptance` (develop @ fc610e0). Paths: code under `backend/src/`, tests under `backend/test/`.
`vv:NNN` means `backend/test/vv/accounts.vv.e2e-spec.ts:NNN`.

Run: `npx jest --config ./test/jest-e2e.json --runInBand test/vv/accounts.vv.e2e-spec.ts` gives `Tests: 29 passed, 29 total` (27 passing checks + 2 `it.failing` defect proofs).

## Brief §8 endpoint check

All Auth and Admin endpoints of brief §8 exist with the listed paths and verbs: POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout, POST /api/admin/users/:id/reset-password, PATCH /api/auth/change-password, GET /api/auth/me, GET|PATCH|DELETE /api/users/me, POST /api/admin/moderators, GET /api/admin/accounts. Nothing is missing or renamed. There is one extra endpoint: POST /api/auth/refresh (ACC-06 rotation, modules/auth/auth.controller.ts:165).

## Matrix

| Rule | Source | Rule text | Endpoint | Code (file:line) | Existing test (spec:line) | VV test | Verdict | Finding |
|---|---|---|---|---|---|---|---|---|
| R-ACC-01-01 | workbook | A guest registers with name, unique email, password and consent and becomes an active USER | POST /api/auth/register | modules/auth/auth.controller.ts:65, modules/users/users.service.ts:40 | auth-register.e2e-spec.ts:38 | - | PASS | |
| R-ACC-01-02 | workbook | The password has at least 8 characters: 7 is rejected and exactly 8 is accepted | POST /api/auth/register | modules/users/dto/new-password.rules.ts:28, modules/users/password-rules.ts:6 | auth-register.e2e-spec.ts:93; unit auth/dto/register.dto.spec.ts:38 | vv:78 | PASS | |
| R-ACC-01-03 | workbook | The password has at least one letter and one digit: letters-only and digits-only are rejected | POST /api/auth/register | modules/users/password-rules.ts:7 | auth-register.e2e-spec.ts:93 | - | PASS | |
| R-ACC-01-04 | workbook | An invalid email is rejected with an inline error | POST /api/auth/register | modules/auth/dto/register.dto.ts:38 | auth-register.e2e-spec.ts:111 | - | PASS | |
| R-ACC-01-05 | workbook | Registration fails without consent (missing, false or "true") | POST /api/auth/register | modules/auth/dto/register.dto.ts:49 | auth-register.e2e-spec.ts:119 | - | PASS | |
| R-ACC-01-06 | workbook | An already registered email is rejected in any letter case (409 with an `email` field error) | POST /api/auth/register | modules/users/users.service.ts:50, modules/users/schemas/user.schema.ts (lowercase unique) | auth-register.e2e-spec.ts:68 | - | PASS | |
| R-ACC-01-07 | derived | Two parallel registrations of one email (same case or different case) give exactly one 201, one 409 and one document | POST /api/auth/register | modules/users/users.service.ts:40-59 | auth-register.e2e-spec.ts:83 | vv:89 | PASS | |
| R-ACC-01-08 | jira-dod | Invalid input returns 400 VALIDATION_FAILED with a fieldError for each broken rule | POST /api/auth/register | common validation pipe | auth-register.e2e-spec.ts:132 | - | PASS | |
| R-ACC-01-09 | jira-dod | GEN-13: `role`, `status`, `mustChangePassword`, `assignedProvider` and `termsAcceptedAt` in the body are rejected and nothing is saved | POST /api/auth/register | forbidNonWhitelisted | auth-register.e2e-spec.ts:142, :155 | vv:108 | PASS | |
| R-ACC-01-10 | derived | Password at most 72 bytes (bcrypt), name at most 100, email at most 254 | POST /api/auth/register | modules/users/dto/new-password.rules.ts:30, modules/auth/dto/register.dto.ts | unit auth/dto/register.dto.spec.ts:27, :57 | - | PASS | Q3 |
| R-ACC-01-11 | derived | The password is stored only as a bcrypt hash and is never returned | POST /api/auth/register | modules/auth/auth.service.ts:98 | auth-register.e2e-spec.ts:38 | - | PASS | |
| R-ACC-04-01 | workbook | A user, an admin or a moderator logs in with email and password | POST /api/auth/login | modules/auth/auth.service.ts:112 | auth-login.e2e-spec.ts:67, :168 | - | PASS | |
| R-ACC-04-02 | workbook | Each role lands on its own home page (`homePath` /, /admin, /moderator/airline, /moderator/hotel) | POST /api/auth/login | modules/auth/auth.service.ts:261, modules/auth/home-paths.ts | auth-login.e2e-spec.ts:67, :168; admin-moderators.e2e-spec.ts:53 | - | PASS | |
| R-ACC-04-03 | workbook | Any failure gives the generic "Invalid email or password". Unknown email, wrong password and a deactivated account (either password) produce identical bodies | POST /api/auth/login | modules/auth/auth.service.ts:117, :144, :152 | auth-login.e2e-spec.ts:125, :157 | vv:133 | PASS | |
| R-ACC-04-04 | workbook | A suspended account sees "account suspended" (403) with the right password and the generic 401 with a wrong one | POST /api/auth/login | modules/auth/auth.service.ts:154 | auth-login.e2e-spec.ts:139 | - | PASS | Q2 |
| R-ACC-04-05 | derived | An account with `mustChangePassword`: right password gives 200 and lands on /account/change-password; wrong password gives the generic 401 | POST /api/auth/login | modules/auth/auth.service.ts:259-261 | admin-reset-password.e2e-spec.ts:50 | vv:159 | PASS | |
| R-ACC-04-06 | derived | A malformed email is just a failed login (generic 401), never a 400 format hint | POST /api/auth/login | modules/auth/dto/login.dto.ts:10-20 | - | vv:171 | PASS | |
| R-ACC-04-07 | jira-dod | Missing fields give 400 with fieldErrors; unknown fields (`role`) give 400 | POST /api/auth/login | modules/auth/dto/login.dto.ts | auth-login.e2e-spec.ts:194 | vv:179 | PASS | |
| R-ACC-04-08 | derived | The email is accepted in any letter case | POST /api/auth/login | modules/users/users.service.ts:63 | auth-login.e2e-spec.ts:120 | - | PASS | |
| R-ACC-05-01 | workbook | 4 consecutive failures do not lock (still the generic 401) | POST /api/auth/login | modules/auth/auth.service.ts:121-145 | auth-lockout.e2e-spec.ts:42 | - | PASS | |
| R-ACC-05-02 | workbook | The 5th consecutive failure locks the account for 15 minutes and shows a lockout message | POST /api/auth/login | modules/users/users.service.ts:124, modules/auth/lockout.ts | auth-lockout.e2e-spec.ts:53 | - | PASS | |
| R-ACC-05-03 | workbook | During the lock even the right password is refused, still at 14 minutes ("try again in 1 minute") | POST /api/auth/login | modules/users/users.service.ts:86 | auth-lockout.e2e-spec.ts:73 | vv:195 | PASS | |
| R-ACC-05-04 | workbook | The lock ends after 15 minutes (lockedUntil back-dated) | POST /api/auth/login | modules/users/users.service.ts:166 | auth-lockout.e2e-spec.ts:84 | - | PASS | |
| R-ACC-05-05 | workbook | A successful login resets the counter | POST /api/auth/login | modules/users/users.service.ts:158 | auth-lockout.e2e-spec.ts:99 | - | PASS | |
| R-ACC-05-06 | derived | After a lock expires, counting starts again: 4 failures give 401 and the 5th locks again | POST /api/auth/login | modules/users/users.service.ts:138 | - | vv:208 | PASS | |
| R-ACC-05-07 | derived | Parallel bursts lock once, at most 5 passwords are checked, and extra simultaneous attempts get 429 | POST /api/auth/login | modules/users/users.service.ts:86-117, modules/auth/auth.service.ts:126-131 | auth-lockout.e2e-spec.ts:110, :142, :165, :186, :201 | - | PASS | Q1 |
| R-ACC-05-08 | derived | Unknown emails are never counted or locked | POST /api/auth/login | modules/auth/auth.service.ts:115-117 | auth-lockout.e2e-spec.ts:132 | - | PASS | |
| R-ACC-05-09 | workbook | ACC-04 "generic message" and ACC-12 "cannot log in": a deactivated account must answer like an unknown email and never reveal itself with ACCOUNT_LOCKED | POST /api/auth/login | modules/auth/auth.service.ts:121-145 (gate and lock run before the status check at :151) | - | vv:226 (it.failing) | FAIL | F-A-01 |
| R-ACC-05-10 | derived | A lock does not end sessions that are already open | any protected route | common/auth/auth.guard.ts:36-37 | auth-guards.e2e-spec.ts:192 | - | PASS | |
| R-ACC-05-11 | jira-dod | Swagger documents every error status the endpoint returns | POST /api/auth/login | modules/auth/auth.controller.ts:130, :155 | - | - | PARTIAL | F-A-03 |
| R-ACC-06-01 | workbook | Logout clears both auth cookies (same path, expired, HttpOnly) | POST /api/auth/logout | modules/auth/auth.controller.ts:200-221, :245-254 | auth-session.e2e-spec.ts:81 | - | PASS | |
| R-ACC-06-02 | workbook | Logout revokes the refresh token on the server (revokedAt set); the old refresh and access cookies are rejected | POST /api/auth/logout | modules/users/sessions.service.ts:150 | auth-session.e2e-spec.ts:81, :108, :117 | - | PASS | |
| R-ACC-06-03 | derived | Logout is idempotent, works without cookies, and ends only that session | POST /api/auth/logout | modules/auth/auth.service.ts:219 | auth-session.e2e-spec.ts:126, :139 | - | PASS | |
| R-ACC-06-04 | workbook | A session idle for 30 minutes expires and needs a new login: 29 minutes still works, 31 minutes is expired, and any request restarts the window | any protected route, POST /api/auth/refresh | modules/users/sessions.service.ts:188-192, common/auth/auth.guard.ts:73-74 | auth-session.e2e-spec.ts:248, :259, :273 | - | PASS | Q4 |
| R-ACC-06-05 | derived | Refresh rotates the token, catches a replayed token, and never extends past the absolute lifetime | POST /api/auth/refresh | modules/users/sessions.service.ts:105-147 | auth-session.e2e-spec.ts:156, :179, :197, :236 | - | PASS | |
| R-ACC-07a-01 | workbook | An admin resets a user's or a moderator's password to a temporary one | POST /api/admin/users/:id/reset-password | modules/users/admin-accounts.service.ts:45-92 | admin-reset-password.e2e-spec.ts:50, :95 | - | PASS | |
| R-ACC-07a-02 | workbook | The new password must be set at the next login. Login lands on change-password. Until the change, only /auth/me, change-password and logout work, and the change survives a logout | all protected routes | common/auth/auth.guard.ts:85-94 | admin-reset-password.e2e-spec.ts:50 | vv:295, vv:316 | PASS | |
| R-ACC-07a-03 | workbook | The new password meets the rules and differs from the temporary one | PATCH /api/auth/change-password | modules/auth/auth.service.ts:291 | admin-reset-password.e2e-spec.ts:50; auth-change-password.e2e-spec.ts:146 | - | PASS | |
| R-ACC-07a-04 | jira-dod | The temporary password meets the password rules (400 field error otherwise) | POST /api/admin/users/:id/reset-password | modules/users/dto/reset-password.dto.ts | admin-reset-password.e2e-spec.ts:136 | - | PASS | |
| R-ACC-07a-05 | derived | An admin target is refused with 403, an unknown id with 404, a malformed id with 400 | POST /api/admin/users/:id/reset-password | modules/users/admin-accounts.service.ts:65 | admin-reset-password.e2e-spec.ts:149 | - | PASS | Q6 |
| R-ACC-07a-06 | derived | Reset ends all sessions, lifts the lock and is audited | POST /api/admin/users/:id/reset-password | modules/users/admin-accounts.service.ts:75, :91 | admin-reset-password.e2e-spec.ts:50, :102, :117 | - | PASS | |
| R-ACC-07a-07 | jira-dod | Admins only (403 for USER and moderators, 401 for guests); unknown body fields give 400 | POST /api/admin/users/:id/reset-password | modules/users/admin-accounts.controller.ts:40 | admin-reset-password.e2e-spec.ts:160 | vv:330, vv:411 | PASS | |
| R-ACC-08-01 | workbook | A logged-in user changes the password with the current one and a new one | PATCH /api/auth/change-password | modules/auth/auth.service.ts:275 | auth-change-password.e2e-spec.ts:35 | - | PASS | |
| R-ACC-08-02 | workbook | A wrong current password gives 400 with a `currentPassword` error, and the password is unchanged | PATCH /api/auth/change-password | modules/auth/auth.service.ts:282-289 | auth-change-password.e2e-spec.ts:67 | - | PASS | Q5 |
| R-ACC-08-03 | workbook | The new password meets the rules: 7 chars, letters-only and digits-only are rejected; exactly 8 is accepted | PATCH /api/auth/change-password | modules/auth/dto/change-password.dto.ts:13 | auth-change-password.e2e-spec.ts:79 | vv:346 | PASS | |
| R-ACC-08-04 | derived | A new password equal to the current one is rejected | PATCH /api/auth/change-password | modules/auth/auth.service.ts:291 | auth-change-password.e2e-spec.ts:146 | - | PASS | |
| R-ACC-08-05 | derived | Other sessions are revoked and mustChangePassword is cleared | PATCH /api/auth/change-password | modules/auth/auth.service.ts:304-311 | auth-change-password.e2e-spec.ts:48, :102 | - | PASS | |
| R-ACC-08-06 | jira-dod | Works for every role, 401 for guests, both fields required, unknown fields rejected | PATCH /api/auth/change-password | modules/auth/auth.controller.ts:256 | auth-change-password.e2e-spec.ts:96, :118 | vv:356 | PASS | |
| R-ACC-09-01 | workbook | Any logged-in user edits name, phone and preferred currency (any subset) | PATCH /api/users/me | modules/users/profile.service.ts:35-69 | users-profile.e2e-spec.ts:53, :73, :165 | - | PASS | |
| R-ACC-09-02 | workbook | Name validation: empty, null and 101 chars are rejected; 100 chars is saved | PATCH /api/users/me | modules/users/dto/update-profile.dto.ts:24-30 | users-profile.e2e-spec.ts:127, :139 | vv:376 | PASS | |
| R-ACC-09-03 | workbook | Phone validation (E.164): local or letter formats are rejected; 15 digits is saved, 16 is rejected | PATCH /api/users/me | modules/users/dto/update-profile.dto.ts:15 | users-profile.e2e-spec.ts:88; unit users/dto/update-profile.dto.spec.ts:39 | vv:376 | PASS | |
| R-ACC-09-04 | workbook | The preferred currency must be supported (Countries.csv); CHF and EURO are rejected | PATCH /api/users/me | modules/users/profile.service.ts:51 | users-profile.e2e-spec.ts:104, :120 | - | PASS | |
| R-ACC-09-05 | workbook | Saves only if ALL fields pass: one invalid field means nothing is saved (checked in the DB) | PATCH /api/users/me | modules/users/profile.service.ts:35-69 | users-profile.e2e-spec.ts:88, :104 | vv:394 | PASS | |
| R-ACC-09-06 | jira-dod | GEN-13: email, role, status, passwordHash and id in the body are rejected | PATCH /api/users/me | forbidNonWhitelisted | users-profile.e2e-spec.ts:148 | vv:459 | PASS | |
| R-ACC-11-01 | workbook | Bookings are restricted to their owner; admins see all (ACC-17); moderators see their own provider's (FLT-29, HTL-22) | (bookings endpoints) | common/auth/access.ts (helpers only) | auth-guards.e2e-spec.ts:34, :71 (probe routes) | - | BLOCKED-BY FLT-22/HTL-18 | |
| R-ACC-11-02 | workbook | Private itineraries are owner-only (404 for others) | (itinerary endpoints) | common/auth/access.ts | auth-guards.e2e-spec.ts:52 (probe route) | - | BLOCKED-BY ITN-20 | |
| R-ACC-11-03 | workbook | Unauthorised requests are rejected: every admin route gives 403 to USER, HOTEL_MODERATOR and AIRLINE_MODERATOR cookies with the DB unchanged, and 401 to guests | GET /api/admin/accounts, POST /api/admin/moderators, POST /api/admin/users/:id/reset-password | modules/users/admin-accounts.controller.ts:40 | admin-accounts.e2e-spec.ts:198; admin-moderators.e2e-spec.ts:209; admin-reset-password.e2e-spec.ts:160 | vv:411 | PASS | |
| R-ACC-11-04 | derived | /users/me takes no id: an id in the body is rejected and another account is never touched | GET/PATCH/DELETE /api/users/me | modules/users/users.controller.ts:37 | users-profile.e2e-spec.ts:165 | vv:459 | PASS | |
| R-ACC-11-05 | derived | Status, role and provider are read fresh on every cookie request (suspended gives 403, deactivated or deleted gives 401) | all protected routes | common/auth/auth.guard.ts:73-83, modules/users/session-validator.service.ts | auth-guards.e2e-spec.ts:117, :151, :169, :182 | - | PASS | |
| R-ACC-11-06 | derived | Brief risk 4: the cookie-less x-dev-user stub must not let a real suspended or deactivated account through | all protected routes | common/auth/auth.guard.ts:59-60 | - | vv:474 (it.failing) | FAIL | F-A-02 |
| R-ACC-12-01 | workbook | A registered user deactivates their own account after confirmation (current password) | DELETE /api/users/me | modules/users/deactivation.service.ts:61 | users-deactivation.e2e-spec.ts:49, :106 | - | PASS | |
| R-ACC-12-02 | workbook | Deactivation is blocked while the user has upcoming Confirmed bookings | DELETE /api/users/me | modules/users/deactivation.service.ts:35-43, :70-72 (UPCOMING_BOOKINGS is @Optional and bound nowhere in src) | users-deactivation.e2e-spec.ts:88 (fake provider only) | - | BLOCKED-BY FLT-22/HTL-18 | F-A-04 |
| R-ACC-12-03 | workbook | A deactivated user cannot log in (generic 401); all sessions are revoked and the old refresh cookie cannot start a new session | POST /api/auth/login, POST /api/auth/refresh | modules/users/deactivation.service.ts:94, modules/auth/auth.service.ts:151 | users-deactivation.e2e-spec.ts:49; auth-login.e2e-spec.ts:157 | vv:513 | PASS | |
| R-ACC-12-04 | workbook | The user's posts and public itineraries are hidden | (blog/itinerary endpoints) | - | - | - | BLOCKED-BY BLG-01/ITN-20 | |
| R-ACC-12-05 | workbook | Their comments and reviews show as "Deleted user" | (comment/review endpoints) | - | - | - | BLOCKED-BY BLG-05/HTL-23 | |
| R-ACC-12-06 | derived | Registered users only (403 for admins and moderators, 401 for guests); unknown body fields give 400 | DELETE /api/users/me | modules/users/users.controller.ts:52 | users-deactivation.e2e-spec.ts:123 | vv:500 | PASS | |
| R-ACC-13-01 | workbook | An admin creates a hotel or airline moderator (name, email, role) | POST /api/admin/moderators | modules/users/moderators.service.ts:41 | admin-moderators.e2e-spec.ts:53, :116 | - | PASS | |
| R-ACC-13-02 | workbook | Linked to exactly one existing provider of the role's type: an airline id for a hotel moderator or a hotel id for an airline moderator gives 404 `providerId`, and nothing is created | POST /api/admin/moderators | modules/users/moderators.service.ts:50-68, modules/users/schemas/user.schema.ts:138 | admin-moderators.e2e-spec.ts:134; users-schemas.e2e-spec.ts:90 | vv:532 | PASS | |
| R-ACC-13-03 | derived | An inactive provider gives 409 PROVIDER_INACTIVE | POST /api/admin/moderators | modules/users/moderators.service.ts:70 | admin-moderators.e2e-spec.ts:226 | - | PASS | |
| R-ACC-13-04 | workbook | A duplicate email (any case) gives 409; two parallel creations give one 201, one 409 and one document | POST /api/admin/moderators | modules/users/moderators.service.ts:114 | admin-moderators.e2e-spec.ts:155 | vv:574 | PASS | |
| R-ACC-13-05 | workbook | The admin sets a temporary password that meets the rules | POST /api/admin/moderators | modules/users/dto/create-moderator.dto.ts:63 | admin-moderators.e2e-spec.ts:168 | - | PASS | |
| R-ACC-13-06 | workbook | The moderator must change the password on first login | POST /api/auth/login, all protected routes | modules/users/moderators.service.ts:87, common/auth/auth.guard.ts:85 | admin-moderators.e2e-spec.ts:53 | - | PASS | |
| R-ACC-13-07 | jira-dod | Admins only; role limited to the moderator roles; GEN-13 rejects `status`, `mustChangePassword`, `assignedProvider`, `airlineId` and `hotelId` | POST /api/admin/moderators | modules/users/dto/create-moderator.dto.ts:50 | admin-moderators.e2e-spec.ts:168, :209 | vv:548, vv:411 | PASS | |
| R-ACC-13-08 | derived | The creation is audited without the password | POST /api/admin/moderators | modules/users/moderators.service.ts:96 | admin-moderators.e2e-spec.ts:185 | - | PASS | |
| R-ACC-14-01 | workbook | A paginated list of all accounts with page size 10: 11 rows give 10 + 1, and `limit` is rejected | GET /api/admin/accounts | modules/users/admin-accounts.service.ts:95, common/pagination/pagination.ts | admin-accounts.e2e-spec.ts:85, :186 | vv:603 | PASS | |
| R-ACC-14-02 | workbook | Each row shows name, email, role, status and registration date (`registeredAt`) | GET /api/admin/accounts | modules/users/admin-accounts.service.ts:122-138 | admin-accounts.e2e-spec.ts:64 | vv:635 | PASS | |
| R-ACC-14-03 | workbook | Search by name or email, ignoring case | GET /api/admin/accounts | modules/users/admin-accounts.service.ts:110 | admin-accounts.e2e-spec.ts:106, :178 | vv:635 | PASS | Q7 |
| R-ACC-14-04 | workbook | Filter by role and by status, combinable | GET /api/admin/accounts | modules/users/admin-accounts.service.ts:105-108 | admin-accounts.e2e-spec.ts:131, :170 | - | PASS | |
| R-ACC-14-05 | derived | Newest first, with a stable `_id` tie-break: equal registration times never overlap pages, and the order repeats | GET /api/admin/accounts | common/pagination/pagination.ts:119 | admin-accounts.e2e-spec.ts:64 | vv:603 | PASS | |
| R-ACC-14-06 | jira-dod | Admins only; bad role or status gives 400 with fieldErrors | GET /api/admin/accounts | modules/users/admin-accounts.controller.ts:40 | admin-accounts.e2e-spec.ts:186, :198 | - | PASS | |
| R-ACC-18-01 | workbook | Admin accounts are created by seeding | `npm run seed` | modules/users/admin-seed.service.ts:53 | users-schemas.e2e-spec.ts:202; auth-login.e2e-spec.ts:168 | - | PASS | |
| R-ACC-18-02 | workbook | No admin self-registration: a role in the body is rejected, register always creates USER, and a `__proto__` role does not get through | POST /api/auth/register | modules/users/users.service.ts:44 | auth-register.e2e-spec.ts:142 | vv:648 | PASS | |
| R-ACC-18-03 | derived | The seed is idempotent and race-safe, never resets an existing admin's password, and never promotes a non-admin | `npm run seed` | modules/users/admin-seed.service.ts:64 | users-schemas.e2e-spec.ts:224, :235, :245 | - | PASS | |
| R-ACC-18-04 | derived | No other path creates an admin: moderators with role ADMIN and PATCH /users/me with a role both give 400 | POST /api/admin/moderators, PATCH /api/users/me | modules/users/dto/create-moderator.dto.ts:50 | admin-moderators.e2e-spec.ts:168; users-profile.e2e-spec.ts:148 | - | PASS | |
| R-ACC-19-01 | workbook | Access and refresh tokens are issued as httpOnly, SameSite cookies | POST /api/auth/login, POST /api/auth/refresh | common/auth/auth-cookies.ts:32 | auth-login.e2e-spec.ts:67; auth-session.e2e-spec.ts:156 | - | PASS | |
| R-ACC-19-02 | workbook | The cookies are Secure (COOKIE_SECURE, which production must set to true) | POST /api/auth/login | common/auth/auth-cookies.ts:32, config/env.validation.ts:151-152 | unit common/auth/auth-cookies.spec.ts:31 (e2e runs with COOKIE_SECURE=false) | - | PASS | |
| R-ACC-19-03 | workbook | No token or credential appears in any JSON body (login, refresh, /auth/me, /users/me) | auth endpoints | modules/auth/auth.controller.ts:162, :187 | auth-login.e2e-spec.ts:67; auth-session.e2e-spec.ts:156 | vv:251 | PASS | |
| R-ACC-19-04 | workbook | /auth/me returns the current user (no passwordHash); 401 for guests and deleted accounts | GET /api/auth/me | modules/auth/auth.service.ts:315 | auth-login.e2e-spec.ts:215, :227, :278 | - | PASS | |
| R-ACC-19-05 | workbook | The frontend stores no token or credential in localStorage, sessionStorage or other JS-accessible storage | (frontend) | frontend/ contains only README.md | - | - | BLOCKED-BY M2-frontend | |

### Verdict counts

| Req | PASS | FAIL | PARTIAL | BLOCKED | UNTESTED |
|---|---|---|---|---|---|
| ACC-01 | 11 | 0 | 0 | 0 | 0 |
| ACC-04 | 8 | 0 | 0 | 0 | 0 |
| ACC-05 | 9 | 1 | 1 | 0 | 0 |
| ACC-06 | 5 | 0 | 0 | 0 | 0 |
| ACC-07a | 7 | 0 | 0 | 0 | 0 |
| ACC-08 | 6 | 0 | 0 | 0 | 0 |
| ACC-09 | 6 | 0 | 0 | 0 | 0 |
| ACC-11 | 3 | 1 | 0 | 2 | 0 |
| ACC-12 | 3 | 0 | 0 | 3 | 0 |
| ACC-13 | 8 | 0 | 0 | 0 | 0 |
| ACC-14 | 6 | 0 | 0 | 0 | 0 |
| ACC-18 | 4 | 0 | 0 | 0 | 0 |
| ACC-19 | 4 | 0 | 0 | 1 | 0 |
| **Total** | **80** | **2** | **1** | **6** | **0** |

## Findings

### F-A-01: a deactivated account reveals itself through the lockout (Low, ACC-05 / ACC-04 / ACC-12)

- **Expected.**
  - ACC-04: "On failure it shall show a generic 'invalid email or password' message".
  - ACC-12: "A deactivated user cannot log in".
  - The code's own contract (auth.service.ts:108-111) says unknown emails and deactivated accounts get the same generic 401.
  - So a deactivated account should behave exactly like an unknown email: never counted, never locked, never ACCOUNT_LOCKED.
- **Actual.**
  - The ACC-05 gate (`claimLoginAttempt`) and the lock run before the status check.
  - The 5th wrong password on a deactivated account returns 403 ACCOUNT_LOCKED ("Too many failed login attempts..."). Afterwards even the right password returns 403 ACCOUNT_LOCKED for 15 minutes.
  - An unknown email always returns 401 INVALID_CREDENTIALS, so the two can be told apart: anyone can learn that a deactivated user's email still has an account.
  - Suspended accounts behave the same way (see Q2).
- **Repro.**
  1. `POST /api/auth/register {"name":"X","email":"d@example.com","password":"Travel2026","acceptTerms":true}`
  2. Log in with `{"email":"d@example.com","password":"Travel2026"}`, then `DELETE /api/users/me {"password":"Travel2026"}`.
  3. Call `POST /api/auth/login {"email":"d@example.com","password":"WrongPass1"}` 5 times. The 5th returns 403 ACCOUNT_LOCKED.
  4. The same 5 calls with `{"email":"nobody@example.com","password":"WrongPass1"}` always return 401.
- **Code.** modules/auth/auth.service.ts:121-145, with the status check only at :151.
- **Severity.** Low. Lockout already tells active accounts apart from unknown emails by design. The extra leak is limited to accounts whose owners chose to leave.
- **Fix idea.** Load the status first and treat DEACTIVATED like an unknown email (dummy hash compare, no counting).
- **Proof.** Failing test vv:226 `Lockout boundaries (vv): ACC-05 > a deactivated account behaves exactly like an unknown email: never locked, never ACCOUNT_LOCKED`, marked `it.failing`. Received 403 ACCOUNT_LOCKED where 401 INVALID_CREDENTIALS was expected.

### F-A-02: the x-dev-user stub bypasses status, session and forced-change checks for real accounts (Low, ACC-11 / ACC-12 / ACC-04)

- **Expected.**
  - Brief risk 4: the stub must not let a real suspended or deactivated account through.
  - ACC-12: "A deactivated user cannot log in"; ACC-04: suspended accounts are refused.
- **Actual.**
  - When no `access_token` cookie is sent, `AuthGuard` hands the request to `AuthStubGuard` (auth.guard.ts:59-60).
  - The stub trusts `x-dev-user: USER:<id>` and does none of the cookie path's checks: no session check, no account status check (auth.guard.ts:73-83), no mustChangePassword check (:85-94).
  - `GET /api/users/me` with `x-dev-user: USER:<id of a DEACTIVATED account>` returns 200, and the same for a SUSPENDED account. PATCH would edit them too.
- **Repro.**
  1. Create a user and set its status to DEACTIVATED.
  2. `GET /api/users/me` with header `x-dev-user: USER:<id>` and no cookie: 200 with the profile.
- **Code.** common/auth/auth.guard.ts:59-60, common/auth/auth-stub.guard.ts.
- **Severity.** Low. The stub runs only when AUTH_STUB=true, outside production (config/env.validation.ts:150 rejects AUTH_STUB in production) and only from loopback. The risk is a staging or dev box with NODE_ENV not set to production, and e2e suites that use `asUser()` and so never exercise status rules.
- **Fix idea.** Have the stub go through `SESSION_VALIDATOR`-style status checks when the id belongs to a real account, or retire the stub.
- **Proof.** Failing test vv:474 `Admin-only routes and the dev stub (vv): ACC-11 > the x-dev-user stub cannot act as a real deactivated or suspended account`, marked `it.failing`. Received 200 where 401 was expected.

### F-A-03: login's 429 TOO_MANY_REQUESTS is not a documented response (Low, ACC-05, Swagger)

- **Expected.** Jira DoD: the error responses are documented.
- **Actual.** POST /api/auth/login really returns 429 TOO_MANY_REQUESTS for simultaneous attempts. auth-lockout.e2e-spec.ts:142 asserts it.
  - The 429 is mentioned only in the free-text description (auth.controller.ts:130).
  - `@ApiErrorResponses(400, 401, 403)` (:155) does not list it, and `ErrorStatus` (common/swagger/api-responses.decorator.ts) cannot express 429.
  - The openapi-rules check does not catch this.
- **Repro.** Send 20 parallel `POST /api/auth/login {"email":"<existing>","password":"WrongPass1"}`. Some answers are 429, and 429 is absent from /api/docs-json `paths./api/auth/login.post.responses`.
- **Code.** modules/auth/auth.controller.ts:155.
- **Proof.** No failing test (documentation only).

### F-A-04: the Swagger text for DELETE /users/me claims the bookings block works, but it can never fire (Low, ACC-12)

- **Expected.** ACC-12: "Deactivation is blocked while the user has upcoming Confirmed bookings". The Swagger description (users.controller.ts:58) states as fact "Refused with 409 UPCOMING_BOOKINGS_EXIST while the user has upcoming Confirmed bookings."
- **Actual.** `UPCOMING_BOOKINGS` is injected `@Optional()` (deactivation.service.ts:35-36) and no module in `src` provides it. The count is therefore always 0 (:70-72), so the block never fires. Only the test-local fake in users-deactivation.e2e-spec.ts:88 exercises it.
- **Status.** The rule itself is BLOCKED-BY FLT-22/HTL-18. The finding is that the documentation over-claims.
- **Fix idea.** Add "(active once the bookings modules provide UPCOMING_BOOKINGS)" to the description until FLT-22 and HTL-18 land.
- **Repro.** With the real AppModule, a user with Confirmed bookings (once bookings exist) gets 204 from `DELETE /api/users/me {"password":"..."}`.
- **Code.** modules/users/deactivation.service.ts:35-43, :70-72; modules/users/users.controller.ts:58.
- **Proof.** No failing test: the real bookings data cannot be created in M1.

## Spec questions

- **Q1 (ACC-05).** Parallel logins of one account beyond 5 in flight get 429 TOO_MANY_REQUESTS (users.service.ts:86-117), which the workbook never mentions. Is a 429 acceptable for a double-clicked or scripted login, or should extra attempts queue? This is a derived rule, not a defect.
- **Q2 (ACC-04/ACC-05).** Should suspended (and deactivated) accounts be counted and locked at all? While locked, a suspended user with the right password sees "account locked" instead of the workbook's "account suspended".
- **Q3 (ACC-01).** "At least one letter" is implemented as ASCII `[A-Za-z]` (password-rules.ts:7), so `пароль123` or `contraseña1`-style passwords without ASCII letters are rejected. The 72-byte maximum is derived (bcrypt). Confirm both.
- **Q4 (ACC-06).** POST /api/auth/refresh counts as activity (sessions.service.ts:105-130). A frontend that refreshes on a timer would keep an unattended session alive forever. Should only user-initiated requests reset the 30-minute idle clock?
- **Q5 (ACC-08/ACC-12).** Wrong current passwords on change-password and on the deactivation confirmation are not counted toward the ACC-05 lockout. With a stolen session, the password can be brute-forced there. Should they count?
- **Q6 (ACC-07a).** Resetting a SUSPENDED or DEACTIVATED account is allowed and leaves the status unchanged, and admins cannot be reset at all (403, derived). Confirm both.
- **Q7 (ACC-14).** `?q=` (an empty search box) is a 400 "q must not be empty" rather than "no filter". Confirm the frontend omits empty parameters.
