// Repository-wide guard rails that linters cannot express. Run from the repo root:
//   node .github/scripts/check-forbidden-patterns.mjs
// Fails on: auth tokens in browser storage (ACC-19, brief 8.1), raw card data fields (PAY-01, brief 6.4),
// hard-coded secrets in source. Reports every @Public() route so reviewers can confirm each opt-out.
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['backend/src', 'frontend/src', 'frontend/app'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage']);
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

const RULES = [
  {
    id: 'no-browser-token-storage',
    why: 'Auth tokens must live only in httpOnly cookies, never localStorage/sessionStorage (ACC-19).',
    test: (line) => /\b(localStorage|sessionStorage)\b/.test(line) && /token|jwt|auth|session/i.test(line),
  },
  {
    id: 'no-raw-card-data',
    why: 'Never store or accept raw card data; Stripe Elements/PaymentIntents only (PAY-01, brief 6.4).',
    test: (line, file) =>
      file.startsWith('backend/') && /\b(cardNumber|card_number|cvc|cvv|cardCvc|expiryMonth|exp_month)\b/.test(line),
  },
  {
    id: 'no-hardcoded-secrets',
    why: 'Secrets come from environment variables validated at startup, never from source.',
    test: (line) =>
      /\b(sk_(live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|mongodb(\+srv)?:\/\/[^<\s'"]+:[^<\s'"]+@)/.test(line),
  },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXT.test(name) && !/\.(spec|test|e2e-spec)\.[jt]sx?$/.test(name)) yield full;
  }
}

const violations = [];
const publicRoutes = [];
for (const root of ROOTS) {
  for (const full of walk(root)) {
    const file = relative('.', full).replaceAll('\\', '/');
    readFileSync(full, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        for (const rule of RULES) {
          if (rule.test(line, file)) violations.push({ file, line: i + 1, rule });
        }
        if (/@Public\(\)/.test(line) && !file.endsWith('public.decorator.ts')) publicRoutes.push(`${file}:${i + 1}`);
      });
  }
}

const out = [
  `### Guard rails: ${violations.length ? `${violations.length} violation(s)` : 'OK'}`,
  ...violations.map((v) => `- :x: \`${v.file}:${v.line}\` **${v.rule.id}**: ${v.rule.why}`),
  '',
  `#### Public (unauthenticated) routes: ${publicRoutes.length}`,
  ...(publicRoutes.length ? publicRoutes.map((p) => `- \`${p}\``) : ['- none']),
  '',
  '<sub>Reviewers: confirm each public route is meant to be reachable by guests (brief section 4).</sub>',
].join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
for (const v of violations) console.log(`::error file=${v.file},line=${v.line}::${v.rule.id}: ${v.rule.why}`);
process.exit(violations.length ? 1 : 0);
