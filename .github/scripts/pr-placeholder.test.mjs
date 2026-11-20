import assert from 'node:assert/strict';
import { test } from 'node:test';
import { traceabilityProblems } from './check-traceability.mjs';
import { replacePrPlaceholder } from './pr-placeholder.mjs';

const header =
  '| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |\n|---|---|---|---|---|---|---|\n';

test('replaces every #PR placeholder in matrix rows only', () => {
  const md =
    header +
    '| GEN-09 | Mandatory | POST /api/reports | Ahmed | TRVL-104 | #106, #PR | Done |\n' +
    '| GEN-10 | Mandatory | x | Ahmed | TRVL-105 | #PR | Done |\n' +
    'Write #PR while you work.\n';
  const { text, replaced } = replacePrPlaceholder(md, 131);
  assert.equal(replaced, 2);
  assert.match(text, /#106, #131 \| Done/);
  assert.match(text, /TRVL-105 \| #131 \|/);
  assert.match(text, /Write #PR while you work/, 'prose is left alone');
});

test('does not touch #PRs or #PR1', () => {
  const md = header + '| GEN-09 | M | x | A | T | #PRs, #PR1 | Done |\n';
  assert.equal(replacePrPlaceholder(md, 5).replaced, 0);
});

test('check-traceability rejects a #PR placeholder left in a row', () => {
  const md =
    header +
    '| GEN-09 | Mandatory | x | Ahmed | TRVL-104 | #106, #PR | Done |\n';
  const problems = traceabilityProblems(md, new Set(['GEN-09']));
  assert.match(problems.join(), /GEN-09 .*"#PR" placeholder/);
});
