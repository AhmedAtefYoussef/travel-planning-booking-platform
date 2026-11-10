# Pull request review checklist

Authors: check your own diff against this list before you ask for a review. Reviewers: work through it in order and paste the numbers of failed items into one review comment. Every item comes from a bug found in an earlier review on this repo.

## 1. Shape of the PR
1. **One requirement or one task.** Under about 800 changed lines, excluding `package-lock.json`.
2. **Based on the latest `develop` and targeting `develop`.** It isn't stacked on another feature branch, and it doesn't repeat commits that belong to another open PR.
3. **All 12 required checks are green.** Don't review a red PR; ask the author to fix CI first.
4. **The PR updates its own bookkeeping:**
   - the template is filled in
   - `AI_PROMPTS.txt` has the entry, appended at the bottom
   - the traceability row is updated
   - the Jira issue is In Progress, with the PR link

## 2. Validation (GEN-02, GEN-13)
5. **PATCH DTOs use `@Omittable()`,** not `@IsOptional()` or `PartialType`. Check: `{"field": null}` returns 400 and is not saved.
6. **Whole numbers use `@IsWholeNumber(...)` in DTOs and `safeInteger(...)` in schemas.** Never `@IsInt()` or `Number.isInteger`; the architecture job fails on them. Check: `1e20` returns 400.
7. **Limits come from the workbook only.** Any extra cap is documented in the DTO and the PR.
8. **Atomic updates pass `runValidators: true`.** `$inc` amounts are guarded in the filter, e.g. `{ seatsAvailable: { $gte: n } }`.

## 3. Data model
9. **Every schema of the module is registered in `MongooseModule.forFeature`.** Otherwise its indexes, including unique ones, are never built.
10. **Schemas follow `common/contracts/conventions.ts`:**
    - `...SCHEMA_OPTIONS`
    - `isActive` (not `active`)
    - references are `MongooseSchema.Types.ObjectId`
    - money is in integer minor units
    - instants are in UTC
11. **Uniqueness comes from a unique index,** never from a find-then-insert check. Inventory follows ADR-0002: an atomic `$inc` for flight seats, and unique `room_nights {roomId, date}` inside a transaction for hotels.
12. **The schema matches `docs/architecture/erd.md`,** or the PR updates the ERD.

## 4. Access control (ACC-11)
13. **Guest routes are explicitly `@Public()`.** Everything else is protected. The CI job summary lists every public route; confirm each one.
14. **Ownership and provider scope are checked in the service after loading the resource** (`assertOwner`, `assertProviderScope`). Check: another user, or another provider's moderator, gets 403.
15. **Provider ids are never taken from the request body.** They come from `@CurrentUser().assignedProvider`.

## 5. Behaviour and tests
16. **Each business rule from the Jira acceptance criteria has a unit or e2e test.** That includes the edge cases: boundaries (00:00 local time, exactly at the threshold), the empty result, 404, 409, and inactive providers.
17. **Time zones:** local input is converted with `common/utils/dates`. DST gaps and ambiguous times are rejected.
18. **The reviewer has run the main happy path and one rejection in Swagger,** or the PR has evidence (screenshots or a pasted response).

## 6. Docs and API
19. **Swagger:**
    - `@ApiTags`
    - a summary that starts with the requirement ID
    - `@ApiErrorResponses(...)` for every error the route can return
    - `@ApiPaginatedResponse` for lists (page size 10 only, GEN-05)
20. **A new or changed cross-module token** is reflected in `docs/architecture/contracts.md`.

## Writing the review
- **One summary comment:** blockers first, then the rest; each one with the file and line, what's wrong, and how to fix it.
- **Mark what's optional** as "nit".
- **Approve** when only nits are left.
- **Reply within 24 hours.** If you can't, say so and suggest another reviewer.
