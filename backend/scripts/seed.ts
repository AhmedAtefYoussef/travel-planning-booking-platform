/**
 * GEN-12: seeds the reference data (countries, cities, airports, attractions and currencies) from the
 * official datasets in backend/seed/data into the database in backend/.env.
 * Usage (from backend/): npm run seed
 * Safe to run again: records are upserted by their dataset ids, never duplicated or deleted.
 * The files are validated first; if any rule fails, nothing is written and every problem is listed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Validate the files before connecting, so a bad dataset never reaches the database.
  const dataset = loadReferenceDataset(DATA_DIR);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const result = await app.get(ReferenceSeedService).seed(dataset);
    console.table(result);
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
