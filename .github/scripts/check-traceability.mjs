// Fails when docs/requirements/traceability.md drifts from the official workbook (TRVL-134, brief section 2):
// every requirement ID needs exactly one row, and no row may cite an ID the workbook does not define.
import { appendFileSync, readFileSync } from 'node:fs';

export function traceabilityProblems(markdown, knownIds) {
  const rows = [...markdown.matchAll(/^\|\s*([A-Z]{3}-\d{2}[a-z]?(?:-B)?)\s*\|/gm)].map((m) => m[1]);
  const counts = rows.reduce((acc, id) => acc.set(id, (acc.get(id) ?? 0) + 1), new Map());
  const problems = [];
  for (const id of knownIds) {
    if (!counts.has(id)) problems.push(`${id} has no row`);
  }
  for (const [id, n] of counts) {
    if (!knownIds.has(id)) problems.push(`${id} is not a workbook requirement`);
    if (n > 1) problems.push(`${id} has ${n} rows`);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` || process.argv[1]?.endsWith('check-traceability.mjs')) {
  const ids = new Set(
    JSON.parse(readFileSync('docs/requirements/requirements.json', 'utf8')).requirements.map((r) => r.id),
  );
  const problems = traceabilityProblems(readFileSync('docs/requirements/traceability.md', 'utf8'), ids);
  const out = problems.length
    ? `### Traceability matrix: ${problems.length} problem(s)\n${problems.map((p) => `- :x: ${p}`).join('\n')}\n`
    : `### Traceability matrix: OK (${ids.size} requirements traced)\n`;
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
  process.exit(problems.length ? 1 : 0);
}
