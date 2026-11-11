/**
 * GEN-12: seeds the reference data (countries, cities, airports, attractions and currencies) from the
 * official datasets in backend/seed/data into the database in backend/.env.
 * ACC-18: then creates the admin account from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD (admins cannot
 * self-register, so this is the only way an admin account is created).
 * Usage (from backend/): npm run seed
 * Safe to run again: records are upserted by their dataset ids, never duplicated or deleted, and an
 * existing admin is left unchanged.
 * The files are validated first; if any rule fails, nothing is written and every problem is listed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import type { EnvironmentVariables } from '../src/config/env.validation';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import {
  AdminSeedService,
  meetsPasswordRules,
  PASSWORD_RULE_MESSAGE,
} from '../src/modules/users';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Validate the files and the admin password before connecting, so a bad input never writes anything.
  const dataset = loadReferenceDataset(DATA_DIR);
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (adminPassword !== undefined && !meetsPasswordRules(adminPassword)) {
    throw new Error(`ADMIN_SEED_PASSWORD: ${PASSWORD_RULE_MESSAGE}`);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const result = await app.get(ReferenceSeedService).seed(dataset);
    console.table(result);

    const config = app.get(ConfigService<EnvironmentVariables, true>);
    const admin = await app.get(AdminSeedService).seedAdmin({
      email: config.get('ADMIN_SEED_EMAIL', { infer: true }),
      password: config.get('ADMIN_SEED_PASSWORD', { infer: true }),
    });
    console.table([admin]);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Seed',
  );
  process.exit(1);
});
