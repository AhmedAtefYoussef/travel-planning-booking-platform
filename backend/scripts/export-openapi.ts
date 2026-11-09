/**
 * Exports the OpenAPI document from the real, running AppModule to
 * docs/api/openapi.json. Uses an in-memory MongoDB replica set and a stub
 * Stripe key, so no external service or secret is needed.
 *
 *   npm run openapi:export
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const OUTPUT = resolve(__dirname, '../../docs/api/openapi.json');

async function main(): Promise<void> {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  let app: INestApplication | undefined;
  try {
    // ConfigModule validates env when AppModule is imported, so set it first.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DEV_AUTH_ENABLED: 'true',
      MONGODB_URI: mongo.getUri('openapi_export'),
      JWT_SECRET: 'openapi-export-placeholder-'.padEnd(40, 'x'),
      PLATFORM_CURRENCY: 'USD',
      STRIPE_SECRET_KEY: 'sk_test_openapi_export_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_openapi_export_placeholder',
      FX_API_BASE_URL: 'http://127.0.0.1:9',
      FX_API_KEY: 'openapi-export',
      UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'openapi-export-uploads-')),
    });

    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('../src/app.module');
    const { setupApp } = require('../src/bootstrap/setup-app');
    const request = require('supertest');
    const created: INestApplication = await NestFactory.create(AppModule, {
      rawBody: true,
      logger: false,
    });
    app = created;
    created.setGlobalPrefix('api');
    setupApp(created);
    await created.init();

    const res = await request(created.getHttpServer()).get('/api/docs-json');
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    if (res.status !== 200) {
      throw new Error(`GET /api/docs-json answered ${res.status}`);
    }
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, JSON.stringify(res.body, null, 2) + '\n', 'utf8');
    console.log(`OpenAPI document written to ${OUTPUT}`);
  } finally {
    await app?.close();
    await mongo.stop();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
