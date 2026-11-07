import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

export const API_PREFIX = 'api';

/**
 * Applies the HTTP-level settings that are not DI providers. main.ts, the e2e tests and the OpenAPI
 * generator all call this, so tests and the Swagger contract see exactly what production serves.
 * (The global ValidationPipe and AllExceptionsFilter are registered in CommonModule.)
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  // Auth uses httpOnly cookies (ACC-19); the frontend calls the API with credentials.
  app.use(cookieParser());
  const origins = (app.get(ConfigService).get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : false,
    credentials: true,
  });
  app.enableShutdownHooks();
  return app;
}
