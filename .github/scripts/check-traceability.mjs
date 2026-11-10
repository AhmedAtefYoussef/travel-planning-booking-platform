// Fails when docs/requirements/traceability.md drifts from the official workbook (TRVL-134, brief section 2):
// every requirement ID needs exactly one row, and no row may cite an ID the workbook does not define.
// In tables with "PR" and "Status" columns, each status must be one of the documented values, and any row
// past "Not started" must cite the pull request(s) that implement it. A row still "In review" after all of
// its PRs are merged is stale (merged PR numbers come from the merge commits in git history).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const ROW_ID = /^\|\s*([A-Z]{3}-\d{2}[a-z]?(?:-B)?)\s*\|/;
const STATUS = /^(Not started|In progress|In review|Done|Partial: \S.*)$/;
const NEEDS_PR = /^(In review|Done|Partial: )/;

// Split a table row on unescaped pipes: "GET\|PATCH /x" is one cell (GitHub Markdown escaping).
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** Matrix rows with their cells keyed by the nearest table header: [{ id, line, cols }]. */
export function matrixRows(markdown) {
  const rows = [];
  let header = null;
  markdown.split(/\r?\n/).forEach((line, i) => {
    if (/^\|\s*ID\s*\|/.test(line)) header = cells(line);
    const m = ROW_ID.exec(line);
    if (!m) return;
    const values = cells(line);
    const cols = header
      ? Object.fromEntries(header.map((h, k) => [h, values[k] ?? '']))
      : {};
    rows.push({ id: m[1], line: i + 1, cols });
  });
  return rows;
}

export function traceabilityProblems(
  markdown,
  knownIds,
  mergedPrs = new Set(),
) {
  const rows = matrixRows(markdown);
  const counts = rows.reduce(
    (acc, r) => acc.set(r.id, (acc.get(r.id) ?? 0) + 1),
    new Map(),
  );
  const problems = [];
  for (const id of knownIds) {
    if (!counts.has(id)) problems.push(`${id} has no row`);
  }
  for (const [id, n] of counts) {
    if (!knownIds.has(id)) problems.push(`${id} is not a workbook requirement`);
    if (n > 1) problems.push(`${id} has ${n} rows`);
  }
  for (const { id, line, cols } of rows) {
    if (!('Status' in cols)) continue;
    const status = cols.Status;
    if (!STATUS.test(status)) {
      problems.push(
        `${id} (line ${line}): status "${status}" must be Not started, In progress, In review, Done or "Partial: <what is done>"`,
      );
      continue;
    }
    if ('PR' in cols && NEEDS_PR.test(status) && !/#\d+/.test(cols.PR)) {
      problems.push(
        `${id} (line ${line}): status "${status.split(':')[0]}" needs the PR number(s) in the PR column`,
      );
    }
    const cited = [...(cols.PR ?? '').matchAll(/#(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    if (
      status === 'In review' &&
      cited.length &&
      cited.every((n) => mergedPrs.has(n))
    ) {
      problems.push(
        `${id} (line ${line}): still "In review" but ${cited.map((n) => `#${n}`).join(', ')} merged; set Done or "Partial: ..."`,
      );
    }
  }
  return problems;
}

if (
  import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` ||
  process.argv[1]?.endsWith('check-traceability.mjs')
) {
  const ids = new Set(
    JSON.parse(
      readFileSync('docs/requirements/requirements.json', 'utf8'),
    ).requirements.map((r) => r.id),
  );
  let merged = new Set();
  try {
    const log = execFileSync('git', ['log', '--merges', '--format=%s'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    merged = new Set(
      [...log.matchAll(/^Merge pull request #(\d+) /gm)].map((m) =>
        Number(m[1]),
      ),
    );
  } catch {
    // not a git checkout: skip the stale-status rule
  }
  const problems = traceabilityProblems(
    readFileSync('docs/requirements/traceability.md', 'utf8'),
    ids,
    merged,
  );
  const out = problems.length
    ? `### Traceability matrix: ${problems.length} problem(s)\n${problems.map((p) => `- :x: ${p}`).join('\n')}\n`
    : `### Traceability matrix: OK (${ids.size} requirements traced)\n`;
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
  process.exit(problems.length ? 1 : 0);
}
