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

## Pages, sections and access

All paths live in `src/shared/config/routes.ts`; link with `ROUTES.*`, never a hand-typed string.

| Section                                                | Who may open it       | Story                      |
| ------------------------------------------------------ | --------------------- | -------------------------- |
| `/`, `/flights`, `/hotels`, `/itineraries`, `/blog`    | everyone (guests too) | FE-06, FE-08, FE-12, FE-14 |
| `/login`, `/register`                                  | everyone              | FE-03                      |
| `/account/*` (profile, change password, notifications) | any signed-in user    | FE-03, FE-04               |
| `/bookings/*`, `/checkout/*`, `/itineraries/mine/*`    | travellers (`USER`)   | FE-10, FE-02, FE-11        |
| `/admin/*`                                             | `ADMIN`               | FE-05, FE-15               |
| `/moderator/airline/*`                                 | `AIRLINE_MODERATOR`   | FE-07                      |
| `/moderator/hotel/*`                                   | `HOTEL_MODERATOR`     | FE-09                      |

How a private page is protected (ACC-10, ACC-11):

1. `src/proxy.ts` runs before rendering. A visitor with no session gets a 307 to
   `/session/refresh?next=…`, which renews the session or continues to `/login?next=…`. A role
   that may not open the section gets a real 404.
2. The section's `layout.tsx` checks again on the server (`RequireSection` from
   `@/features/auth/server`) inside a `<Suspense>` boundary.
3. The API authorises every request again. The frontend checks only shape navigation.

The private sections already have a guarded layout and a placeholder page. To build your page, replace
the section's `page.tsx` (or add pages below it); the guard applies automatically. A new private
section needs one entry in `PROTECTED_SECTIONS` (`src/features/auth/model/roles.ts`) and one in the
proxy `matcher`.

In client components, `useAuth()` (from `@/features/auth`) gives `{ state, reload, logout }`, where
`state.status` is `loading`, `guest` or `authenticated`. In Server Components, `getSession()` and
`requireUser()` come from `@/features/auth/server`.

## Linking to checkout (FE-02)

Search and booking pages hand over to checkout with a plain link. Checkout reloads the flights,
holds the seats and runs policies, payment and confirmation.

| From                  | Link                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Flight search (FE-06) | `/checkout/flight?outbound=<flightId>:<cabinId>&return=<flightId>:<cabinId>&adults=1&children=0&infants=0`   |
| My bookings (FE-10)   | `/checkout/flight/<bookingId>` or `/checkout/hotel/<bookingId>` to resume paying a `PENDING_PAYMENT` booking |

- `return` is only for round trips. The passenger counts default to 1 adult and must satisfy the API's
  rules (at least one adult, no more infants than adults, at most 9 in total).
- Build the pay link with `payPath(kind, bookingId)` from `@/features/checkout`.

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
