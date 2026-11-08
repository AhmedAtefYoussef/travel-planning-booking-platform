import { INestApplication } from '@nestjs/common';

export const API_PREFIX = 'api';

/**
 * Applies every global setting the running app needs. main.ts, the e2e tests and the OpenAPI
 * generator all call this, so tests and the Swagger contract see exactly what production serves.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  return app;
}
