# Replacing the auth stub with real login (ACC-19, ACC-11)

- **Status:** proposed, 2026-11-10. Owner: Abdelrahman (ACC-04/05/06/11/19, TRVL-137). Reviewer: Ahmed.
- **Progress (2026-11-11):** step 1 in #41. Step 2 in #43, which also brings the cookie half of step 3 forward: `AuthGuard` (common/auth/auth.guard.ts) is now the global guard, authenticates from the `access_token` cookie and falls back to the stub only when no cookie is sent. Loading the user and rejecting suspended accounts on every request stays in the ACC-11 PR; `/auth/refresh` and logout land with ACC-06.
- **Goal:** cookie login lands **by 2026-11-14** without breaking any module or e2e test. It must not turn into a big-bang switch in the last week before Milestone 1 (2026-11-20).

## Where we are

- **The stub is the global guard.** `AuthStubGuard` is the global `APP_GUARD` (`common/common.module.ts`). It turns `x-dev-user: ROLE[:userId[:providerId]]` into `request.user` (`AuthUser`), but only when `AUTH_STUB=true`, outside production, and from localhost.
- **Many places depend on it:** 10 routes on `develop` (plus 4 more on the hotels branches), about 108 `x-dev-user` headers in 10 e2e files, and the Swagger `dev-user` scheme.
- **Module code depends only on the contract,** not on the stub: `@Public()`, `@Roles()`, `@CurrentUser()`, `isPublicRoute()` and `AuthUser {id, role, assignedProvider}`. Keep that contract unchanged and no module has to change.

## Decision: add the real guard next to the stub, then retire the stub

The real guard **authenticates from the `access_token` cookie first**. Only when there is no cookie, **and** `AUTH_STUB=true`, **and** the app isn't in production, **and** the request comes from loopback, does it fall back to the existing stub parsing. So:

- The existing e2e suites and Swagger demos keep working unchanged (`TEST_ENV` keeps `AUTH_STUB=true`).
- New auth e2e tests use real cookies. Production behaviour never depends on the stub, because env validation already refuses `AUTH_STUB=true` in production.
- Moving the tests to cookies is optional and can happen module by module after Milestone 1.

## Steps (one PR each, in order)

| # | PR | Requirement | Done when |
|---|---|---|---|
| 1 | `feature/TRVL-137-users-sessions-schemas` | TRVL-137, ACC-18 | `users` (unique email index, `status`, `failedLogins`, `lockedUntil`, `assignedProvider`) and `sessions` (hashed refresh token, `lastActivityAt`, `expiresAt`, `revokedAt`) are registered in `forFeature`. Admin seed runs from `npm run seed`. |
| 2 | `feature/ACC-19-auth-cookies` | ACC-19, ACC-04 | `POST /api/auth/login` sets httpOnly `access_token` and `refresh_token` (SameSite=Lax, `Secure` from `COOKIE_SECURE`). `GET /api/auth/me` returns `AuthUser`. `POST /api/auth/refresh` exists. No token appears in a response body. |
| 3 | `feature/ACC-11-real-guard` | ACC-11, GEN-13 | `JwtCookieGuard` replaces `AuthStubGuard` as `APP_GUARD`. It calls `isPublicRoute()`, verifies the JWT, loads the user, rejects suspended and locked accounts with 401/403, and uses the stub fallback above. `RolesGuard` is unchanged. |
| 4 | `feature/ACC-05-lockout`, `feature/ACC-06-logout-idle` | ACC-05, ACC-06 | 5 failed logins → 15-minute lock. Logout revokes the session. 30 minutes idle → refresh fails. Each has an e2e test. |
| 5 | `chore/retire-auth-stub` (after Milestone 1 grading, or never) | GEN-13 | Swagger `dev-user` scheme and `AUTH_STUB` removed; e2e suites use a `loginAs(role)` helper that returns a cookie. |

## Test helper (step 3)

Add `backend/test/support/auth.ts` with one function, so a module's e2e tests don't care which mechanism is active:

```ts
// Today it returns the stub header; after step 5 it logs in and returns the cookie.
export function asUser(role: Role, ids: { userId?: string; providerId?: string } = {}): Record<string, string>;
// usage: request(app).post('/api/airlines').set(asUser(Role.Admin)).send(body)
```

Modules adopt it whenever they touch their e2e files. That way step 5 is a one-file change.

## Swagger during Milestone 1 grading

- Keep both schemes in Swagger: `access_token` (cookie) and `dev-user` (the stub).
- The demo script (TRVL-135) logs in through `POST /api/auth/login`, so graders see real cookies.
- `dev-user` stays only as a local convenience.

## Risks

- **A guard regression hides behind the stub fallback.** Mitigation: the step 3 e2e tests run with `AUTH_STUB=false` for the auth suite, so every route is exercised once without the stub.
- **Step 1 or 2 slips past 11-14.** Every module's ownership rules stay demoable only through the stub. Escalate in the standup the day it slips, not at the code freeze.
