# ADR-004: Money as integer minor units, time as UTC

Status: Accepted (Milestone 1). Requirements: FLT-03, FLT-11, GEN-06, PAY-04, ITN-18.

## Context

Floating-point prices produce rounding errors, flights cross time zones and daylight-saving changes, and itinerary budgets need several currencies.

## Decision

- Money is an integer in minor units (USD cents) in every field and API payload, named `*Minor`. Helpers live in `src/common/utils/money.ts`. Bookings, payments and refunds use one platform currency, `PLATFORM_CURRENCY` (USD).
- Itinerary budgets accept any supported currency (EGP, AED, GBP, USD, EUR, JPY, SAR) and are converted to the user's preferred currency by the currency module. Rates come from FXRatesAPI once a day, are stored in `exchange_rates` with their `rateDate`, and the last cached snapshot is used if the API fails. `GET /api/currencies/rates` exposes them; no rates ever cached yields 503.
- Every instant is stored in UTC. Flights are entered and searched in each airport's local time using the airport's IANA zone and Luxon; the stored `departLocalDate` backs the unique `{airlineId, flightNumber, departLocalDate}` index. "Days remaining" for refunds is computed in the zone of the service location (`daysRemaining` in `src/common/utils/dates.ts`).

## Consequences

- No float arithmetic on prices; conversion rounds once, at the edge.
- Clients receive UTC instants and format them for display; the API adds local dates where the plan needs them.
- Rates may be up to a day old, so responses carry `rateDate`.
