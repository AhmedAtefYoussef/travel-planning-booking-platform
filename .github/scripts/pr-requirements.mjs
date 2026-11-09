// Deterministic merge-gate checks for a pull request. No external services.
// Usage: node pr-requirements.mjs <pr.json> <pr.diff> <reqs.json> <report.md> [traceability.md]
// pr.json comes from `gh pr view --json title,body,headRefName,baseRefName,commits,mergeable,isDraft`,
// with `files` replaced by the full paginated list from the pulls/<n>/files API.
// Exit code 1 when any blocking check fails.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TYPES = 'feat|fix|refactor|docs|test|chore|ci|build|perf|style|revert';
const CONVENTIONAL = new RegExp(`^(${TYPES})(\\([\\w./-]+\\))?!?: \\S`);
const REQ_ID = /\b([A-Z]{3}-\d{2}[a-z]?(?:-B)?|TRVL-\d+)\b/g;
const BRANCH = /^(feature|fix|refactor|docs|test|chore|ci)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SECRET_PATTERNS = [
  ['Stripe secret key', /\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{10,}/],
  ['MongoDB URI with password', /mongodb(\+srv)?:\/\/[^\s:<>/@]+:[^\s<>@]+@/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
];
const FORBIDDEN_PATH = [
  [/(^|\/)\.env(\.[^/]*)?$/, (p) => !p.endsWith('.env.example'), 'environment file'],
  [/(^|\/)node_modules\//, () => true, 'node_modules'],
  [/^backend\/dist\//, () => true, 'build output'],
  [/^(backend\/)?uploads\//, () => true, 'uploaded files'],
  [/^team-db-access\//, () => true, 'credential handout'],
];

/** Requirement IDs referenced in a string, de-duplicated. */
export function idsIn(text) {
  return [...new Set((text.match(REQ_ID) ?? []))];
}

/** Added lines per file from a unified diff. */
export function addedLines(diff) {
  const out = new Map();
  let file = null;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : null;
      if (file) out.set(file, []);
    } else if (file && line.startsWith('+') && !line.startsWith('+++')) {
      out.get(file).push(line.slice(1));
    }
  }
  return out;
}

/**
 * Evaluates the gate rules. Returns { errors, warnings, passed } where each
 * entry is a short sentence. Release PRs (develop -> main) skip the
 * per-feature rules.
 */
export function evaluate(pr, diff, knownIds, traceability = null) {
  const errors = [];
  const warnings = [];
  const passed = [];
  const known = new Set(knownIds);
  const isRelease = pr.baseRefName === 'main' && pr.headRefName === 'develop';
  const files = (pr.files ?? []).map((f) => f.path);
  const added = addedLines(diff);

  // Target branch
  if (pr.baseRefName === 'main' && !isRelease) {
    errors.push('Only `develop` may be merged into `main`; open this PR against `develop`.');
  } else if (!['develop', 'main'].includes(pr.baseRefName)) {
    errors.push(`Base branch \`${pr.baseRefName}\` is not \`develop\`.`);
  } else passed.push(`Targets \`${pr.baseRefName}\`.`);

  if (pr.isDraft) errors.push('PR is a draft; mark it ready for review.');

  // Mergeability (GitHub computes this; CONFLICTING blocks merging)
  if (pr.mergeable === 'CONFLICTING') {
    errors.push(`Merge conflicts with \`${pr.baseRefName}\`; merge or rebase \`${pr.baseRefName}\` into the branch and resolve them.`);
  } else if (pr.mergeable === 'MERGEABLE') passed.push('No merge conflicts.');
  else warnings.push('GitHub has not finished computing mergeability yet; conflicts are re-checked on the next push.');

  if (!isRelease) {
    // Branch name
    if (BRANCH.test(pr.headRefName)) passed.push(`Branch name \`${pr.headRefName}\` follows the convention.`);
    else errors.push(`Branch \`${pr.headRefName}\` must look like \`feature/<ID>-short-name\` or \`fix/<ID>-short-name\`.`);

    // Title: Conventional Commit + requirement ID that exists
    if (!CONVENTIONAL.test(pr.title)) {
      errors.push('Title must be a Conventional Commit, e.g. `feat(flights): add round-trip search [FLT-11]`.');
    }
    const ids = idsIn(`${pr.title} ${pr.headRefName}`);
    const unknown = ids.filter((id) => !id.startsWith('TRVL-') && !known.has(id));
    if (ids.length === 0) {
      errors.push('Reference a requirement ID (e.g. `FLT-22`) or Jira key (e.g. `TRVL-67`) in the title or branch name.');
    } else if (unknown.length) {
      errors.push(`Unknown requirement ID(s) ${unknown.map((i) => `\`${i}\``).join(', ')}: not in docs/requirements/reqs.json.`);
    } else passed.push(`References ${ids.map((i) => `\`${i}\``).join(', ')}.`);

    // Plan Definition of Done: every requirement ID has a traceability row
    if (traceability !== null) {
      const untraced = ids.filter(
        (id) => !id.startsWith('TRVL-') && known.has(id) && !new RegExp(`^\\|\\s*${id}\\s*\\|`, 'm').test(traceability),
      );
      if (untraced.length) {
        warnings.push(
          `No row for ${untraced.map((i) => `\`${i}\``).join(', ')} in docs/requirements/traceability.md; add one (ID, endpoint, test, status).`,
        );
      } else if (ids.some((id) => !id.startsWith('TRVL-'))) passed.push('Requirement IDs have traceability rows.');
    }

    // Description from the PR template
    const body = pr.body ?? '';
    const section = (name) => {
      const m = body.match(new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(\\n##\\s|$)`, 'i'));
      return m ? m[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
    };
    const missing = ['What', 'How to verify'].filter((s) => !section(s));
    if (missing.length) errors.push(`Fill in the ${missing.map((s) => `"${s}"`).join(' and ')} section(s) of the PR description.`);
    else passed.push('Description has "What" and "How to verify".');

    // Commits
    const badCommits = (pr.commits ?? [])
      .map((c) => c.messageHeadline)
      .filter((h) => !CONVENTIONAL.test(h) && !/^Merge (branch|remote-tracking branch|pull request)/.test(h));
    if (badCommits.length) {
      errors.push(`Commit message(s) not in Conventional Commits format: ${badCommits.slice(0, 5).map((h) => `\`${h}\``).join(', ')}.`);
    } else passed.push('All commit messages follow Conventional Commits.');

    // Business logic must come with tests
    const services = files.filter((p) => /^backend\/src\/.*\.service\.ts$/.test(p));
    const tests = files.filter((p) => /\.spec\.ts$|^backend\/test\//.test(p));
    if (services.length && !tests.length) {
      errors.push(`Changes business logic (${services.map((p) => `\`${p}\``).join(', ')}) without adding or updating tests.`);
    } else if (services.length) passed.push('Business-logic changes come with tests.');

    // Swagger summaries carry the requirement ID
    const badSummaries = [];
    for (const [file, lines] of added) {
      if (!file.endsWith('.controller.ts')) continue;
      for (const l of lines) {
        const m = l.match(/summary:\s*['"`]([^'"`]*)/);
        if (m && !/^\[[A-Z]{3}-\d{2}[a-z]?(?:-B)?\]/.test(m[1])) badSummaries.push(`${file}: "${m[1]}"`);
      }
    }
    if (badSummaries.length) {
      errors.push(`Swagger summaries must start with the requirement ID, e.g. \`[FLT-11] Search flights\`: ${badSummaries.slice(0, 5).join('; ')}.`);
    }

    // Money as integer minor units: flag float-looking amount fields
    const floatMoney = [];
    for (const [file, lines] of added) {
      if (!file.startsWith('backend/src/')) continue;
      for (const l of lines) if (/(price|amount|total)(?!Minor)\w*\s*[:=]\s*\d+\.\d+/i.test(l)) floatMoney.push(file);
    }
    if (floatMoney.length) warnings.push(`Possible decimal money values in ${[...new Set(floatMoney)].join(', ')}; money must be integer minor units.`);
  }

  // Files that must never be committed
  const forbidden = [];
  for (const p of files) {
    for (const [re, applies, what] of FORBIDDEN_PATH) if (re.test(p) && applies(p)) forbidden.push(`\`${p}\` (${what})`);
  }
  if (forbidden.length) errors.push(`Remove files that must not be committed: ${forbidden.join(', ')}.`);
  else passed.push('No environment, build or credential files.');

  // Secrets in added lines
  const leaks = [];
  for (const [file, lines] of added) {
    for (const l of lines) for (const [name, re] of SECRET_PATTERNS) if (re.test(l)) leaks.push(`${name} in \`${file}\``);
  }
  if (leaks.length) errors.push(`Possible secrets added: ${[...new Set(leaks)].join(', ')}. Remove them and rotate the credential.`);
  else passed.push('No secrets detected in added lines.');

  return { errors, warnings, passed };
}

export function renderReport({ errors, warnings, passed }) {
  const head = errors.length
    ? `### ❌ PR requirements: ${errors.length} blocking issue(s)`
    : '### ✅ PR requirements: all checks passed';
  const list = (title, items) => (items.length ? `\n**${title}**\n${items.map((i) => `- ${i}`).join('\n')}\n` : '');
  return [
    '<!-- pr-requirements-report -->',
    head,
    list('Blocking', errors),
    list('Warnings', warnings),
    list('Passed', passed),
    '\nCI (`build-lint-test`) must also pass. The team leader reviews and merges the PR; push a fix to re-run this check.',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [prPath, diffPath, reqsPath, reportPath, tracePath] = process.argv.slice(2);
  const pr = JSON.parse(readFileSync(prPath, 'utf8'));
  const diff = readFileSync(diffPath, 'utf8');
  const ids = JSON.parse(readFileSync(reqsPath, 'utf8')).map((r) => r.id);
  const trace = tracePath && existsSync(tracePath) ? readFileSync(tracePath, 'utf8') : null;
  const result = evaluate(pr, diff, ids, trace);
  writeFileSync(reportPath, renderReport(result));
  console.log(renderReport(result));
  process.exit(result.errors.length ? 1 : 0);
}
