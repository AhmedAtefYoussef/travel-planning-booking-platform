// Repository hygiene checks. Run from the repo root:
//   node .github/scripts/check-repo-hygiene.mjs
// Fails on: leftover merge-conflict markers in any tracked text file, and a malformed AI_PROMPTS.txt
// (brief section 11.1: every entry needs Date, Student, Tool, Related Requirement, Prompt, How the output was used).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { aiPromptLogErrors, conflictMarkerLines } from './repo-hygiene.mjs';

const BINARY = /\.(png|jpe?g|gif|pdf|xlsx|ico|woff2?|zip|exe)$/i;
const files = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(
    (f) =>
      f &&
      !BINARY.test(f) &&
      !f.endsWith('package-lock.json') &&
      existsSync(f) &&
      statSync(f).isFile(),
  );

const problems = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable (permissions, a file removed mid-run): nothing to check
  }
  for (const line of conflictMarkerLines(text, file))
    problems.push({ file, line, msg: 'leftover merge-conflict marker' });
}
if (existsSync('AI_PROMPTS.txt')) {
  for (const err of aiPromptLogErrors(readFileSync('AI_PROMPTS.txt', 'utf8'))) {
    const line = Number(/^line (\d+)/.exec(err)?.[1] ?? 1);
    problems.push({
      file: 'AI_PROMPTS.txt',
      line,
      msg: err.replace(/^line \d+: /, ''),
    });
  }
}

const out = [
  `### Repository hygiene: ${problems.length ? `${problems.length} problem(s)` : 'OK'}`,
  ...problems.map((p) => `- :x: \`${p.file}:${p.line}\` ${p.msg}`),
].join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
for (const p of problems)
  console.log(`::error file=${p.file},line=${p.line}::${p.msg}`);
process.exit(problems.length ? 1 : 0);
