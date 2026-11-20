# Swagger verification evidence: Malak's requirements (Budgets)

**Evidence only:** this branch is never merged. It holds the Swagger UI screenshots that Malak's budgets pull
requests link to (same convention as `docs/blog-swagger-evidence` and `docs/hotels-swagger-evidence`).

- **How the app ran:** the backend from `feature/ITN-18-budget-currency` (which contains ITN-16, ITN-14 and ITN-18) on
  16 Nov 2026, against a local demo database (`travel_demo`, a throwaway MongoDB replica set, not the team Atlas
  cluster), with real cookie login (`AUTH_STUB=false`), `PLATFORM_CURRENCY=USD` and the official reference data seeded.
- **How the screenshots were taken:** each one is a real Swagger UI "Try it out → Execute" run in a browser, driven
  by Claude Code (Playwright) and recorded as AI-assisted in `AI_PROMPTS.txt`. 22 runs, every one returned the
  expected status. Each image shows the request (parameters, body, curl) and the live server response.
- **Inserted by hand (no endpoint or network yet):**
  - The itinerary "Spring in Egypt and France" `6afb7a000000000000000001` of User A, private, starting 2027-03-01,
    day 1 Cairo `…0011` and day 2 Paris `…0012`, plus one activity on day 1 costing 250.00 EGP. The itinerary and
    activity endpoints (ITN-01, ITN-10) are Sarah's and not merged yet.
  - One cached exchange-rate day (`2026-11-16`, base USD: 1 USD = 50 EGP = 0.9 EUR), because the demo container
    cannot reach FXRatesAPI. The conversion itself is the team's `CURRENCY_SERVICE`, unchanged.
- **Accounts:** User A (`a@demo.com`) owns the itinerary; User B (`b@demo.com`) is another registered user.

## ITN-16 (TRVL-79) intercity transport costs

| File | What it shows |
|---|---|
| `itn-16/01-itn16-add-transport-201.png` | `POST /api/itineraries/{id}/transport-costs` as User A: flight Cairo → Paris on day 2, 270.00 EUR: 201 |
| `itn-16/02-itn16-same-city-400.png` | From and to the same city: 400 on `toCityId` |
| `itn-16/03-itn16-invalid-input-400.png` | Unknown mode, negative amount: 400 `VALIDATION_FAILED` |
| `itn-16/04-itn16-edit-200.png` | `PATCH /api/transport-costs/{id}`: mode TRAIN, 180.00 EUR: 200 |
| `itn-16/05-itn16-other-user-edits-404.png` | The same edit as User B: 404, as for an unknown id |
| `itn-16/06-itn16-delete-204.png` | `DELETE /api/transport-costs/{id}`: 204 |

## ITN-14 (TRVL-78) budget entries and totals by category and day

| File | What it shows |
|---|---|
| `itn-14/00-budgets-operations.png` | `GET /api/docs`: the Budgets section lists every budget operation |
| `itn-14/01-itn14-add-food-entry-201.png` | `POST /api/itineraries/{id}/days/{dayId}/budgets`: FOOD 500.00 EGP on day 1: 201 |
| `itn-14/02-itn14-add-accommodation-entry-201.png` | ACCOMMODATION 80.00 EUR on day 2: 201 |
| `itn-14/03-itn14-negative-amount-and-unknown-category-400.png` | Category SHOPPING, amount -1: 400 with errors on both |
| `itn-14/04-itn14-unsupported-currency-400.png` | Currency XYZ: 400 on `currency` |
| `itn-14/05-itn14-day-not-in-itinerary-404.png` | A day id that is not in the itinerary: 404 |
| `itn-14/06-itn14-edit-entry-200.png` | `PATCH /api/budgets/{id}`: accommodation changed to 90.00 EUR: 200 |
| `itn-14/07-itn14-delete-entry-204.png` | `DELETE /api/budgets/{id}`: 204 |
| `itn-14/08-itn14-summary-by-category-and-day-200.png` | `GET /api/itineraries/{id}/budget-summary`: totals in USD by category and by day, the activity cost under ACTIVITIES and the train under INTERCITY_TRANSPORT |
| `itn-14/09-itn14-other-user-adds-404.png` | Adding an entry as User B: 404 |
| `itn-14/10-itn14-other-user-summary-404.png` | The private itinerary's summary as User B: 404 |

## ITN-18 (TRVL-80) preferred currency with daily cached rates

| File | What it shows |
|---|---|
| `itn-18/01-itn18-summary-in-egp-200.png` | `?currency=EGP`: every total in EGP |
| `itn-18/01b-itn18-rate-date-and-rates-200.png` | The same response scrolled down: `rateDate` 2026-11-16 and the EUR rate used |
| `itn-18/02-itn18-set-preferred-currency-200.png` | `PATCH /api/users/me` with `preferredCurrency` EUR (ACC-09): 200 |
| `itn-18/03-itn18-summary-in-preferred-eur-200.png` | The summary with no `?currency`: in EUR, total 283.50 EUR |
| `itn-18/04-itn18-unsupported-currency-400.png` | `?currency=XYZ`: 400 on `currency` |
| `itn-18/05-itn18-no-cached-rate-503.png` | With a GBP entry and no cached GBP rate: 503 `EXCHANGE_RATE_UNAVAILABLE`, no made-up total |
