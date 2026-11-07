// Pull-request governance rules (brief sections 2, 10.3, 10.5, 11.1). Pure functions so they can
// be unit-tested with `node --test .github/scripts`; check-pr.mjs wires them to the GitHub event.

const REQ = String.raw`[A-Z]{3}-\d{2}[a-z]?(?:-B)?`;
const REQ_TOKEN = new RegExp(String.raw`\b(${REQ})\b`, 'g');
const JIRA_KEY = /\bTRVL-\d+\b/;

const BRANCH_PATTERNS = [
  { re: new RegExp(String.raw`^(feature|fix)/(${REQ}|TRVL-\d+)-[a-z0-9][a-z0-9-]*$`), kind: 'work' },
  { re: /^(refactor|docs|chore|ci|test|perf)\/[A-Za-z0-9][A-Za-z0-9-]*$/, kind: 'support' },
  { re: /^release\/v\d+\.\d+\.\d+(-[a-z0-9.]+)?$/, kind: 'release' },
  { re: /^hotfix\/[A-Za-z0-9][A-Za-z0-9-]*$/, kind: 'hotfix' },
  { re: /^dependabot\//, kind: 'bot' },
  { re: /^develop$/, kind: 'develop' },
];

export function classifyBranch(head) {
  return BRANCH_PATTERNS.find((p) => p.re.test(head))?.kind ?? null;
}

/** Requirement-like tokens cited in text, e.g. "FLT-22", "ACC-07a", "GEN-01-B". */
export function citedRequirementIds(text) {
  return [...new Set([...(text ?? '').matchAll(REQ_TOKEN)].map((m) => m[1]))];
}

/** Unchecked "- [ ]" items under the "## Checklist" heading of the PR template. */
export function uncheckedChecklistItems(body) {
  const section = /^##\s*Checklist\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body ?? '');
  if (!section) return null;
  return section[1]
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+\[ \]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+\[ \]\s+/, '').trim());
}

/** "AI-assisted: yes|no" line from the PR template. */
export function aiAssisted(body) {
  const m = /^\s*AI-assisted:\s*\**\s*(yes|no)\b/im.exec(body ?? '');
  return m ? m[1].toLowerCase() === 'yes' : null;
}

/**
 * @param {{ head: string, base: string, title: string, body: string, labels: string[],
 *           changedFiles: string[], knownIds: Set<string>, isBot?: boolean }} pr
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function evaluatePullRequest(pr) {
  const errors = [];
  const warnings = [];
  // Template hints live in HTML comments; they must not count as content (e.g. example IDs).
  const body = (pr.body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const kind = classifyBranch(pr.head);
  const labels = new Set(pr.labels ?? []);
  const changed = pr.changedFiles ?? [];

  // Branch naming (brief 10.3).
  if (!kind) {
    errors.push(
      `Branch "${pr.head}" does not follow the naming convention: feature/<REQ-ID>-<desc>, fix/<REQ-ID>-<desc>, ` +
        'refactor|docs|chore|ci|test/<desc>, release/vX.Y.Z or hotfix/<desc>.',
    );
  }
  const branchId = new RegExp(String.raw`^(?:feature|fix)/(${REQ})-`).exec(pr.head)?.[1];
  if (branchId && !pr.knownIds.has(branchId)) {
    errors.push(`Branch requirement ID "${branchId}" is not in the official workbook (docs/requirements/requirements.json).`);
  }

  // Merge direction (brief 10.2/10.4): features go to develop; only develop/release/hotfix reach main.
  if (pr.base === 'main' && !['develop', 'release', 'hotfix'].includes(kind ?? '')) {
    errors.push(`Only develop, release/* or hotfix/* may target main; "${pr.head}" must target develop.`);
  }
  if (pr.base !== 'main' && pr.base !== 'develop') {
    warnings.push(`Unusual base branch "${pr.base}" (expected develop).`);
  }

  if (pr.isBot) return { errors, warnings };

  // Traceability (brief section 2): Jira key + valid requirement IDs.
  // The checklist itself names requirement IDs (GEN-02, ACC-11, ...); only the author's own text counts.
  const withoutChecklist = body.replace(/^##\s*Checklist\s*$[\s\S]*?(?=^##\s|(?![\s\S]))/im, '');
  const text = `${pr.title}\n${withoutChecklist}`;
  if (!JIRA_KEY.test(text) && kind !== 'release' && kind !== 'develop') {
    errors.push('Reference the Jira issue key (e.g. TRVL-42) in the PR title or description.');
  }
  const cited = citedRequirementIds(text);
  const unknown = cited.filter((id) => !pr.knownIds.has(id));
  if (unknown.length) {
    errors.push(`Unknown requirement ID(s): ${unknown.join(', ')}. Use IDs from the official workbook.`);
  }
  if ((kind === 'work' || kind === 'hotfix') && cited.length === 0) {
    errors.push('Feature/fix PRs must reference at least one requirement ID (e.g. FLT-22).');
  }

  // Template completeness (brief 10.5: meaningful description).
  const unchecked = uncheckedChecklistItems(body);
  if (unchecked === null) {
    errors.push('PR description must keep the "## Checklist" section from .github/pull_request_template.md.');
  } else if (unchecked.length) {
    errors.push(`Unchecked checklist item(s) (tick them or mark "N/A" and tick): ${unchecked.map((i) => `"${i}"`).join('; ')}`);
  }
  const summary = /^##\s*Summary\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body)?.[1].replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!summary || summary.length < 20) {
    errors.push('Fill in the "## Summary" section (what changed and why, at least one sentence).');
  }

  // Secrets / env files (brief 8.11, 10.5).
  const envFiles = changed.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
  if (envFiles.length) errors.push(`Environment files must never be committed: ${envFiles.join(', ')}`);

  // AI prompt log (brief 11.1).
  const ai = aiAssisted(body);
  if (ai === null) errors.push('State "AI-assisted: yes" or "AI-assisted: no" in the PR description (brief section 11).');
  if (ai === true && !changed.includes('AI_PROMPTS.txt')) {
    errors.push('AI-assisted PRs must add an entry to AI_PROMPTS.txt (brief section 11.1).');
  }

  // Traceability matrix kept in sync with module code.
  const touchesModules = changed.some((f) => f.startsWith('backend/src/modules/'));
  const matrix = 'docs/requirements/traceability.md';
  if (touchesModules && !changed.includes(matrix) && !labels.has('no-trace')) {
    if (pr.matrixExists) {
      errors.push(`Module code changed: update ${matrix} (requirement -> endpoint -> PR -> status), or add the "no-trace" label for pure refactors.`);
    } else {
      warnings.push(`${matrix} does not exist yet; add the row for this change once it lands (TRVL-134).`);
    }
  }

  return { errors, warnings };
}
