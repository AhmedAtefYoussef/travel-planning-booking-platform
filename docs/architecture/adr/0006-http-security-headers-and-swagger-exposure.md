# ADR-0006: HTTP security headers (helmet) and Swagger exposure

- Status: Accepted (Milestone 1 hardening, TRVL-183).
- Requirements: GEN-13 (backend-enforced security), brief section 13.1 (Milestone 1 is evaluated through Swagger UI).

## Decision
- **helmet** runs first in `configureApp` (`backend/src/app.setup.ts`), so every response carries the standard headers: HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer` and a Content Security Policy.
- **The CSP is tuned so Swagger UI keeps working.**
  - `script-src 'self'`: Swagger UI loads its bundle and `swagger-ui-init.js` as same-origin files and runs no inline script, so no `unsafe-inline` is needed for scripts.
  - `style-src 'self' 'unsafe-inline'` and `img-src 'self' data:`: Swagger UI styles elements inline and shows `data:` icons.
  - `frame-ancestors 'none'`: no page may embed the API in a frame.
- **`Cross-Origin-Resource-Policy: cross-origin`.** The Milestone 2 Next.js frontend runs on another origin and must be able to show `/uploads/...` images. Uploaded files keep their own stricter `default-src 'none'; sandbox` CSP, set when they are served.
- **Swagger is served only when `SWAGGER_ENABLED` allows it** (`isSwaggerEnabled` in `common/swagger/swagger.setup.ts`).
  - Unset: on outside production, off in production, so a deployment does not publish a map of every route by default.
  - `SWAGGER_ENABLED=true` opts a deployment in, for example the cloud-deployment bonus that is graded through Swagger.

## Consequences
- `test/security-headers.e2e-spec.ts` checks the headers, and checks that the Swagger UI page has only same-origin, non-inline scripts. A future Swagger UI upgrade that adds inline script fails that test, not the evaluation.
- Rate limiting (`@nestjs/throttler`) is left for later (TRVL-183). Its limits must allow the e2e suites and live Swagger demos, which log in many times in a row.
