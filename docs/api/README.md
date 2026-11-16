# API documentation

The live contract is Swagger UI at `http://localhost:3000/api/docs` (brief section 7.1: the backend is
evaluated through Swagger).

| File | What it is |
|---|---|
| [demo-script.md](demo-script.md) | The Swagger call order per role (Administrator, Airline moderator, Hotel moderator, Traveller) with bodies and expected statuses. Start here for the Milestone 1 demo. |
| [openapi.json](openapi.json) | The exported OpenAPI 3 document, for reading without running the API. |
| [conventions.md](conventions.md) | Rules every module follows: errors, validation, pagination, authentication, Swagger. |

`openapi.json` is a snapshot: refresh it with `npm run openapi:export` (in `backend/`) and commit it at release
time. It does not fail CI when it lags behind the code; the checked contract is the one CI generates on every PR
(`npm run openapi:generate` then `npm run openapi:check`, published as the `openapi` workflow artifact).
