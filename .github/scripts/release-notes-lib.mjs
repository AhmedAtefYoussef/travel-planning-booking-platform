// Pure helpers for release notes, unit-tested in release-notes.test.mjs and run by release-notes.mjs.
// Notes are built from git history alone: every PR merge commit reads
//   "Merge pull request #N from owner/<branch>" followed by the PR title in the body.

const MERGE = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)$/;
const TITLE = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
const ID_TOKEN = /\b([A-Z]{3}-\d{2}[a-z]?(?:-B)?|TRVL-\d+)\b/g;

const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['test', 'Tests'],
  ['docs', 'Documentation'],
  ['ci', 'CI and tooling'],
  ['build', 'CI and tooling'],
  ['chore', 'CI and tooling'],
  ['revert', 'Reverts'],
];

/** A PR merge commit (subject + body) as {number, branch, title}, or null for any other commit. */
export function parseMergeCommit(subject, body) {
  const m = MERGE.exec((subject ?? '').trim());
  if (!m) return null;
  const title =
    (body ?? '')
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim() ?? '';
  return { number: Number(m[1]), branch: m[2], title };
}

/**
 * Markdown release notes. `prs` are parsed merge commits, newest first; `knownIds` is the set of workbook
 * requirement IDs. Release merges (develop into main) are left out, since their PRs are listed individually.
 */
export function buildReleaseNotes(prs, { tag, previousTag, knownIds }) {
  const work = prs.filter((p) => p.branch !== 'develop' && p.branch !== 'main');
  const groups = new Map();
  const requirements = new Map();
  const jira = new Set();
  for (const pr of work) {
    const t = TITLE.exec(pr.title);
    const type = t?.[1] ?? 'other';
    const heading = SECTIONS.find(([k]) => k === type)?.[1] ?? 'Other changes';
    const scope = t?.[2] && t[2] !== type ? `**${t[2]}:** ` : '';
    const text = t ? `${scope}${t[4]}` : pr.title || `PR #${pr.number}`;
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(`- ${text} (#${pr.number})`);
    for (const [, id] of `${pr.title} ${pr.branch}`.matchAll(ID_TOKEN)) {
      if (id.startsWith('TRVL-')) jira.add(id);
      else if (knownIds.has(id))
        requirements.set(id, [
          ...new Set([...(requirements.get(id) ?? []), pr.number]),
        ]);
    }
  }

  const order = [...new Set(SECTIONS.map(([, h]) => h)), 'Other changes'];
  const range = previousTag
    ? `${previousTag}...${tag}`
    : `the start of the project to ${tag}`;
  const out = [
    `## ${tag}`,
    '',
    `${work.length} pull request${work.length === 1 ? '' : 's'} merged since ${range}.`,
    '',
  ];
  for (const heading of order) {
    if (!groups.has(heading)) continue;
    out.push(`### ${heading}`, ...groups.get(heading), '');
  }
  if (requirements.size) {
    out.push(
      `### Requirements touched (${requirements.size})`,
      'Workbook IDs cited in PR titles or branch names. Their status is in docs/requirements/traceability.md.',
      '',
      '| Requirement | PRs |',
      '|---|---|',
      ...[...requirements.keys()].sort(compareIds).map(
        (id) =>
          `| ${id} | ${requirements
            .get(id)
            .sort((a, b) => a - b)
            .map((n) => `#${n}`)
            .join(', ')} |`,
      ),
      '',
    );
  }
  if (jira.size)
    out.push(`Jira tasks: ${[...jira].sort(compareIds).join(', ')}`, '');
  return out.join('\n');
}

function compareIds(a, b) {
  const [pa, na] = split(a);
  const [pb, nb] = split(b);
  return pa === pb ? na - nb || a.localeCompare(b) : pa.localeCompare(pb);
}
function split(id) {
  const m = /^([A-Z]+)-(\d+)/.exec(id);
  return [m[1], Number(m[2])];
}
