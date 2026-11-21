// Opens the pull request for the current branch and then cites its number in the traceability matrix, so the
// PR-governance rule "the requirement row must cite this PR" passes on the first CI run instead of failing
// until someone pushes a follow-up commit (seen on #128, #129).
//
// Usage (from the repository root, on a feature branch that is pushed):
//   npm run pr:open -- --title "feat(itineraries): ... [ITN-25]" --body-file pr.md
// Any argument is passed straight to `gh pr create` (defaults: --base develop --fill when no title/body).
//
// Write "#PR" in the PR column of your requirement's row in docs/requirements/traceability.md while you
// work; after `gh pr create` returns, every "#PR" placeholder is replaced by the real "#<number>", committed
// as `docs(docs): cite #<n> in the traceability matrix [<REQ>]` and pushed.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { replacePrPlaceholder } from './pr-placeholder.mjs';

const MATRIX = 'docs/requirements/traceability.md';
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  }).trim();

const args = process.argv.slice(2);
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (['develop', 'main'].includes(branch)) {
  console.error(
    `Refusing to open a PR from ${branch}; create a feature/fix branch first.`,
  );
  process.exit(1);
}
const reqId = branch.match(/^(?:feature|fix)\/([A-Z]{3}-\d{2}[a-z]?)/)?.[1];

run('git', ['push', '-u', 'origin', branch]);
const hasBase = args.includes('--base') || args.includes('-B');
const hasText = args.some((a) =>
  ['--title', '-t', '--fill', '--body', '--body-file', '-F'].includes(a),
);
const url = run('gh', [
  'pr',
  'create',
  ...(hasBase ? [] : ['--base', 'develop']),
  ...(hasText ? [] : ['--fill']),
  ...args,
]);
const number = Number(url.match(/\/pull\/(\d+)/)?.[1]);
if (!number) {
  console.error(`Could not read the PR number from: ${url}`);
  process.exit(1);
}
console.log(`Opened ${url}`);

const before = readFileSync(MATRIX, 'utf8');
const { text, replaced } = replacePrPlaceholder(before, number);
if (!replaced) {
  console.log(`No "#PR" placeholder in ${MATRIX}; nothing to cite.`);
  process.exit(0);
}
writeFileSync(MATRIX, text);
run('git', ['add', MATRIX]);
run('git', [
  'commit',
  '-m',
  `docs(docs): cite #${number} in the traceability matrix${reqId ? ` [${reqId}]` : ''}`,
]);
run('git', ['push']);
console.log(`Cited #${number} in ${replaced} matrix row(s) and pushed.`);
