/**
 * READ-ONLY. Lists the indexes the shared database already has and compares them with the indexes
 * the Mongoose schemas declare, so an index that would stop the backend from starting (for example the
 * same index under another name, MongoDB error 85) is found before startup.
 *
 * Usage (from backend/): npm run db:indexes
 * It only runs listCollections and listIndexes. It never creates, changes or drops an index, a
 * collection or a document, compiles no models, and prints no credentials.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import mongoose, { Schema } from 'mongoose';
import {
  blocksStartup,
  compareIndexes,
  type DeclaredIndex,
  type ExistingIndex,
} from './index-check-rules';

const SRC = join(__dirname, '..', 'src');

function schemaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return schemaFiles(path);
    return entry.endsWith('.schema.ts') ? [path] : [];
  });
}

/** Top-level schemas with their collection: `export const XSchema` -> model X. */
function declaredSchemas(): {
  model: string;
  collection: string;
  schema: Schema;
}[] {
  const pluralize = mongoose.pluralize();
  const found = new Map<
    string,
    { model: string; collection: string; schema: Schema }
  >();
  for (const file of schemaFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const [exportName, value] of Object.entries(mod)) {
      if (!(value instanceof Schema) || !exportName.endsWith('Schema'))
        continue;
      const schema: Schema = value as Schema;
      const model = exportName.slice(0, -'Schema'.length);
      const configured: unknown = schema.get('collection');
      const collection =
        typeof configured === 'string'
          ? configured
          : pluralize
            ? pluralize(model)
            : model;
      if (schema.indexes().length === 0) continue; // embedded sub-schemas declare none
      found.set(collection, { model, collection, schema });
    }
  }
  return [...found.values()];
}

function redactedHost(uri: string): string {
  try {
    return (
      new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).host ||
      '(unknown host)'
    );
  } catch {
    return '(unparseable URI)';
  }
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set (backend/.env).');
    process.exit(1);
  }
  const schemas = declaredSchemas();
  console.log(`Reading indexes on ${redactedHost(uri)} (read-only) ...`);
  const conn = await mongoose
    .createConnection(uri, {
      serverSelectionTimeoutMS: 10_000,
      autoIndex: false,
      autoCreate: false,
    })
    .asPromise();
  let blocking = 0;
  try {
    const db = conn.db!;
    const collections = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map(
        (c) => c.name,
      ),
    );
    for (const { model, collection, schema } of schemas) {
      const declared: DeclaredIndex[] = schema
        .indexes()
        .map(([key, options]): DeclaredIndex => ({
          ...(options as Omit<DeclaredIndex, 'key'>),
          key,
        }));
      const existing: ExistingIndex[] = collections.has(collection)
        ? ((await db
            .collection(collection)
            .listIndexes()
            .toArray()) as ExistingIndex[])
        : [];
      const findings = compareIndexes(declared, existing);
      const problems = findings.filter(blocksStartup);
      blocking += problems.length;
      const label = `${collection} (${model})`;
      if (!problems.length) {
        const missing = findings.filter((f) => f.kind === 'missing').length;
        console.log(
          `  ok   ${label}${missing ? `, ${missing} index(es) still to be built` : ''}`,
        );
      } else {
        for (const p of problems) console.log(`  FAIL ${label}: ${p.note}`);
      }
    }
  } finally {
    await conn.close();
  }
  console.log(
    blocking
      ? `\n${blocking} index problem(s) would stop the backend from starting. Nothing was changed.`
      : '\nNo index would stop the backend from starting. Nothing was changed.',
  );
  console.log(
    `(checked ${schemas.length} schemas from ${relative(process.cwd(), SRC)})`,
  );
  process.exit(blocking ? 2 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
