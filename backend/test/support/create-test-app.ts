import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

/** Boots the real AppModule (plus optional test-only modules) exactly as main.ts configures it. */
export async function createTestApp(
  extraModules: Type<unknown>[] = [],
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    rawBody: true,
    logger: process.env.E2E_LOGS ? ['error', 'warn'] : false,
  });
  configureApp(app);
  await app.init();
  return app;
}
