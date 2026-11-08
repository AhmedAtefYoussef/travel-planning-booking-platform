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

## Authentication and authorization (TRVL-131, GEN-13, ACC-11)
- **Every route requires a signed-in caller by default.** Mark guest routes with `@Public()`, such as searches and published posts (brief section 4). CI lists every public route in the job summary so reviewers can check them.
- `@Roles(Role.Admin)`, `@Roles(Role.User, Role.Admin)`, or `@Roles()` for any signed-in account. It can go on the controller or the method, and method-level metadata always wins: a `@Roles()` method stays protected even inside a `@Public()` controller. It also documents cookie auth and the 401/403 responses.
- `@CurrentUser() user: AuthUser` gives `{ id, role, assignedProvider? }`.
- Ownership and provider scope are checked in **services** after loading the resource, using `common/auth/access.ts`:
  - `assertOwner(user, booking.userId, { bypassRoles: [Role.Admin] })` for private bookings and itineraries
  - `assertProviderScope(user, ProviderType.Hotel, room.hotelId)` so moderators manage only their assigned provider
- **Temporary stub (until ACC-11):** with `AUTH_STUB=true` (never in production), send the header `x-dev-user: ROLE[:userId[:providerId]]` from localhost (other hosts get 401), for example `ADMIN`, `USER:<userId>` or `HOTEL_MODERATOR:<userId>:<hotelId>`. In Swagger, click **Authorize** and fill in `dev-user`. Module code does not change when the real cookie guard replaces the stub.
- Passwords: inject `PasswordService` and call `hash()` / `verify()`. It uses bcrypt (cost 12) with a per-hash salt and rejects passwords over 72 bytes. Never store or log plain passwords.

## Checking your Atlas connection (TRVL-128)
From `backend/`, run `npm run db:check`. It prints the cluster host, replica set and transaction support, and never the credentials. With the app running, `GET /api/health` (public) reports `db: up`.
