# Swagger verification evidence: Milestone 1 V&V

This branch holds evidence only and is never merged. It stores the Swagger UI screenshots cited by
`docs/qa/vv-m1/report.md` on `develop`, following the same convention as `evidence/sprint-0-swagger`.

- **How the app ran:** `npm run start:dev` from `develop` @ `fc610e0` with `NODE_ENV=development` and `AUTH_STUB=false`. Every call therefore used real httpOnly cookie sessions. The database was a separate Atlas database (`travel_vv`), seeded with `npm run seed`. The team database was not touched.
- **How the screenshots were taken:** each one is a real Swagger "Try it out → Execute" run.
- **Test accounts:** all accounts are throwaway accounts in `travel_vv`. Logins for the admin and the moderators were performed off-screen, so no real or reused password appears in any image.

| File | Requirement | What it shows |
|---|---|---|
| `vv-m1/01-ACC-01-register-201.png` | ACC-01 | `POST /api/auth/register` returns 201 with a USER account; the response contains no password |
| `vv-m1/02-ACC-01-GEN-02-register-400-fieldErrors.png` | ACC-01, GEN-02 | Invalid registration returns 400 `VALIDATION_FAILED` with `fieldErrors` for name, email, password, acceptTerms and the injected `role` |
| `vv-m1/03-F-A-01-deactivated-account-shows-locked.png` | ACC-04/05/12 (spec question SQ-1) | A deactivated account that has collected failed logins answers 403 `ACCOUNT_LOCKED` |
| `vv-m1/04-ACC-04-unknown-email-generic-401.png` | ACC-04 | An unknown email gets the generic 401 "Invalid email or password" |
| `vv-m1/05-ACC-14-admin-accounts-search.png` | ACC-14 | An admin searches accounts (`q=vv.user`); the result is paginated with a registration date |
| `vv-m1/06-F-C-01-unknown-city-400-no-fieldErrors.png` | HTL-01, GEN-02 (defect D-03) | An unknown `cityId` returns 400 `BAD_REQUEST` without `fieldErrors` |
| `vv-m1/07-FLT-03-dst-gap-rejected.png` | FLT-03, GEN-06 | A local time that does not exist in London (DST gap) is rejected with a clear field error |
| `vv-m1/08-FLT-11-GEN-06-search-by-local-date.png` | FLT-11, GEN-06 | A HND departure at 00:30 local (the previous day in UTC) is found by its local departure date |
| `vv-m1/09-FLT-30-FLT-05-departed-flight-not-editable.png` | FLT-30, FLT-05 | A flight marked Departed by the status job can no longer be edited (409) |
| `vv-m1/10-F-C-02-overlap-in-request-400-no-fieldErrors.png` | HTL-04 (spec question SQ-3) | Overlapping ranges in one request are refused with 400 and no `fieldErrors` |
| `vv-m1/11-ACC-11-hotel-moderator-on-admin-route-403.png` | ACC-11 | A hotel moderator calling an admin route gets 403 |
| `vv-m1/12-GEN-05-page-size-param-rejected.png` | GEN-05 | `GET /api/airports?limit=50` is rejected; the page size is fixed at 10 |
