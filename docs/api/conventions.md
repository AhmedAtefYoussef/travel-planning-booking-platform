# API conventions (every module)

These come from the common layer (TRVL-130). Use them as-is; CI checks most of them.

## Errors (GEN-02)
Every error has the same body (`ErrorResponseDto`):

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "VALIDATION_FAILED",
  "message": "Validation failed",
  "fieldErrors": [{ "field": "passengers[0].dob", "message": "dob must be a valid ISO 8601 date string" }],
  "path": "/api/flight-bookings/hold",
  "timestamp": "2026-11-08T10:15:30.000Z"
}
```

- Validate input with class-validator DTOs. The global pipe rejects unknown properties (`whitelist` + `forbidNonWhitelisted`) and transforms payloads into DTO instances (GEN-13).
- For business-rule failures, throw `AppException(status, ErrorCode.X, message)` from `common/errors`. Add new codes to `error-codes.ts`. Do not invent ad-hoc error shapes.
- Mongo duplicate keys become 409 `DUPLICATE_KEY`, and invalid ids become 400 `INVALID_ID`. Guard every `:id` route with `ParseObjectIdPipe`.
- 5xx responses never expose internal messages. The details are logged on the server.

## Lists (GEN-05)
- Query DTOs extend `PaginationQueryDto`, which accepts `page` only (digits only). The page size is fixed at 10. A global middleware returns 400 for `limit`, `pageSize` or `perPage` (any casing or snake_case) on any route.
- Return `paginate(model, filter, query.page, { sort })`, or `toPage(items, total, page)` for aggregations.
- Document the endpoint with `@ApiPaginatedResponse(ItemDto)`.

## Swagger (Definition of Done)
- Add `@ApiTags('<Module>')` on the controller.
- Every `@ApiOperation({ summary })` starts with the requirement ID: `'FLT-11 Search one-way flights'`.
- Add `@ApiErrorResponses(400, 404, 409, ...)` for the statuses the route can return. Protected routes also need 401/403; `@Roles()` adds them automatically.

## Money and time
- Money is stored as integer minor units in `PLATFORM_CURRENCY` (PAY-04). Use `common/utils/money.ts` (`toMinor`, `percentOfMinor`, `convertMinor`) and never use floats.
- Instants are stored in UTC. Airport-local input and output goes through `common/utils/dates.ts` (`localToUtc`, `utcToLocalIso`, `localDayRangeUtc`). `localToUtc` rejects local times that do not exist or occur twice because of DST. Calendar dates are `YYYY-MM-DD` (`eachNight`, `addDays`).
