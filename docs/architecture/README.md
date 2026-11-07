# Architecture

- `erd.md`: collections, references and indexes (TRVL-134)
- `adr/`: architecture decision records, one per major decision (TRVL-134)

Module boundaries enforced by CI (`backend/.dependency-cruiser.cjs`):
controller -> service -> model; modules talk only through `common/contracts` tokens or a module's `index.ts`;
`common/` never imports from `modules/`.
