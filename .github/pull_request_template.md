## What

<!-- One or two sentences. Requirement IDs, e.g. PAY-01, TRVL-129 -->

## Why

## How to verify

<!-- Swagger steps or test names -->

## Checklist

- [ ] Branch is `feature/<ID>-...` or `fix/<ID>-...` off `develop`
- [ ] Commits follow Conventional Commits with `[ID]`
- [ ] `npm run build`, `npm run lint` and `npm test` pass in `backend/`
- [ ] Unit tests for business rules; e2e for new endpoints where relevant
- [ ] Money is integer minor units in `PLATFORM_CURRENCY`
- [ ] Only the agreed contracts in `common/contracts` are used across modules
- [ ] No secrets, `.env` or personal data committed
- [ ] Swagger updated for new or changed endpoints
