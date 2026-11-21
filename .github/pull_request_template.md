<!--
Title: Conventional Commit, e.g. "feat(flights): add round-trip search [FLT-12]".
Branch: feature/<REQ-ID>-<desc> or fix/<REQ-ID>-<desc> from the latest develop, targeting develop.
The "PR governance" check validates this description, so keep the headings below.
-->

## Summary
<!-- What changed and why, in one to three sentences. -->

## Requirements
Jira: TRVL-
Requirement IDs: <!-- e.g. FLT-22, GEN-11 (IDs from docs/requirements/requirements.json) -->

AI-assisted: no <!-- yes / no. If yes, add an entry to AI_PROMPTS.txt (brief section 11.1). -->

## How to test in Swagger (http://localhost:3000/api/docs)
<!-- Numbered steps a reviewer can follow: endpoint, x-dev-user / login, request body, expected status and response. -->
1.

## Checklist
<!-- Tick every item. If one does not apply, write "(N/A)" after it and tick it. -->
- [ ] Branch is from the latest `develop` and contains only related changes
- [ ] DTOs validated with class-validator; invalid input returns 400 with `fieldErrors` (GEN-02, GEN-13)
- [ ] Role, ownership or provider-scope checks enforced in the backend (ACC-11)
- [ ] Swagger: tagged, summary starts with the requirement ID, examples, 400/401/403/404/409 documented
- [ ] Unit or e2e tests cover the business rules; `npm test` and `npm run test:e2e` pass locally
- [ ] `docs/requirements/traceability.md` row updated
- [ ] No secrets, `.env` files, or raw card data committed
