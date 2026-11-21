// Release notes for a tag, built from the PR merge commits since the previous tag. Run from the repo root:
//   node .github/scripts/release-notes.mjs v1.0.0-m1            (the tag must exist)
//   node .github/scripts/release-notes.mjs HEAD --title v1.0.0-m1   (preview before tagging)
// Prints Markdown to stdout; the release workflow passes it to `gh release create --notes-file`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildReleaseNotes, parseMergeCommit } from './release-notes-lib.mjs';

const args = process.argv.slice(2);
const ref = args[0];
const titleAt = args.indexOf('--title');
const tag = titleAt >= 0 ? args[titleAt + 1] : ref;
if (!ref || !tag) {
  console.error(
    'usage: release-notes.mjs <tag-or-ref> [--title <release name>]',
  );
  process.exit(2);
}

const git = (...a) =>
  execFileSync('git', a, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
let previousTag = null;
try {
  previousTag = git(
    'describe',
    '--tags',
    '--abbrev=0',
    '--match',
    'v*',
    `${ref}^`,
  );
} catch {
  // first release: no earlier v* tag
}
const range = previousTag ? `${previousTag}..${ref}` : ref;
const SEP = '\u001e';
const log = git('log', '--merges', `--format=%s%x1f%b${SEP}`, range);
const prs = log
  .split(SEP)
  .map((rec) => rec.trim())
  .filter(Boolean)
  .map((rec) => {
    const [subject, body] = rec.split('\u001f');
    return parseMergeCommit(subject, body);
  })
  .filter(Boolean);

const knownIds = new Set(
  JSON.parse(
    readFileSync('docs/requirements/requirements.json', 'utf8'),
  ).requirements.map((r) => r.id),
);
console.log(buildReleaseNotes(prs, { tag, previousTag, knownIds }));
