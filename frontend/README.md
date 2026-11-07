# Frontend (Milestone 2)

The Next.js (App Router, TypeScript) app is scaffolded here in Milestone 2 (TRVL-145, FE-01).
CI already has a `frontend` job that starts linting, type-checking, testing and building this folder
as soon as `frontend/package.json` exists.

Rendering strategy per page follows brief section 9 (ISR for published posts and public itineraries,
dynamic SSR for searches, bookings and dashboards, client components for interactive parts).
Auth tokens stay in httpOnly cookies; the CI guard rails reject tokens in localStorage/sessionStorage (ACC-19).
