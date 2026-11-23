# Frontend (Milestone 2)

Next.js 16 (App Router, TypeScript, Tailwind CSS v4) app for the Travel Planning and Booking Platform.
It talks only to the Milestone 1 REST API. Foundation: TRVL-145 (FE-01).

## Run it

```bash
cd frontend
cp .env.example .env.local      # BACKEND_ORIGIN, NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
npm install
npm run dev                     # http://localhost:3001 (the API runs on :3000, see backend/README)
```

| Script                            | What it does                                                      |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js on port 3001                                              |
| `npm run lint`                    | ESLint, zero warnings (CI)                                        |
| `npm run typecheck`               | route types + `tsc --noEmit` (CI)                                 |
| `npm test`                        | Vitest + React Testing Library (CI)                               |
| `npm run format`                  | Prettier, with Tailwind class sorting                             |
| `npm run api:types`               | regenerate `src/lib/api/schema.d.ts` from `docs/api/openapi.json` |

CI (`.github/workflows/ci.yml`, job `frontend`) runs `npm ci`, lint, typecheck, test and build on every PR
that touches `frontend/`. The pre-commit hook runs Prettier and ESLint on staged frontend files.

## How the app reaches the API

- The browser calls **`/api/...` on the frontend's own origin**; `next.config.ts` rewrites it to
  `BACKEND_ORIGIN`. So there is no CORS in the browser and the API's cookies belong to this site.
- Auth is **httpOnly cookies only** (ACC-19): `access_token` (path `/`, 15 min) and `refresh_token`
  (path `/api/auth`). No code may read, store or forward a token; CI fails on token + localStorage/sessionStorage.
- **Client Components** use `api` / `apiFetch` from `@/lib/api/client`:
  `credentials: 'include'`, JSON in and out, a single shared `POST /api/auth/refresh` on 401 with one
  replay, redirect to `/login?next=...` when the session is over, and `/account/change-password` on
  `PASSWORD_CHANGE_REQUIRED`. Pass `auth: 'silent'` when a 401 is a normal answer.
- **Server Components** use `@/lib/api/server`: `serverFetch` (forwards the visitor's cookies, never
  cached, for dynamic SSR) or `publicFetch` (no cookies, `revalidate` seconds, for ISR pages).
- Every failure is an `ApiError` with `status`, `code` (the API's error code) and `fieldErrors`
  (`{ 'passengers[0].dateOfBirth': ['...'] }`). Branch on `code`, never on message text.
- DTO types come from the OpenAPI document: `import type { UserProfile, Page, Schemas } from '@/lib/api/types'`.
- Lists: `?page=` only, page size fixed at 10 (GEN-05). Sending `limit` is a 400.
- Money is integer minor units (`*Minor`): show it with `formatMoney(minor, currency)`.
  Flight times: `formatInZone({ utc, timeZone })` in the airport's zone (GEN-06).

## Auth and route protection

| Layer                   | File                       | What it does                                                                                                                                                                            |
| ----------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proxy (optimistic)      | `src/proxy.ts`             | Guests on a private path go to `/session/refresh?next=...` before anything renders (ACC-10). Private prefixes live in `PROTECTED_PREFIXES` (`src/lib/auth/routes.ts`): add yours there. |
| Segment layout (server) | `app/<segment>/layout.tsx` | `requireUser()` or `requireRole(['ADMIN'])` from `@/lib/auth/session`. Wrong role -> 404; temporary password -> change it first.                                                        |
| API                     | backend                    | The real authority (GEN-13). Frontend checks are UX only.                                                                                                                               |

- `/session/refresh` exists because the refresh cookie only reaches `/api/auth`: the browser renews the
  session there and returns to `next`, or continues to the login page.
- In Client Components, `useAuth()` gives `{ user, status, reload, signedIn, logout }`. Public pages do not
  read cookies on the server (they stay static); the header loads the user in the browser.
- After login: call `signedIn(response.user)` and go to `safeNextPath(next, response.homePath)`.
  Always pass return paths through `safeNextPath` (no open redirects).

## Forms

`useApiForm` (`@/lib/forms/api-form`) is react-hook-form plus API errors: wrap the submit handler in
`onSubmit(async (values) => { await api.post(...) })`; field errors from the API land on the matching
inputs (array paths included) and other errors in `formError` (GEN-02).

## Folder structure

```
src/
  app/                    routes; one folder per section, private sections guard themselves in layout.tsx
    account/ bookings/ checkout/ admin/ moderator/{airline,hotel}/   (protected)
    login/ session/refresh/                                         (auth plumbing)
  components/
    layout/               header, footer, navigation (nav-links.ts: add your section's link here)
    ui/                   shared UI kit (GEN-17)
  lib/
    api/                  client.ts, server.ts, errors.ts, types.ts, schema.d.ts (generated)
    auth/                 routes.ts, session.ts (server), auth-context.tsx (client)
    forms/                useApiForm
    format/               money, dates and time zones
    seo.ts                buildMetadata() for public pages
  proxy.ts                route protection (Next.js 16 "proxy", formerly middleware)
```

Tests sit next to the code as `*.test.ts(x)`.

## Rendering strategy (brief section 9)

Cache Components is **off**; rendering is chosen per route with segment config:

| Page                                                                  | Strategy          | How                                                                         |
| --------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------- |
| Published blog post, public author page, public itinerary detail      | ISR / static      | `publicFetch(path, { revalidate: 60 })`, `generateStaticParams` optional    |
| Blog listing/search, public itinerary search, flight/hotel search     | Dynamic SSR       | read `searchParams`; `serverFetch` or `publicFetch(..., { revalidate: 0 })` |
| Private itinerary, bookings, checkout, admin and moderator dashboards | Dynamic SSR       | layout calls `requireRole`, page uses `serverFetch`                         |
| Editors, likes, comments, forms, payment                              | Client Components | `'use client'` + `api`                                                      |

The root layout reads no cookies on purpose: reading them there would make every page dynamic.

**Loading boundaries:** never add `app/loading.tsx` or a `loading.tsx` next to a guarded `layout.tsx`.
A loading boundary above a guard starts streaming with HTTP 200 before `requireRole` runs, so a wrong
role gets 200 instead of 404 and redirects happen in the browser. Put `loading.tsx` one level deeper
(e.g. `app/bookings/flights/loading.tsx`) and render `<PageLoading />` from `@/components/layout/page-loading`.
Public pages add SEO metadata with `buildMetadata({ title, description, path })`.
