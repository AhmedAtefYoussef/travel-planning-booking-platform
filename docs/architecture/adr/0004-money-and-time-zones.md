# ADR-0004: Integer minor-unit money and UTC instants with IANA zones

- Status: Accepted. Implemented in `common/utils/money.ts` and `common/utils/dates.ts` (TRVL-130).
- Requirements: PAY-04, ITN-18, FLT-03, GEN-06, FLT-09, HTL-10, ITN-05. Brief sections 6.4, 6.5 and 6.7.

## Money
- All prices, payments and refunds use one `PLATFORM_CURRENCY` (PAY-04). They are stored as **integers in minor units** (`amountMinor`, `priceMinor`). Floats never hold money.
- `toMinor` parses decimal strings and rejects extra decimals or inexact floats. `percentOfMinor` computes refunds in integer basis points and **rounds down**, so the platform never refunds more than the policy allows, and 100% is exact. `currencyExponent` knows that JPY has 0 decimals and KWD has 3, and rejects unknown codes.
- Itinerary budgets may use other currencies. They are converted for display only with daily cached rates (`convertMinor`, CURRENCY_SERVICE, ITN-18). Booking prices are never converted.

## Time
- Every instant is a UTC `Date` in MongoDB and an ISO string with `Z` in the API.
- Flight times are entered as **airport-local wall time** and converted with the airport's IANA zone from the reference data (`localToUtc`). Responses include local times for display (`utcToLocalIso`, GEN-06). Local times that do not exist, or that occur twice because of DST, are rejected rather than guessed.
- "Departure date" searches use the local calendar day of the origin airport (`localDayRangeUtc`, FLT-11).
- Calendar dates such as check-in/out, itinerary days and room nights are `YYYY-MM-DD` strings. Itinerary day *k* = `startDate + (k - 1)` (`addDays`, ITN-05).
- Cancellation tiers count **whole 24-hour periods** before departure or check-in (`daysBefore`).

## Consequences
Totals are exact, rounding is explicit and tested, and times stay correct across zones and DST. The frontend formats amounts and local times; it never computes them.
