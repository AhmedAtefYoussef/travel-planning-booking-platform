// Pure rules for repository hygiene, unit-tested in repo-hygiene.test.mjs and run by check-repo-hygiene.mjs.

export const SEPARATOR = '================================================';
export const AI_LOG_FIELDS = [
  'Date:',
  'Student:',
  'Tool:',
  'Related Requirement:',
  'Prompt:',
  'How the output was used:',
];

// Lines git writes when a merge conflict is left unresolved. A bare "=======" only counts when it is exactly
// seven characters, so the 48-character AI log separator and Markdown rules never match.
const CONFLICT = /^(<{7}( |$)|={7}$|>{7}( |$)|\|{7}( |$))/;

/** 1-based line numbers that hold a leftover merge-conflict marker. */
export function conflictMarkerLines(text) {
  return text
    .split(/\r?\n/)
    .flatMap((line, i) => (CONFLICT.test(line) ? [i + 1] : []));
}

/**
 * Structural errors in AI_PROMPTS.txt (brief section 11.1). Every entry sits between two separator lines and
 * holds the six fields in order; only blank lines may appear between entries.
 */
export function aiPromptLogErrors(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  let open = null; // { start, fields: [{name, line}] } while inside an entry

  const close = (endLine) => {
    const names = open.fields.map((f) => f.name);
    const missing = AI_LOG_FIELDS.filter((f) => !names.includes(f));
    if (missing.length)
      errors.push(`line ${open.start}: entry is missing ${missing.join(', ')}`);
    const order = names.filter((n) => AI_LOG_FIELDS.includes(n));
    const expected = AI_LOG_FIELDS.filter((f) => order.includes(f));
    if (!missing.length && order.join('|') !== expected.join('|'))
      errors.push(
        `line ${open.start}: fields are out of order (expected ${AI_LOG_FIELDS.join(' ')})`,
      );
    for (const f of AI_LOG_FIELDS) {
      const seen = open.fields.filter((x) => x.name === f);
      if (seen.length > 1)
        errors.push(
          `line ${seen[1].line}: "${f}" appears twice in the entry starting at line ${open.start}`,
        );
    }
    const date = open.fields.find((x) => x.name === 'Date:');
    if (date && !/^Date: \d{4}-\d{2}-\d{2}$/.test(lines[date.line - 1].trim()))
      errors.push(`line ${date.line}: Date must be YYYY-MM-DD`);
    if (endLine - open.start < 2)
      errors.push(`line ${open.start}: empty entry`);
  };

  // The header (title, rules and the format template) ends at the template's closing separator.
  const firstEntry = findFirstEntry(lines);
  for (let i = firstEntry; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const n = i + 1;
    if (/^={8,}$/.test(line) && line !== SEPARATOR) {
      errors.push(
        `line ${n}: separator must be exactly ${SEPARATOR.length} "=" characters`,
      );
      continue;
    }
    if (line === SEPARATOR) {
      if (open) {
        close(n);
        open = null;
      } else open = { start: n, fields: [] };
      continue;
    }
    if (!open) {
      if (line.trim() !== '')
        errors.push(`line ${n}: text outside an entry (missing separator?)`);
      continue;
    }
    const field = AI_LOG_FIELDS.find((f) => line.startsWith(f));
    if (field) open.fields.push({ name: field, line: n });
  }
  if (open)
    errors.push(`line ${open.start}: entry is never closed with a separator`);
  return errors;
}

function findFirstEntry(lines) {
  const template = lines.findIndex((l) => l.startsWith('Entry format:'));
  if (template === -1) return 0;
  let seen = 0;
  for (let i = template; i < lines.length; i++) {
    if (lines[i].trimEnd() === SEPARATOR && ++seen === 2) return i + 1;
  }
  return lines.length;
}
