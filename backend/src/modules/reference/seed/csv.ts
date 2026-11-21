/**
 * Minimal RFC 4180 CSV reader for the official reference datasets (GEN-12, brief section 5.1).
 * Handles quoted fields, escaped quotes (""), commas and line breaks inside quotes, CRLF line endings
 * and a UTF-8 byte-order mark. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Header-keyed records with trimmed values. Throws when a required column is missing or a row has a
 * different number of fields than the header, naming the file and the 1-based line.
 */
export function csvRecords(
  text: string,
  requiredColumns: readonly string[],
  fileName: string,
): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error(`${fileName} is empty`);
  const columns = header.map((h) => h.trim());
  const missing = requiredColumns.filter((c) => !columns.includes(c));
  if (missing.length) {
    throw new Error(`${fileName} is missing column(s): ${missing.join(', ')}`);
  }
  return rows.map((cells, index) => {
    if (cells.length !== columns.length) {
      throw new Error(
        `${fileName} line ${index + 2} has ${cells.length} fields, expected ${columns.length}`,
      );
    }
    return Object.fromEntries(
      columns.map((column, i) => [column, cells[i].trim()]),
    );
  });
}
