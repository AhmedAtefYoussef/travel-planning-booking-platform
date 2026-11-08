/**
 * Boots the Nest app (against a throwaway in-memory MongoDB, no credentials needed) without listening
 * and writes the OpenAPI document. CI runs this, then scripts/check-openapi.ts, on every PR.
 * Usage: npm run openapi:generate [-- <outFile>]
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { writeFileSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type * as NestCore from '@nestjs/core';
import type * as AppModuleNs from '../src/app.module';
import type * as AppSetupNs from '../src/app.setup';
import type * as SwaggerNs from '../src/common/swagger/swagger.setup';
import { applyTestEnv } from '../test/support/test-env';

async function main(): Promise<void> {
  const outFile = process.argv[2] ?? 'openapi.json';
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('openapi');
  applyTestEnv();

  // Loaded only after the environment is set: ConfigModule validates process.env when imported.
  const { NestFactory } = require('@nestjs/core') as typeof NestCore;
  const { AppModule } = require('../src/app.module') as typeof AppModuleNs;
  const { configureApp } = require('../src/app.setup') as typeof AppSetupNs;
  const { buildOpenApiDocument } =
    require('../src/common/swagger/swagger.setup') as typeof SwaggerNs;

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  configureApp(app);
  await app.init();
  const document = buildOpenApiDocument(app);
  writeFileSync(outFile, JSON.stringify(document, null, 2) + '\n');
  await app.close();
  await mongo.stop();
  console.log(
    `OpenAPI written to ${outFile} (${Object.keys(document.paths).length} paths)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
