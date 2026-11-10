import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiPromptLogErrors,
  conflictMarkerLines,
  SEPARATOR,
} from './repo-hygiene.mjs';

const header = [
  'AI PROMPT LOG',
  '',
  'Entry format:',
  SEPARATOR,
  'Date: YYYY-MM-DD',
  SEPARATOR,
  '',
];
const entry = (over = {}) =>
  [
    SEPARATOR,
    over.date ?? 'Date: 2026-11-10',
    'Student: Test Student',
    'Tool: Claude Code',
    'Related Requirement: FLT-22',
    'Prompt:',
    'Do the thing.',
    'How the output was used:',
    'Kept it.',
    SEPARATOR,
    '',
  ].filter((l) => l !== null);
const log = (...entries) => [...header, ...entries.flat()].join('\n');

test('a well-formed log has no errors', () => {
  assert.deepEqual(aiPromptLogErrors(log(entry(), entry())), []);
});

test('an entry that lost its header is reported', () => {
  const broken = entry().filter((l) => !/^(Date|Student|Tool):/.test(l));
  const errors = aiPromptLogErrors(log(entry(), broken));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing Date:, Student:, Tool:/);
});

test('two entries run together without a separator are reported', () => {
  const first = entry().slice(0, -2); // drop the closing separator and the blank line
  const errors = aiPromptLogErrors(log(first, entry().slice(1)));
  assert.ok(
    errors.some((e) => /appears twice|start of another entry/.test(e)),
    errors.join('\n'),
  );
});

test('a wrong-length separator and a bad date are reported', () => {
  const long = entry();
  long[long.length - 2] = '='.repeat(80);
  const errors = aiPromptLogErrors(
    log(entry({ date: 'Date: 10/11/2026' }), long, entry()),
  );
  assert.ok(errors.some((e) => /Date must be YYYY-MM-DD/.test(e)));
  assert.ok(errors.some((e) => /exactly 48/.test(e)));
});

test('text between entries is reported', () => {
  assert.match(
    aiPromptLogErrors(log(entry(), ['stray line'], entry()))[0],
    /outside an entry/,
  );
});

test('conflict markers are found, separators and Markdown rules are not', () => {
  const text = [
    'a',
    '<<<<<<< HEAD',
    'b',
    '=======',
    'c',
    '>>>>>>> feature/x',
    SEPARATOR,
    '---',
    '===',
  ].join('\n');
  assert.deepEqual(conflictMarkerLines(text), [2, 4, 6]);
});

test('a seven-character heading underline is not a conflict marker', () => {
  const text = ['Install', '=======', '', 'Run npm ci.'].join('\n');
  assert.deepEqual(conflictMarkerLines(text, 'docs/setup/README.md'), []);
  // Outside Markdown a lone middle marker is what a half-resolved conflict leaves behind.
  assert.deepEqual(conflictMarkerLines(text, 'AI_PROMPTS.txt'), [2]);
});

test('a marker on the first line is found even after a byte order mark', () => {
  assert.deepEqual(conflictMarkerLines('\uFEFF<<<<<<< HEAD\nx'), [1]);
});

test('pasted text inside the prompt is not read as fields or separators', () => {
  const pasted = entry();
  pasted.splice(
    6,
    0,
    'Tool: the CLI flag',
    'Prompt: as written',
    '='.repeat(60),
  );
  assert.deepEqual(aiPromptLogErrors(log(pasted)), []);
});

test('an entry header that runs on after the outcome text is reported', () => {
  const first = entry().slice(0, -2);
  const second = entry()
    .slice(1)
    .filter((l) => !/^(Date|Student|Tool):/.test(l));
  const errors = aiPromptLogErrors(log(first, second));
  assert.ok(
    errors.some((e) => /start of another entry/.test(e)),
    errors.join('\n'),
  );
});

test('a template without its closing separator cannot switch the check off', () => {
  const text = [
    'AI PROMPT LOG',
    'Entry format:',
    SEPARATOR,
    'Date: YYYY-MM-DD',
    'stray',
  ].join('\n');
  assert.match(
    aiPromptLogErrors(text)[0],
    /template must end with a separator/,
  );
});
