/**
 * Pure rules behind `npm run db:indexes`: compares the indexes the Mongoose schemas declare with the
 * indexes a database already has, and names every difference that would make startup fail
 * (DatabaseModule waits for every index build). No database access here.
 */

export type IndexKey = Record<string, number | string>;

export interface DeclaredIndex {
  key: IndexKey;
  name?: string;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: unknown;
  expireAfterSeconds?: number;
}

export interface ExistingIndex {
  key: IndexKey;
  name: string;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: unknown;
  expireAfterSeconds?: number;
}

export type Finding =
  | { kind: 'ok'; name: string }
  | { kind: 'missing'; name: string; note: string }
  | { kind: 'skipped'; name: string; note: string }
  | { kind: 'name-clash'; name: string; existingName: string; note: string }
  | { kind: 'option-clash'; name: string; note: string };

/** MongoDB's default index name: `field_1_other_-1`. */
export function defaultIndexName(key: IndexKey): string {
  return Object.entries(key)
    .map(([field, dir]) => `${field}_${dir}`)
    .join('_');
}

const sameKey = (a: IndexKey, b: IndexKey) =>
  JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

const isText = (key: IndexKey) => Object.values(key).includes('text');

function optionsDiffer(d: DeclaredIndex, e: ExistingIndex): string[] {
  const diffs: string[] = [];
  if (Boolean(d.unique) !== Boolean(e.unique)) diffs.push('unique');
  if (Boolean(d.sparse) !== Boolean(e.sparse)) diffs.push('sparse');
  if (d.expireAfterSeconds !== e.expireAfterSeconds)
    diffs.push('expireAfterSeconds');
  if (
    JSON.stringify(d.partialFilterExpression ?? null) !==
    JSON.stringify(e.partialFilterExpression ?? null)
  )
    diffs.push('partialFilterExpression');
  return diffs;
}

/** One finding per declared index of one collection. */
export function compareIndexes(
  declared: readonly DeclaredIndex[],
  existing: readonly ExistingIndex[],
): Finding[] {
  return declared.map((d): Finding => {
    const name = d.name ?? defaultIndexName(d.key);
    if (isText(d.key))
      return { kind: 'skipped', name, note: 'text index, not compared' };
    const byKey = existing.find((e) => sameKey(e.key, d.key));
    const byName = existing.find((e) => e.name === name);
    if (byKey && byKey.name !== name)
      return {
        kind: 'name-clash',
        name,
        existingName: byKey.name,
        note: `the database has this index as "${byKey.name}"; the code asks for "${name}" (startup fails with error 85)`,
      };
    if (byName && !sameKey(byName.key, d.key))
      return {
        kind: 'option-clash',
        name,
        note: `an index named "${name}" exists on other fields (${JSON.stringify(byName.key)})`,
      };
    if (byKey) {
      const diffs = optionsDiffer(d, byKey);
      return diffs.length
        ? {
            kind: 'option-clash',
            name,
            note: `same fields and name but different ${diffs.join(', ')} (startup fails)`,
          }
        : { kind: 'ok', name };
    }
    return {
      kind: 'missing',
      name,
      note: 'not in the database yet; the backend builds it at startup (existing data must satisfy it if unique)',
    };
  });
}

/** True when a finding would stop the backend from starting. */
export const blocksStartup = (f: Finding) =>
  f.kind === 'name-clash' || f.kind === 'option-clash';
