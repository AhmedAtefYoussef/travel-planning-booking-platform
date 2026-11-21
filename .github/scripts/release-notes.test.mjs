import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseNotes, parseMergeCommit } from './release-notes-lib.mjs';

const knownIds = new Set(['FLT-05', 'FLT-11', 'GEN-13', 'ACC-07a']);

test('a PR merge commit is parsed; other commits are ignored', () => {
  assert.deepEqual(
    parseMergeCommit(
      'Merge pull request #18 from AhmedAtefYoussef/feature/FLT-05-edit-flight',
      '\nfeat(flights): edit flights [FLT-05]\n',
    ),
    {
      number: 18,
      branch: 'feature/FLT-05-edit-flight',
      title: 'feat(flights): edit flights [FLT-05]',
    },
  );
  assert.equal(
    parseMergeCommit("Merge branch 'develop' into feature/x", ''),
    null,
  );
  assert.equal(parseMergeCommit('feat(flights): not a merge', ''), null);
});

test('notes group PRs by type and list the requirements they touched', () => {
  const prs = [
    {
      number: 27,
      branch: 'refactor/common-validation-helpers',
      title: 'refactor(common): share rules [GEN-13]',
    },
    {
      number: 18,
      branch: 'feature/FLT-05-edit-flight',
      title: 'feat(flights): edit flights [FLT-05]',
    },
    {
      number: 13,
      branch: 'feature/FLT-11-flight-search',
      title: 'feat(flights): search flights [FLT-11]',
    },
    {
      number: 26,
      branch: 'docs/ai-prompts-hygiene',
      title: 'fix(docs): repair the log [TRVL-135]',
    },
    { number: 30, branch: 'develop', title: 'chore(release): v1.0.0-m1' },
  ];
  const notes = buildReleaseNotes(prs, {
    tag: 'v1.0.0-m1',
    previousTag: null,
    knownIds,
  });
  assert.match(
    notes,
    /^## v1\.0\.0-m1\n\n4 pull requests merged since the start of the project to v1\.0\.0-m1\./,
  );
  assert.match(
    notes,
    /### Features\n- \*\*flights:\*\* edit flights \[FLT-05\] \(#18\)\n- \*\*flights:\*\* search flights \[FLT-11\] \(#13\)/,
  );
  assert.match(
    notes,
    /### Fixes\n- \*\*docs:\*\* repair the log \[TRVL-135\] \(#26\)/,
  );
  assert.ok(notes.indexOf('### Features') < notes.indexOf('### Fixes'));
  assert.ok(notes.indexOf('### Fixes') < notes.indexOf('### Refactoring'));
  assert.match(
    notes,
    /\| FLT-05 \| #18 \|\n\| FLT-11 \| #13 \|\n\| GEN-13 \| #27 \|/,
  );
  assert.match(notes, /Jira tasks: TRVL-135/);
  assert.doesNotMatch(
    notes,
    /chore\(release\)/,
    'the develop-to-main release merge is not listed',
  );
});

test('unknown IDs and non-conventional titles do not break the notes', () => {
  const prs = [
    { number: 5, branch: 'feature/ACC-03-x', title: 'Hotel backend [ACC-03]' },
  ];
  const notes = buildReleaseNotes(prs, {
    tag: 'v2',
    previousTag: 'v1',
    knownIds,
  });
  assert.match(notes, /merged since v1\.\.\.v2/);
  assert.match(notes, /### Other changes\n- Hotel backend \[ACC-03\] \(#5\)/);
  assert.doesNotMatch(notes, /Requirements touched/);
});
