# ADR-0001: Authentication with httpOnly cookies and server-side sessions

- Status: Accepted (Sprint 0). The real guard is implemented in ACC-11 (Abdelrahman).
- Requirements: ACC-04, ACC-05, ACC-06, ACC-11, ACC-19, GEN-13. Brief section 8.1.

## Context
The brief forbids tokens in `localStorage`/`sessionStorage`. ACC-06 requires logout to revoke access and a 30-minute idle expiry. Suspended accounts must lose access immediately (ACC-15/16).

## Decision
- On login the API sets two **httpOnly, SameSite=Lax** cookies: a short-lived `access_token` JWT (`JWT_ACCESS_TTL`, 15 minutes) and a `refresh_token`. `Secure` is controlled by `COOKIE_SECURE`, which env validation forces to true in production.
- Every refresh token maps to a `sessions` document: hashed token, `lastActivityAt`, `expiresAt`, `revokedAt`. Logout revokes the session. Refresh fails after `SESSION_IDLE_MINUTES` of inactivity or when the account is suspended.
- Authentication is a **global, deny-by-default guard**. Routes opt out with `@Public()`. `RolesGuard` checks `@Roles()`. Ownership and provider scope are checked in services (`common/auth/access.ts`).
- Until ACC-11 lands, a stub guard reads `x-dev-user`, only when `AUTH_STUB=true`, outside production, and only from localhost. `NODE_ENV` is required, so a deployment cannot fall back to development by omission. The stub keeps the same `request.user` contract, so module code does not change.
- Route visibility gives method-level metadata precedence: a `@Roles()` method stays protected inside a `@Public()` controller.

## Consequences
- XSS cannot read the tokens. Cross-site requests from other origins are blocked by SameSite and the CORS allow-list (`CORS_ORIGINS`).
- Each refresh does a session lookup, which is what makes idle expiry and instant suspension enforceable.
- The frontend calls the API with `credentials: 'include'` and keeps no token state.
