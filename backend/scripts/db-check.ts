/**
 * TRVL-128: confirms this machine reaches the shared MongoDB Atlas cluster with the credentials in
 * backend/.env, and that the deployment supports transactions (needed for HTL-18).
 * Usage (from backend/): npm run db:check
 * Prints only the cluster host, never the username, password or full connection string.
 */
import { existsSync } from 'node:fs';
import mongoose from 'mongoose';

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
    console.error(
      'MONGODB_URI is not set. Copy ../.env.example to backend/.env and fill it in.',
    );
    process.exit(1);
  }

  console.log(`Connecting to ${redactedHost(uri)} ...`);
  const started = Date.now();
  const conn = await mongoose
    .createConnection(uri, { serverSelectionTimeoutMS: 10_000 })
    .asPromise();
  try {
    const admin = conn.db!.admin();
    const hello = (await admin.command({ hello: 1 })) as {
      setName?: string;
      isWritablePrimary?: boolean;
    };
    const info = (await admin.command({ buildInfo: 1 })) as {
      version?: string;
    };

    const session = await conn.startSession();
    let transactions = false;
    try {
      await session.withTransaction(async () => {
        await conn.db!.collection('_db_check').findOne({}, { session });
      });
      transactions = true;
    } catch {
      transactions = false;
    } finally {
      await session.endSession();
    }

    console.log(
      [
        `OK in ${Date.now() - started} ms`,
        `  database:      ${conn.name}`,
        `  server:        MongoDB ${info.version ?? '?'}`,
        `  replica set:   ${hello.setName ?? 'none (standalone)'}`,
        `  writable:      ${hello.isWritablePrimary ? 'yes' : 'no'}`,
        `  transactions:  ${transactions ? 'supported' : 'NOT supported (HTL-18 needs a replica set)'}`,
      ].join('\n'),
    );
    if (!transactions) process.exitCode = 1;
  } finally {
    await conn.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // Driver messages can include the host but never the password; keep them for troubleshooting.
  console.error(`Connection failed: ${message}`);
  console.error(
    'Check: IP access list in Atlas, database user/password in backend/.env, VPN or firewall.',
  );
  process.exit(1);
});
