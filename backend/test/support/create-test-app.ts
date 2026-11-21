import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

/** Replaces a real provider with a test double, wherever the token is provided. */
export interface ProviderOverride {
  provide: string | symbol | Type<unknown>;
  useValue: unknown;
}

/**
 * Boots the real AppModule (plus optional test-only modules) exactly as main.ts configures it.
 * Use `overrides` to stand in for a provider the app already has (e.g. UPCOMING_BOOKINGS): a second
 * global module providing the same token would be silently ignored in favour of the real one.
 */
export async function createTestApp(
  extraModules: Type<unknown>[] = [],
  overrides: ProviderOverride[] = [],
): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  });
  for (const { provide, useValue } of overrides) {
    builder.overrideProvider(provide).useValue(useValue);
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
