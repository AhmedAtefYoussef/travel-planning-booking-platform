import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { UPLOADS_URL_PREFIX } from './modules/uploads';
import cookieParser from 'cookie-parser';

export const API_PREFIX = 'api';

/**
 * Applies the HTTP-level settings that are not DI providers. main.ts, the e2e tests and the OpenAPI
 * generator all call this, so tests and the Swagger contract see exactly what production serves.
 * (The global ValidationPipe, AllExceptionsFilter and GEN-05 middleware are registered in CommonModule.)
 * rawBody cannot be set here: pass { rawBody: true } to NestFactory.create (the Stripe webhook needs it).
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  // Do not advertise the server stack (x-powered-by: Express) to clients.
  (
    app.getHttpAdapter().getInstance() as {
      disable?: (setting: string) => void;
    }
  ).disable?.('x-powered-by');
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
  serveUploads(app);
  app.enableShutdownHooks();
  return app;
}

/**
 * GEN-08 "stored on the server and served by URL": files under UPLOAD_DIR are served read-only at
 * /uploads/<folder>/<file>, outside the /api prefix. Only files are served (no directory index, no
 * dotfiles). Browsers are told not to guess a content type and not to run anything from a response,
 * so an upload can only ever be displayed as an image.
 */
function serveUploads(app: INestApplication): void {
  const directory = resolve(
    app.get(ConfigService).get<string>('UPLOAD_DIR') ?? './uploads',
  );
  (app as NestExpressApplication).useStaticAssets(directory, {
    prefix: `${UPLOADS_URL_PREFIX}/`,
    index: false,
    dotfiles: 'deny',
    redirect: false,
    setHeaders: (res: { setHeader(name: string, value: string): void }) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
    },
  });
}
