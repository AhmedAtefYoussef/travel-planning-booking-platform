# ADR-0005: MVC layering and feature-module boundaries enforced in CI

- Status: Accepted (Sprint 0).
- Requirements: brief section 1.1 (MVC, feature-based NestJS modules), GEN-13.

## Decision
- **Model:** Mongoose schemas and services under `backend/src/modules/<feature>/`. **Controller:** NestJS controllers that validate input (DTOs), delegate to services and shape responses. **View:** Next.js in `frontend/` (Milestone 2).
- Controllers never import schemas or Mongoose. All database access and business rules live in services, so they apply whatever the caller (GEN-13).
- A module imports another module only through its `index.ts` or through **contract tokens** in `common/contracts` (`docs/architecture/contracts.md`). `common/` never imports from `modules/`.
- Cross-cutting behaviour is global and registered once in `CommonModule`: validation pipe, error filter, auth and role guards, and the GEN-05 page-size middleware.

## Enforcement
`backend/.dependency-cruiser.cjs` runs in the `architecture` CI job. It forbids:
- controller to schema or Mongoose imports
- reaching into another module's internals
- `common` to `modules` imports
- circular imports
- test code in the app

The `openapi-contract` job checks that every endpoint is tagged, cites a workbook requirement ID, and documents its error responses.

## Consequences
Seven people can work in parallel with few merge conflicts. Replacing an implementation, such as the stub auth guard, does not touch its consumers.
