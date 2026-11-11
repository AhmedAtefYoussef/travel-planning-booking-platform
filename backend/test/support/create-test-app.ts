import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

/** A provider the test replaces, e.g. a contract token whose real implementation now exists. */
export interface ProviderOverride {
  provide: string | symbol | Type<unknown>;
  useValue: unknown;
}

/**
 * Boots the real AppModule (plus optional test-only modules) exactly as main.ts configures it.
 * `overrides` replace providers the app already has (Nest's overrideProvider); extra modules can only
 * add providers that nothing else provides.
 */
export async function createTestApp(
  extraModules: Type<unknown>[] = [],
  overrides: ProviderOverride[] = [],
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  });
  for (const o of overrides) {
    builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    rawBody: true,
    logger: process.env.E2E_LOGS ? ['error', 'warn'] : false,
  });
  configureApp(app);
  await app.init();
  return app;
}
