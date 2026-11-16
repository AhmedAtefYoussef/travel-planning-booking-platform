/**
 * TRVL-135: seeds the demo airline, hotel, flights, rooms and accounts used by the Swagger walkthrough
 * (docs/api/demo-script.md). Run `npm run seed` first: it needs the reference data (airports, cities).
 * Usage (from backend/): npm run seed:demo
 * Reads DEMO_PASSWORD from backend/.env: the password of the demo moderators and traveller.
 * Safe to run again: existing demo records are left unchanged and nothing is duplicated.
 */
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { resolveDemoPassword } from './demo-data';
import { seedDemo } from './demo-seed';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Checked before connecting, so a missing or weak password never writes anything.
  const password = resolveDemoPassword(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const result = await seedDemo(app, password);
    console.log(
      result.created.length
        ? `Demo data created or completed: ${result.created.join(', ')}`
        : 'Demo data already complete; nothing changed',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'SeedDemo',
  );
  process.exit(1);
});
