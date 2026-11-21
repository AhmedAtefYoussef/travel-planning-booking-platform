# Contributing

This guide is the team's working agreement for brief section 10 (Git and GitHub workflow) and section 11 (AI usage). CI enforces the branch, commit, PR-template, traceability, AI-log and quality rules below, so a PR that breaks one cannot merge. The Definition of Done and the [review checklist](docs/process/review-checklist.md) are checked in review. The team leader (@AhmedAtefYoussef) is the only reviewer and the only person who merges.

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
   Open it with `npm run pr:open -- --title "<conventional title>" --body-file <file>` (from the repository root). Write `#PR` in your requirement's PR column of `docs/requirements/traceability.md` while you work: the script opens the PR, replaces `#PR` with the real number, commits and pushes, so `pr-governance` passes on the first run. A `#PR` left behind fails the matrix check.
2. These checks must pass:

| Check | What it verifies |
|---|---|
| `pr-governance` | PR title and every commit are Conventional Commits; branch name; merge direction; Jira key and valid requirement IDs; complete template; no `.env` files; AI_PROMPTS.txt updated when AI was used; `traceability.md` updated when module code changes; no leftover merge-conflict markers; every AI_PROMPTS.txt entry well-formed, and existing entries never edited (append-only); the requirement's matrix row cites this PR; matrix statuses use the documented words and are not left `In review` after merge; no broken relative links in Markdown files; a warning when commits cite requirements the PR does not (a stacked or cumulative PR) |
| `backend-quality` | Prettier, ESLint with zero warnings, TypeScript, build |
| `backend-test` | Unit tests with coverage thresholds, e2e tests against an in-memory MongoDB replica set |
| `openapi-contract` | Every endpoint is tagged, its summary starts with a valid requirement ID, it documents 400/401/403/404 where relevant, and no list endpoint takes a page-size parameter (GEN-05) |
| `architecture` | Controllers never touch models (MVC); modules only use each other's public `index.ts` or `common/contracts`; no tokens in browser storage, raw card data, hard-coded secrets or unsafe integer checks; `.github/scripts` formatted with Prettier. Also runs when only `.github` changes, so a new rule is tested against the code |
| `secrets-scan`, `dependency-review`, `dependency-audit`, `codeql` | Secret leaks, vulnerable or GPL dependencies, code scanning |

3. Request a review from the team leader (@AhmedAtefYoussef). They are the only reviewer, the only approval that counts (CODEOWNERS), and the only person who merges. **Do not press Merge yourself**, even when the PR shows as mergeable. Check your own diff against [docs/process/review-checklist.md](docs/process/review-checklist.md) before you ask, and resolve every important comment. Merges use **"Create a merge commit"** (what the history uses since #1). Sync your branch with `git pull --rebase origin develop` rather than merging `develop` into it, so the history does not fill with "bring develop into this branch" commits.
4. Add the label `no-trace` only for pure refactors that change no requirement behaviour.
5. Keep PRs small and open them early: one requirement per PR, opened within a day of starting. Never stack a PR on another feature branch: CI, CodeQL and gitleaks only run for PRs into `develop` or `main`.
6. Automation you will see on your PR:
   - **Mergeability**: when `develop` moves or your PR is updated, a PR that conflicts with its base gets the `needs-rebase` label and one comment listing the conflicting files and the commands to fix them. Both disappear once it merges cleanly.
   - **Jira sync**: every `TRVL-<n>` key in the title, branch or `Jira:` line gets a comment with the PR link. The issue moves To Do → In Progress when the PR opens. On merge into `develop` it moves → Done only if the PR closes it with a keyword (`Closes TRVL-42`, `Fixes: TRVL-3, TRVL-4`, `Resolves TRVL-9`, in the title or body) and the body does not mark that key `Partial`; a key that is only cited gets the comment and keeps its status. It needs the repository secrets `JIRA_BASE_URL`, `JIRA_USER_EMAIL` and `JIRA_API_TOKEN`, an API token from https://id.atlassian.com/manage-profile/security/api-tokens. Without them it only logs a notice.
   - **Stale branches** (weekly): one issue labelled `stale-branches` lists branches merged into `develop`, or idle 14+ days with no open PR. Nothing is deleted automatically.
