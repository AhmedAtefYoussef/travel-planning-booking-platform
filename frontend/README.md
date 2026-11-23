# Frontend (Milestone 2)

Next.js 16 (App Router, TypeScript, Tailwind CSS v4) app for the Travel Planning and Booking Platform.
It talks only to the Milestone 1 REST API; every rule is enforced by the backend, and the frontend
checks only improve the experience (GEN-13).

## Run it locally

1. Start the API first (`cd backend; npm run start:dev`, port 3000). See the root [README](../README.md).
2. Then the frontend:

   ```powershell
   cd frontend
   Copy-Item .env.example .env.local   # then fill in the values
   npm install
   npm run dev                         # http://localhost:3001
   ```

The browser calls `/api/*` on this app and Next.js forwards it to `BACKEND_URL` (a rewrite in
`next.config.ts`), so the API's httpOnly cookies are first-party and no CORS setup is needed.

| Script                        | What it does                                                   |
| ----------------------------- | -------------------------------------------------------------- |
| `npm run dev`                 | Dev server on port 3001                                        |
| `npm run build` / `npm start` | Production build and server (port 3001)                        |
| `npm run lint`                | ESLint, including the layer rules below; zero warnings allowed |
| `npm run typecheck`           | Generates route types (`next typegen`) and runs `tsc`          |
| `npm test`                    | Vitest + Testing Library (`src/**/*.test.ts(x)`)               |
| `npm run format`              | Prettier (Tailwind classes sorted)                             |

CI runs `npm ci`, lint, typecheck, test and build on every PR that touches `frontend/`. The build
must succeed without any env file, so every variable has a safe default (`src/shared/config/env.ts`).

## Environment

| Variable                             | Where       | Purpose                                                                                      |
| ------------------------------------ | ----------- | -------------------------------------------------------------------------------------------- |
| `BACKEND_URL`                        | server only | API origin for the `/api` rewrite and server-side requests (default `http://localhost:3000`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | browser     | Stripe **test-mode** publishable key (`pk_test_…`) for checkout                              |

`NEXT_PUBLIC_*` values are inlined at build time. Never put a secret in one.

## Project structure

```
src/
  app/         Routes only: thin pages and layouts that compose features (rendering choice per route)
  features/    One folder per feature (e.g. auth, checkout): api/, model/ (pure logic), ui/, index.ts
  shared/      Reusable building blocks: api/ (client), ui/ (design system), lib/, config/
  proxy.ts     Runs before rendering (route protection)
```

Dependencies point one way: `app → features → shared`. ESLint enforces it (`eslint.config.mjs`):

- `shared/` never imports a feature or a route.
- A feature never imports a route, and uses another feature only through its public index
  (`import { … } from '@/features/auth'`), never its internals.
- Inside a feature, use relative imports.

Keep business logic in `features/<name>/model` as plain functions with unit tests; components stay thin.

## Rules every page follows

- **No tokens in JavaScript (ACC-19).** The session lives in httpOnly cookies. Never use
  `localStorage`/`sessionStorage` for anything auth-related; CI's guard rails fail the build if you do.
- **Rendering (brief section 9).** Cache Components is on: data is dynamic unless cached with
  `'use cache'` + `cacheLife` (use that for ISR-style public pages such as published posts and public
  itineraries). Private pages (bookings, checkout, dashboards) render per request; anything reading
  cookies sits inside a `<Suspense>` boundary. Justify the choice in your PR description.
- **Lists page by 10 (GEN-05).** Send `page` only; the API rejects any page-size parameter.
- **Field errors (GEN-02).** Show the API's `fieldErrors` next to the matching inputs.
- **States (GEN-04, GEN-16).** Every data view has loading, error and empty states, and every layout
  works at mobile, tablet and desktop widths.
