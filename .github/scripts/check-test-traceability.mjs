// Reports requirements that are Done or Partial in docs/requirements/traceability.md but are not cited by any
// automated test (milestone 1 V&V, TRVL-136). A requirement counts as tested when its ID appears in the title
// of a describe() block in an e2e spec (backend/test/**/*.e2e-spec.ts, e.g. "Login lockout (e2e): ACC-05") or
// in a unit spec (backend/src/**/*.spec.ts, e.g. "booking lifecycle (GEN-11)"): pure rules are tested at unit
// level. The step is non-blocking in pr-governance until the team decides otherwise.
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { matrixRows } from './check-traceability.mjs';

const TESTED_STATUS = /^(Done|Partial: )/;
const DESCRIBE_TITLE =
  /\bdescribe(?:\.each\([^)]*\))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const REQUIREMENT_ID = /\b[A-Z]{3}-\d{2}[a-z]?(?:-B)?(?![\w-])/g;

/** Requirement IDs cited in describe() titles of one spec file's source. */
export function citedIds(source) {
  const ids = new Set();
  for (const [, , title] of source.matchAll(DESCRIBE_TITLE)) {
    for (const [id] of title.matchAll(REQUIREMENT_ID)) ids.add(id);
  }
  return ids;
}

/**
 * Every row whose status claims an implementation (Done / Partial) with the spec files citing it.
 * @param {string} markdown traceability.md
 * @param {[string, string][]} specs [path, source] of each spec file
 * @returns {{ id: string, status: string, owner: string, specs: string[] }[]} one entry per tracked row
 */
export function testTraceability(markdown, specs) {
  const citations = new Map();
  for (const [file, source] of specs) {
    for (const id of citedIds(source)) {
      citations.set(id, [...(citations.get(id) ?? []), file]);
    }
  }
  return matrixRows(markdown)
    .filter((r) => TESTED_STATUS.test(r.cols.Status ?? ''))
    .map((r) => ({
      id: r.id,
      status: r.cols.Status.split(':')[0],
      owner: r.cols.Owner ?? '',
      specs: citations.get(r.id) ?? [],
    }));
}

function specFiles(dir, suffix) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return specFiles(path, suffix);
    return e.name.endsWith(suffix) ? [path] : [];
  });
}

if (
  import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` ||
  process.argv[1]?.endsWith('check-test-traceability.mjs')
) {
  const specs = [
    ...specFiles('backend/test', '.e2e-spec.ts'),
    ...specFiles('backend/src', '.spec.ts'),
  ].map((f) => [f.replaceAll('\\', '/'), readFileSync(f, 'utf8')]);
  const rows = testTraceability(
    readFileSync('docs/requirements/traceability.md', 'utf8'),
    specs,
  );
  const missing = rows.filter((r) => r.specs.length === 0);
  const short = (s) => s.replace(/^backend\/(test|src)\//, '');
  const table = rows
    .map(
      (r) =>
        `| ${r.id} | ${r.status} | ${r.owner} | ${r.specs.filter((s) => s.endsWith('.e2e-spec.ts')).length} | ${r.specs.filter((s) => !s.endsWith('.e2e-spec.ts')).length} | ${r.specs.length ? r.specs.map(short).join(', ') : ':x: none'} |`,
    )
    .join('\n');
  const out =
    `### Test traceability: ${rows.length - missing.length}/${rows.length} implemented requirements cited by a describe() title\n` +
    (missing.length
      ? `Not cited: ${missing.map((r) => r.id).join(', ')}\n`
      : '') +
    `\n| ID | Status | Owner | e2e specs | unit specs | Files |\n|---|---|---|---|---|---|\n${table}\n`;
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
  process.exit(missing.length ? 1 : 0);
}
