/**
 * Usage: npm run openapi:check [-- <openapi.json> [<requirements.json>]]
 * Exits 1 and prints every violation when the generated Swagger contract breaks a rule.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkOpenApi, OpenApiLike } from './openapi-rules';

const specFile = process.argv[2] ?? 'openapi.json';
const reqFile =
  process.argv[3] ??
  resolve(__dirname, '../../docs/requirements/requirements.json');

const spec = JSON.parse(readFileSync(specFile, 'utf8')) as OpenApiLike;
const reqs = JSON.parse(readFileSync(reqFile, 'utf8')) as {
  requirements: { id: string }[];
};
const violations = checkOpenApi(
  spec,
  new Set(reqs.requirements.map((r) => r.id)),
);
const operations = Object.values(spec.paths ?? {}).reduce(
  (n, item) => n + Object.keys(item).length,
  0,
);

const lines = violations.map(
  (v) => `- \`${v.operation}\` [${v.rule}] ${v.message}`,
);
const summary = violations.length
  ? `### OpenAPI contract: ${violations.length} violation(s) across ${operations} operation(s)\n${lines.join('\n')}\n`
  : `### OpenAPI contract: OK (${operations} operation(s) checked)\n`;

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
process.exit(violations.length ? 1 : 0);
