# Contributing

This guide is the team's working agreement for brief section 10 (Git and GitHub workflow) and section 11 (AI usage). CI enforces every rule below, so a PR that breaks one cannot merge.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Stable milestone releases only. Receives merges from `develop` (or `release/*`, `hotfix/*`). |
| `develop` | Integration branch. Every feature PR targets it. |
| `feature/<REQ-ID>-<desc>` | New work for one requirement, e.g. `feature/FLT-11-flight-search` |
| `fix/<REQ-ID>-<desc>` | Bug fix, e.g. `fix/FLT-22-seat-hold-race-condition` |
| `refactor/<desc>`, `docs/<desc>`, `chore/<desc>`, `ci/<desc>`, `test/<desc>` | Supporting work |

`<REQ-ID>` must be an ID from the official workbook (see `docs/requirements/requirements.json`, e.g. `ACC-07a`, `GEN-01-B`) or the Jira key (`TRVL-132`) for setup tasks.

```bash
git checkout develop && git pull origin develop
git checkout -b feature/FLT-11-flight-search
# ...work, commit...
git push -u origin feature/FLT-11-flight-search
```

Sync with `develop` often (`git pull --rebase origin develop`). Resolve conflicts carefully and never drop a teammate's work.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) with a module scope, plus the requirement ID at the end:

```
feat(flights): add round-trip search [FLT-12]
fix(hotel-bookings): prevent double booking of a room night [HTL-18]
docs(api): document booking endpoints
```

The allowed scopes are listed in `commitlint.config.cjs`. The husky `commit-msg` hook rejects vague messages such as `update` or `fix` before they reach GitHub, and the `pre-commit` hook formats and lints the files you staged.

## Pull requests

1. Open the PR into `develop` and fill in every section of the template: Summary, Jira key, requirement IDs, `AI-assisted: yes/no`, Swagger test steps, and the checklist.
2. These checks must pass:

| Check | What it verifies |
|---|---|
| `pr-governance` | PR title and every commit are Conventional Commits; branch name; merge direction; Jira key and valid requirement IDs; complete template; no `.env` files; AI_PROMPTS.txt updated when AI was used; `traceability.md` updated when module code changes; no leftover merge-conflict markers; every AI_PROMPTS.txt entry well-formed |
| `backend-quality` | Prettier, ESLint with zero warnings, TypeScript, build |
| `backend-test` | Unit tests with coverage thresholds, e2e tests against an in-memory MongoDB replica set |
| `openapi-contract` | Every endpoint is tagged, its summary starts with a valid requirement ID, it documents 400/401/403/404 where relevant, and no list endpoint takes a page-size parameter (GEN-05) |
| `architecture` | Controllers never touch models (MVC); modules only use each other's public `index.ts` or `common/contracts`; no tokens in browser storage, raw card data or hard-coded secrets |
| `secrets-scan`, `dependency-review`, `dependency-audit`, `codeql` | Secret leaks, vulnerable or GPL dependencies, code scanning |

3. The team leader reviews (CODEOWNERS). Resolve the important comments, then merge with "Squash and merge" so `develop` keeps one Conventional Commit per PR.
4. Add the label `no-trace` only for pure refactors that change no requirement behaviour.

## Definition of Done (every Jira story)

- DTOs validated with class-validator; invalid input returns 400 with `fieldErrors` (GEN-02, GEN-13)
- Role, ownership or provider-scope checks enforced in the backend (ACC-11)
- Swagger: tagged, summary starts with the requirement ID, request/response examples, 400/401/403/404/409 documented
- Unit or e2e test covers the business rule
- Demoed in Swagger during PR review; PR references the Jira key and requirement ID; merged to `develop`
- `docs/requirements/traceability.md` row updated; `AI_PROMPTS.txt` entry added if AI materially helped

## AI usage (brief section 11)

AI tools are allowed, and their use must be recorded. Add an entry to `AI_PROMPTS.txt` for every prompt that materially shaped your code, in the format at the top of that file, and set `AI-assisted: yes` in your PR. Never paste credentials, connection strings or `.env` contents into an AI tool. You must be able to explain every line you submit.

Append your entry at the bottom of `AI_PROMPTS.txt` and never edit someone else's entry. Your local Git merges the file with `merge=union` (`.gitattributes`): when you sync with `git pull origin develop` or a rebase, two entries appended by different PRs are both kept instead of conflicting. GitHub's web merge may still flag the file, so sync locally before you ask for a merge. Check the log before you push with `node .github/scripts/check-repo-hygiene.mjs`. It fails when an entry is missing a field, an entry got kept twice, or a merge left conflict markers anywhere in the repo.
