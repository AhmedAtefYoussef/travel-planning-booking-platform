# Architecture

- [`erd.md`](erd.md): collections, references and indexes
- [`contracts.md`](contracts.md): cross-module tokens and interfaces (who implements and who consumes)
- [`adr/`](adr): architecture decision records
  - [0001 Auth cookies and sessions](adr/0001-auth-cookies-and-sessions.md)
  - [0002 Inventory concurrency](adr/0002-inventory-concurrency.md)
  - [0003 Payments and webhooks](adr/0003-payments-and-webhooks.md)
  - [0004 Money and time zones](adr/0004-money-and-time-zones.md)
  - [0005 MVC module boundaries](adr/0005-mvc-module-boundaries.md)

Module boundaries are enforced in CI by `backend/.dependency-cruiser.cjs` (see ADR-0005).
