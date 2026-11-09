# ADR-001: Authentication with httpOnly cookies and rotating refresh tokens

Status: Accepted (Milestone 1). Requirements: ACC-06, ACC-19, ACC-11, ACC-13.

## Context

The M2 web frontend calls this API from a browser. Tokens kept in JavaScript-readable storage are exposed to XSS. We also need idle timeout, forced logout and account lockout, which plain stateless JWTs cannot do.

## Decision

- Two cookies, both `httpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`: `access_token` (JWT, 15 minutes, claims `sub`, `role`, `sid`) and `refresh_token` (random value; only its hash is stored in `sessions`).
- `POST /api/auth/refresh` rotates the refresh token on every use. The session row (`userId`, `refreshTokenHash`, `lastActivityAt`, `expiresAt`, `revokedAt`) is the source of truth; a TTL index on `expiresAt` removes dead sessions.
- A guard updates `lastActivityAt` on each authenticated request and refuses access or refresh after 30 idle minutes (`SESSION_IDLE_MINUTES`).
- `JwtAuthGuard` is the global `APP_GUARD`; `@Public()` opts a route out; `RolesGuard` with `@Roles()` and a provider-scope check handle authorisation. Services also filter by owner, and a miss returns 404.
- Passwords use salted bcrypt (`PasswordHasher`). Five consecutive failures lock the account for 15 minutes. `mustChangePassword` blocks everything except change-password and logout.
- Until the real auth module lands, `DevAuthGuard` reads `x-dev-user-id`, `x-dev-role` and `x-dev-provider`. It is opt-in: it needs `DEV_AUTH_ENABLED=true` and `NODE_ENV` of `development` or `test`, and the env schema rejects `true` in production.

## Consequences

- Browsers cannot read the tokens, and a stolen access token lives at most 15 minutes. Revoking a session takes effect at the next guard check or refresh.
- Cookie auth needs CSRF care: `SameSite=Lax` plus JSON-only bodies is the M1 mitigation; the frontend must run on the same site or a configured CORS origin with credentials.
- Each authenticated request writes to `sessions` (one update). This is accepted for the idle-timeout guarantee.
