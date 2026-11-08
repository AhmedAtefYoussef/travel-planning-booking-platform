// Runs in .github/workflows/pr-governance.yml. Reads the pull_request event payload and the list of
// changed files, applies pr-rules.mjs and writes the result to the job summary. Exit 1 on errors.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { evaluatePullRequest } from './pr-rules.mjs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const pr = event.pull_request;
const requirements = JSON.parse(readFileSync('docs/requirements/requirements.json', 'utf8')).requirements;

const changedFiles = execFileSync('git', ['diff', '--name-only', `${pr.base.sha}...${pr.head.sha}`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const { errors, warnings } = evaluatePullRequest({
  head: pr.head.ref,
  base: pr.base.ref,
  title: pr.title ?? '',
  body: pr.body ?? '',
  labels: (pr.labels ?? []).map((l) => l.name),
  changedFiles,
  knownIds: new Set(requirements.map((r) => r.id)),
  isBot: pr.user?.type === 'Bot',
  matrixExists: existsSync('docs/requirements/traceability.md'),
});

const lines = [
  `### PR governance: ${errors.length ? `${errors.length} problem(s)` : 'passed'}`,
  ...errors.map((e) => `- :x: ${e}`),
  ...warnings.map((w) => `- :warning: ${w}`),
  `\n<sub>${changedFiles.length} changed file(s) checked against ${requirements.length} workbook requirement IDs.</sub>`,
];
const out = lines.join('\n') + '\n';
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
for (const e of errors) console.log(`::error::${e}`);
for (const w of warnings) console.log(`::warning::${w}`);
process.exit(errors.length ? 1 : 0);
