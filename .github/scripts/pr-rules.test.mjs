import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiAssisted,
  citedRequirementIds,
  classifyBranch,
  evaluatePullRequest,
  uncheckedChecklistItems,
} from './pr-rules.mjs';

const knownIds = new Set(['FLT-22', 'GEN-02', 'GEN-05', 'ACC-07a', 'GEN-01-B']);
const body = `## Summary
Adds the atomic seat hold so concurrent requests cannot oversell a cabin.

## Requirements
Jira: TRVL-42 - FLT-22

AI-assisted: no

## Checklist
- [x] Tests added
- [x] Swagger documented (N/A)
`;
const base = {
  head: 'feature/FLT-22-seat-hold',
  base: 'develop',
  title: 'feat(flight-bookings): atomic seat hold [FLT-22]',
  body,
  labels: [],
  changedFiles: [
    'backend/src/modules/flight-bookings/holds.service.ts',
    'docs/requirements/traceability.md',
  ],
  knownIds,
  matrixExists: true,
};
const errorsOf = (overrides) =>
  evaluatePullRequest({ ...base, ...overrides }).errors;

test('a well-formed feature PR passes', () => {
  assert.deepEqual(errorsOf({}), []);
});

test('branch classification follows brief section 10.3', () => {
  assert.equal(classifyBranch('feature/FLT-11-flight-search'), 'work');
  assert.equal(classifyBranch('fix/FLT-22-seat-hold-race-condition'), 'work');
  assert.equal(classifyBranch('feature/ACC-07a-admin-reset'), 'work');
  assert.equal(classifyBranch('feature/TRVL-132-contracts'), 'work');
  assert.equal(classifyBranch('docs/api-readme'), 'support');
  assert.equal(classifyBranch('release/v1.0.0-m1'), 'release');
  assert.equal(classifyBranch('my-branch'), null);
  assert.equal(classifyBranch('feature/flight-search'), null);
});

test('rejects bad branch names, unknown branch IDs and wrong merge direction', () => {
  assert.match(errorsOf({ head: 'ahmed-work' }).join(), /naming convention/);
  assert.match(
    errorsOf({ head: 'feature/ACC-03-register' }).join(),
    /not in the official workbook/,
  );
  assert.match(errorsOf({ base: 'main' }).join(), /must target develop/);
  assert.deepEqual(
    errorsOf({
      head: 'develop',
      base: 'main',
      body: body.replace('TRVL-42', ''),
    }),
    [],
  );
});

test('requires a Jira key and valid requirement IDs', () => {
  assert.match(
    errorsOf({ body: body.replace('TRVL-42', '') }).join(),
    /Jira issue key/,
  );
  assert.match(
    errorsOf({ body: body.replace('- FLT-22', '- FLT-22, ACC-03') }).join(),
    /Unknown requirement ID\(s\): ACC-03/,
  );
  assert.match(
    errorsOf({
      title: 'feat(flights): hold',
      body: body.replace('FLT-22', ''),
    }).join(),
    /at least one requirement ID/,
  );
});

test('requires a complete checklist and a summary', () => {
  assert.match(
    errorsOf({
      body: body.replace('- [x] Tests added', '- [ ] Tests added'),
    }).join(),
    /"Tests added"/,
  );
  assert.match(
    errorsOf({ body: body.replace('## Checklist', '## Notes') }).join(),
    /Checklist/,
  );
  assert.match(
    errorsOf({ body: body.replace(/Adds the atomic[^\n]+/, '') }).join(),
    /Summary/,
  );
});

test('blocks committed env files but allows .env.example', () => {
  assert.match(
    errorsOf({ changedFiles: [...base.changedFiles, 'backend/.env'] }).join(),
    /never be committed/,
  );
  assert.deepEqual(
    errorsOf({ changedFiles: [...base.changedFiles, '.env.example'] }),
    [],
  );
});

test('AI-assisted PRs must update AI_PROMPTS.txt', () => {
  const aiBody = body.replace('AI-assisted: no', 'AI-assisted: yes');
  assert.match(errorsOf({ body: aiBody }).join(), /AI_PROMPTS\.txt/);
  assert.deepEqual(
    errorsOf({
      body: aiBody,
      changedFiles: [...base.changedFiles, 'AI_PROMPTS.txt'],
    }),
    [],
  );
  assert.match(
    errorsOf({ body: body.replace('AI-assisted: no', '') }).join(),
    /AI-assisted: yes/,
  );
});

test('unit-spec-only module changes need no traceability update', () => {
  const changedFiles = ['backend/src/modules/flights/flights.service.spec.ts'];
  assert.deepEqual(errorsOf({ changedFiles }), []);
  // A spec plus real code still needs the matrix.
  const mixed = [
    ...changedFiles,
    'backend/src/modules/flights/flights.service.ts',
  ];
  assert.match(errorsOf({ changedFiles: mixed }).join(), /traceability\.md/);
});

test('module changes must update the traceability matrix unless labelled no-trace', () => {
  const changedFiles = ['backend/src/modules/flights/flights.service.ts'];
  assert.match(errorsOf({ changedFiles }).join(), /traceability\.md/);
  assert.deepEqual(errorsOf({ changedFiles, labels: ['no-trace'] }), []);
  assert.deepEqual(errorsOf({ changedFiles, matrixExists: false }), []);
});

test('bots skip description rules but not branch rules', () => {
  assert.deepEqual(
    errorsOf({ head: 'dependabot/npm_and_yarn/x', isBot: true, body: '' }),
    [],
  );
});

test('helpers parse the template', () => {
  assert.deepEqual(
    citedRequirementIds('FLT-22, GEN-01-B and ACC-07a; FLT-22'),
    ['FLT-22', 'GEN-01-B', 'ACC-07a'],
  );
  assert.deepEqual(
    uncheckedChecklistItems('## Checklist\n- [ ] a\n- [x] b\n## Next\n- [ ] c'),
    ['a'],
  );
  assert.equal(aiAssisted('AI-assisted: **yes**'), true);
  assert.equal(aiAssisted('nothing'), null);
});

test('template hints in HTML comments do not count as content', async () => {
  const { readFileSync } = await import('node:fs');
  const template = readFileSync(
    new URL('../pull_request_template.md', import.meta.url),
    'utf8',
  );
  const errors = errorsOf({
    title: 'feat(flights): add search',
    body: template,
    changedFiles: [],
  }).join('\n');
  assert.match(errors, /Jira issue key/);
  assert.match(errors, /at least one requirement ID/);
  assert.match(errors, /Summary/);
  assert.match(errors, /Unchecked checklist/);
});

test('stripHtmlComments removes nested and unterminated comments', async () => {
  const { stripHtmlComments } = await import('./pr-rules.mjs');
  assert.equal(stripHtmlComments('a<!-- x -->b'), 'ab');
  assert.equal(stripHtmlComments('a<!<!-- -->-- hidden -->b'), 'ab');
  assert.equal(stripHtmlComments('a<!-- never closed'), 'a');
  assert.equal(stripHtmlComments(undefined), '');
});

test('traceability check finds missing, unknown and duplicate rows', async () => {
  const { traceabilityProblems } = await import('./check-traceability.mjs');
  const ids = new Set(['FLT-22', 'GEN-01-B']);
  assert.deepEqual(
    traceabilityProblems('| FLT-22 | x |\n| GEN-01-B | y |', ids),
    [],
  );
  assert.deepEqual(
    traceabilityProblems('| FLT-22 | x |\n| FLT-22 | y |\n| ACC-03 | z |', ids),
    [
      'GEN-01-B has no row',
      'FLT-22 has 2 rows',
      'ACC-03 is not a workbook requirement',
    ],
  );
});

const warningsOf = (overrides) =>
  evaluatePullRequest({ ...base, ...overrides }).warnings;
const matrixWith = (row) =>
  `| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |\n|---|---|---|---|---|---|---|\n${row}\n`;

test('the requirement row must cite this PR once module code changes', () => {
  const stale = matrixWith(
    '| FLT-22 | Mandatory | POST /api/flight-bookings/hold | Ahmed | TRVL-42 | - | Not started |',
  );
  const cited = matrixWith(
    '| FLT-22 | Mandatory | POST /api/flight-bookings/hold | Ahmed | TRVL-42 | #31 | Done |',
  );
  assert.match(
    errorsOf({ number: 31, matrixText: stale }).join(),
    /FLT-22 row .* must cite this PR: add "#31"/,
  );
  assert.deepEqual(errorsOf({ number: 31, matrixText: cited }), []);
  assert.match(
    errorsOf({ number: 3, matrixText: cited }).join(),
    /add "#3"/,
    '#31 does not count as #3',
  );
  assert.deepEqual(
    errorsOf({ number: 31, matrixText: stale, labels: ['no-trace'] }),
    [],
  );
});

test('the AI prompt log is append-only unless labelled ai-log-fix', () => {
  const appended =
    '--- a/AI_PROMPTS.txt\n+++ b/AI_PROMPTS.txt\n@@ -40,0 +41,3 @@\n+\n+=====\n+Date: 2026-11-11\n';
  const edited =
    '--- a/AI_PROMPTS.txt\n+++ b/AI_PROMPTS.txt\n@@ -12 +12 @@\n-Student: Joudy Khaled Hagar\n+Student: Someone Else\n';
  const newline = '@@ -40 +40,2 @@\n-last line\n+last line\n+next entry\n';
  const files = [...base.changedFiles, 'AI_PROMPTS.txt'];
  assert.deepEqual(errorsOf({ changedFiles: files, aiLogDiff: appended }), []);
  assert.deepEqual(
    errorsOf({ changedFiles: files, aiLogDiff: newline }),
    [],
    'a re-added identical line is not an edit',
  );
  assert.match(
    errorsOf({ changedFiles: files, aiLogDiff: edited }).join(),
    /append-only.*"Student: Joudy Khaled Hagar"/,
  );
  assert.deepEqual(
    errorsOf({
      changedFiles: files,
      aiLogDiff: edited,
      labels: ['ai-log-fix'],
    }),
    [],
  );
});

test('commits that only cite other requirements warn about a stacked PR', () => {
  const stacked = [
    'feat(hotels): define room availability [FLT-22]',
    'feat(hotels): add a room [HTL-03]',
    'feat(hotels): hotel schemas [TRVL-140]',
  ];
  const warnings = warningsOf({ commitSubjects: stacked });
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /2 commit\(s\) cite only requirements this PR does not mention, e\.g\. "feat\(hotels\): add a room \[HTL-03\]"/,
  );
  assert.deepEqual(
    warningsOf({
      commitSubjects: [
        'fix(flight-bookings): release seats [FLT-22]',
        'test: more cases',
      ],
    }),
    [],
  );
  assert.deepEqual(
    warningsOf({
      commitSubjects: stacked,
      body: base.body.replace(
        'AI-assisted: no',
        'Also finishes HTL-03 and TRVL-140.\n\nAI-assisted: no',
      ),
    }),
    [],
    'IDs the description cites are part of this PR',
  );
});

test('matrix statuses use the documented words, cite PRs, and are not left "In review" after merge', async () => {
  const { traceabilityProblems } = await import('./check-traceability.mjs');
  const ids = new Set(['FLT-01', 'FLT-02', 'FLT-03', 'FLT-04', 'FLT-05']);
  const md = matrixWith(
    [
      String.raw`| FLT-01 | Mandatory | GET\|PATCH /api/airlines/:id | Joudy | TRVL-28 | #9 | Done |`,
      '| FLT-02 | Mandatory | GET /api/airports | Joudy | TRVL-29 | #7 | In review |',
      '| FLT-03 | Mandatory | POST /api/flights | Joudy | TRVL-30 | - | Done |',
      '| FLT-04 | Mandatory | POST /api/flights/:id/cabins | Joudy | TRVL-31 | #11 | Finished |',
      '| FLT-05 | Mandatory | PATCH /api/flights/:id | Joudy | TRVL-32 | #18 | Partial: notifications pending |',
    ].join('\n'),
  );
  assert.deepEqual(traceabilityProblems(md, ids, new Set([7, 9])), [
    'FLT-02 (line 4): still "In review" but #7 merged; set Done or "Partial: ..."',
    'FLT-03 (line 5): status "Done" needs the PR number(s) in the PR column',
    'FLT-04 (line 6): status "Finished" must be Not started, In progress, In review, Done or "Partial: <what is done>"',
  ]);
});
