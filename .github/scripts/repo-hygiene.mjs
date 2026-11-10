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
// Fields that open the free-text parts of an entry. Lines inside them are the author's text, never fields.
const PROMPT = 'Prompt:';
const OUTCOME = 'How the output was used:';
// Header lines that, inside the free text, almost always mean a missing separator rather than pasted text.
const NEXT_ENTRY =
  /^(Date: \d{4}-\d{2}-\d{2}$|Student: \S|Related Requirement: \S)/;

const lineList = (text) => text.replace(/^\uFEFF/, '').split(/\r?\n/);

// Files where a line of exactly seven "=" is a legitimate heading underline (setext / RST).
const MARKUP = /\.(md|markdown|mdx|rst|adoc)$/i;

/**
 * 1-based line numbers that hold a leftover merge-conflict marker. A lone `=======` (someone deleted the
 * `<<<<<<<` and `>>>>>>>` lines but not the middle one) counts everywhere except in Markdown and RST files,
 * where it only counts between conflict markers, so a heading underlined with exactly seven "=" passes.
 */
export function conflictMarkerLines(text, file = '') {
  const found = [];
  let inConflict = false;
  lineList(text).forEach((line, i) => {
    if (/^<{7}( |$)/.test(line)) {
      inConflict = true;
      found.push(i + 1);
    } else if (/^(>{7}|\|{7})( |$)/.test(line)) {
      if (line.startsWith('>')) inConflict = false;
      found.push(i + 1);
    } else if (/^={7}$/.test(line) && (inConflict || !MARKUP.test(file)))
      found.push(i + 1);
  });
  return found;
}

/**
 * Structural errors in AI_PROMPTS.txt (brief section 11.1). Every entry sits between two separator lines and
 * holds the six fields in order; only blank lines may appear between entries. The prompt and outcome texts are
 * free text: a pasted line starting with "Date:" there is not a field.
 */
export function aiPromptLogErrors(text) {
  const lines = lineList(text);
  const errors = [];
  let open = null; // { start, fields: [{name, line}] } while inside an entry

  const close = () => {
    const names = open.fields.map((f) => f.name);
    const missing = AI_LOG_FIELDS.filter((f) => !names.includes(f));
    if (missing.length === AI_LOG_FIELDS.length)
      errors.push(`line ${open.start}: empty entry`);
    else if (missing.length)
      errors.push(`line ${open.start}: entry is missing ${missing.join(', ')}`);
    else if (names.join('|') !== AI_LOG_FIELDS.join('|'))
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
  };

  const firstEntry = findFirstEntry(lines);
  if (firstEntry === -1)
    return [
      'line 1: the "Entry format:" template must end with a separator line',
    ];

  for (let i = firstEntry; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const n = i + 1;
    const freeText = open?.fields.some((f) => f.name === PROMPT);
    if (line === SEPARATOR) {
      if (open) {
        close();
        open = null;
      } else open = { start: n, fields: [] };
      continue;
    }
    // A long "=" line where an entry boundary belongs is a mistyped separator: outside an entry, before the
    // prompt text, or in the free text when a blank line, a separator or the end of the file follows it.
    // Any other long "=" line in the free text is pasted content and is left alone.
    if (/^={8,}$/.test(line)) {
      const next = lines[i + 1]?.trimEnd();
      const boundary = next === undefined || next === '' || next === SEPARATOR;
      if (!freeText || boundary) {
        errors.push(
          `line ${n}: separator must be exactly ${SEPARATOR.length} "=" characters`,
        );
        if (open && freeText) {
          close();
          open = null;
        }
        continue;
      }
    }
    if (!open) {
      // One error per run of stray lines: a single missing separator would otherwise flag every line after it.
      const previous = (lines[i - 1] ?? '').trimEnd();
      const runStart = previous === '' || /^={8,}$/.test(previous);
      if (line.trim() !== '' && runStart)
        errors.push(`line ${n}: text outside an entry (missing separator?)`);
      continue;
    }
    const seenOutcome = open.fields.some((f) => f.name === OUTCOME);
    const candidates = seenOutcome ? [] : freeText ? [OUTCOME] : AI_LOG_FIELDS;
    const field = candidates.find((f) => line.startsWith(f));
    if (field) open.fields.push({ name: field, line: n });
    else if (!freeText) {
      // Before the prompt text a repeated header field means two entries ran together.
      const repeat = AI_LOG_FIELDS.find((f) => line.startsWith(f));
      if (repeat) open.fields.push({ name: repeat, line: n });
    } else if (NEXT_ENTRY.test(line))
      errors.push(
        `line ${n}: looks like the start of another entry; add a separator line before it`,
      );
  }
  if (open)
    errors.push(`line ${open.start}: entry is never closed with a separator`);
  return errors;
}

/**
 * Index of the first line after the header (title, rules and the format template, which ends at its second
 * separator). -1 when the template is not closed, so a damaged header cannot switch the check off.
 */
function findFirstEntry(lines) {
  const template = lines.findIndex((l) => l.startsWith('Entry format:'));
  if (template === -1) return 0;
  let seen = 0;
  for (let i = template; i < lines.length; i++) {
    if (lines[i].trimEnd() === SEPARATOR && ++seen === 2) return i + 1;
  }
  return -1;
}

/**
 * Relative Markdown links whose target file or folder does not exist: [{ line, target }]. `exists(path)` gets
 * the target resolved against the linking file's folder, without any #anchor. Web links, mail links,
 * same-page anchors and links inside code (fenced blocks or `inline code`) are skipped.
 */
export function brokenRelativeLinks(markdown, exists) {
  const broken = [];
  let fenced = false;
  lineList(markdown).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const prose = line.replace(/`[^`]*`/g, '');
    for (const m of prose.matchAll(
      /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    )) {
      const target = m[1];
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
      const path = decodeURI(target.split('#')[0]);
      if (path && !exists(path)) broken.push({ line: i + 1, target });
    }
  });
  return broken;
}
