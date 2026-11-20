# Sprint 0 verification evidence

**Evidence only:** this branch is never merged. It holds the Swagger UI screenshots that the Sprint 0 pull requests (#1–#5) embed.

- **When and on what:** captured on 2026-11-08 from the stack tip (`docs/TRVL-134-traceability-erd-adrs`, which contains every Sprint 0 change).
- **How the app ran:** `NODE_ENV=development` with stub auth, against an in-memory MongoDB replica set. The team's Atlas `backend/.env` was not yet available.
- **How the screenshots were taken:** each one comes from a real Swagger "Try it out → Execute" run in Chrome.

| File | Requirement | What it shows |
|---|---|---|
| `sprint-0/01-swagger-operations.png` | TRVL-130 | Every operation is tagged and its summary starts with a requirement ID |
| `sprint-0/02-gen02-validation-400.png` | GEN-02, GEN-13 | Nested payload rejected with one `fieldErrors` entry per problem, including the unknown property `isAdmin` |
| `sprint-0/03-gen02-validation-200.png` | GEN-02 | A valid payload is accepted |
| `sprint-0/04-gen05-page3.png` | GEN-05 | `page=3` returns rows 21–23 with `{page, limit: 10, total: 23, totalPages: 3}` |
| `sprint-0/05-gen05-page-decimal-400.png` | GEN-05, GEN-02 | `page=1.5` passes Swagger's client check and the backend rejects it with one accurate message |
| `sprint-0/07-gen02-duplicate-409.png` | TRVL-130 | Duplicate key returns 409 `DUPLICATE_KEY` with the conflicting field |
| `sprint-0/08-gen02-invalid-id-400.png` | TRVL-130 | Malformed id returns 400 `INVALID_ID` |
| `sprint-0/09-gen13-password-hash.png` | GEN-13 | Two salted bcrypt hashes of the same password: different salts, both verify, wrong password fails, no plain text, cost 12 |
| `sprint-0/10-authorize-dialog.png` | TRVL-131, ACC-19 | `access_token` cookie scheme and the temporary localhost-only `dev-user` header |
| `sprint-0/11-gen13-user-on-admin-403.png` | GEN-13, ACC-11 | A USER calling an admin route gets 403 `FORBIDDEN` |
| `sprint-0/12-gen13-admin-200.png` | GEN-13, ACC-11 | An ADMIN calling the same route gets 200 |
| `sprint-0/13-gen13-moderator-whoami.png` | TRVL-131 | `@CurrentUser()` returns `{id, role, assignedProvider}` for a hotel moderator |
| `sprint-0/14-gen13-no-caller-401.png` | GEN-13 | No caller returns 401 `UNAUTHENTICATED` (deny by default) |
| `sprint-0/15-trvl128-health.png` | TRVL-128 | Public health check reports `db: up` and the replica set |
