/**
 * Boots the Nest app without listening and writes the OpenAPI document to openapi.json.
 * CI runs this, then scripts/check-openapi.ts, so the Swagger contract is checked on every PR.
 * Usage: npm run openapi:generate [-- <outFile>]
 */
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { buildOpenApiDocument } from '../src/common/swagger/swagger.setup';

async function main(): Promise<void> {
  const outFile = process.argv[2] ?? 'openapi.json';
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  configureApp(app);
  await app.init();
  const document = buildOpenApiDocument(app);
  writeFileSync(outFile, JSON.stringify(document, null, 2) + '\n');
  await app.close();
  console.log(
    `OpenAPI written to ${outFile} (${Object.keys(document.paths).length} paths)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
