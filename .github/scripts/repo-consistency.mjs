// Repository-wide consistency checks run by CI on every push. No external services.
// Usage (from the repo root): node .github/scripts/repo-consistency.mjs
// Exit code 1 when any check fails.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ENTRY_SEPARATOR = /^={10,}\s*$/m;
const AI_FIELDS = ['Date', 'Student', 'Tool', 'Related Requirement'];

/**
 * Brief 11.1: each AI_PROMPTS.txt entry has Date (YYYY-MM-DD), Student, Tool,
 * Related Requirement, a Prompt and "How the output was used". Returns errors.
 */
export function checkAiPrompts(text) {
  const errors = [];
  const entries = text
    .split(ENTRY_SEPARATOR)
    .map((e) => e.trim())
    .filter(Boolean);
  if (!entries.length) return ['AI_PROMPTS.txt has no entries.'];
  entries.forEach((entry, i) => {
    const label = `AI_PROMPTS.txt entry ${i + 1}`;
    for (const field of AI_FIELDS) {
      const m = entry.match(new RegExp(`^${field}:[ \\t]*(.*)$`, 'm'));
      if (!m || !m[1].trim()) errors.push(`${label}: missing "${field}:" value.`);
    }
    const date = entry.match(/^Date:[ \t]*(.*)$/m)?.[1].trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`${label}: Date "${date}" must be YYYY-MM-DD.`);
    } else if (date && Number.isNaN(Date.parse(date))) {
      errors.push(`${label}: Date "${date}" is not a real date.`);
    }
    const prompt = entry.match(/^Prompt:([\s\S]*?)^How the output was used:/m);
    if (!prompt) errors.push(`${label}: needs "Prompt:" followed by "How the output was used:".`);
    else if (!prompt[1].trim()) errors.push(`${label}: the prompt text is empty.`);
    const used = entry.match(/^How the output was used:([\s\S]*)$/m);
    if (used && !used[1].trim()) errors.push(`${label}: "How the output was used" is empty.`);
  });
  return errors;
}

/** Variable names declared in the EnvVars interface of env.schema.ts. */
export function schemaEnvKeys(schemaSource) {
  const body = schemaSource.match(/export interface EnvVars\s*{([\s\S]*?)\n}/)?.[1] ?? '';
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\??:/gm)].map((m) => m[1]);
}

/** Variable names in .env.example (KEY= lines, comments ignored). */
export function exampleEnvKeys(exampleSource) {
  return [...exampleSource.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
}

/** .env.example must list exactly the variables the env schema validates. */
export function checkEnvExample(schemaSource, exampleSource) {
  const schema = new Set(schemaEnvKeys(schemaSource));
  const example = new Set(exampleEnvKeys(exampleSource));
  const errors = [];
  if (!schema.size) return ['Could not find the EnvVars interface in backend/src/config/env.schema.ts.'];
  const missing = [...schema].filter((k) => !example.has(k));
  const extra = [...example].filter((k) => !schema.has(k));
  if (missing.length) errors.push(`.env.example is missing ${missing.join(', ')} (declared in env.schema.ts).`);
  if (extra.length) errors.push(`.env.example lists ${extra.join(', ')}, which env.schema.ts does not validate.`);
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  const errors = [];
  const prompts = read('AI_PROMPTS.txt');
  if (prompts === null) errors.push('AI_PROMPTS.txt is missing (brief 11.1).');
  else errors.push(...checkAiPrompts(prompts));
  const schema = read('backend/src/config/env.schema.ts');
  const example = read('.env.example');
  if (schema === null || example === null) errors.push('backend/src/config/env.schema.ts or .env.example is missing.');
  else errors.push(...checkEnvExample(schema, example));

  if (errors.length) {
    for (const e of errors) console.log(`::error::${e}`);
    process.exit(1);
  }
  console.log('AI_PROMPTS.txt format and .env.example keys are consistent.');
}
