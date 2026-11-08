# Swagger verification evidence: Joudy's requirements

**Evidence only:** this branch is never merged. It holds the Swagger UI screenshots that Joudy's pull requests
embed (same convention as `evidence/sprint-0-swagger`).

- **How the app ran:** `npm run start:dev` on Joudy's machine with `NODE_ENV=development` and stub auth, against the
  team's MongoDB Atlas cluster, after `npm run seed`.
- **How the screenshots were taken:** each one comes from a real Swagger "Try it out → Execute" run in the browser.
  Where a response is taller than the screen, two screenshots of the same run are stacked (grey divider).

## GEN-12 (TRVL-110) reference data

| File | What it shows |
|---|---|
| `gen-12/01-gen12-reference-operations.png` | The Reference data tag; every summary starts with GEN-12 |
| `gen-12/02-gen12-countries-200.png` | `GET /api/countries`: the 8 seeded countries by name, page envelope `{page: 1, limit: 10, total: 8}` |
| `gen-12/03-gen12-cities-filter-200.png` | `GET /api/cities?countryCode=ae`: lower-case filter accepted, returns Dubai only |
| `gen-12/04-gen12-cities-invalid-400.png` | `GET /api/cities?countryCode=EGY`: 400 `VALIDATION_FAILED` with a `countryCode` field error |
| `gen-12/05-gen12-currencies-200.png` | `GET /api/currencies`: the 7 distinct currencies of Countries.csv, JPY with 0 minor units |
