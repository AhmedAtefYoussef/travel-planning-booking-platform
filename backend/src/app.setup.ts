import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';

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
  // GEN-02: register the JSON parser here (Nest then skips its default one, keeping rawBody) and follow it
  // with an error handler. Otherwise Nest turns the parser's SyntaxError into a BadRequestException that
  // carries the raw JSON.parse text, which echoes fragments of the request body back to the client.
  (app as NestExpressApplication).useBodyParser?.('json');
  app.use(maskMalformedJson);
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
 * GEN-08: stored images are public and served by URL at /uploads/<folder>/<file>, outside the /api
 * prefix and before any guard. Only files are served: no directory index or redirect, dotfiles denied.
 * `nosniff` makes the browser trust the image Content-Type (taken from the .jpg/.png extension that the
 * upload service chose from the file's bytes) instead of guessing, and the CSP stops a file from running
 * anything if it is ever opened as a document.
 */
function serveUploads(app: INestApplication): void {
  const dir = app.get(ConfigService).get<string>('UPLOAD_DIR');
  if (!dir) return;
  (app as NestExpressApplication).useStaticAssets?.(resolve(dir), {
    prefix: '/uploads/',
    index: false,
    redirect: false,
    dotfiles: 'deny',
    fallthrough: true,
    setHeaders: (res: { setHeader(name: string, value: string): void }) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    },
  });
}

/**
 * Express error middleware placed right after the JSON parser. A body-parser parse failure becomes a
 * plain client error ({ status: 400, expose, type }) that AllExceptionsFilter maps to the generic
 * "Malformed JSON request body"; every other error passes through unchanged.
 */
export function maskMalformedJson(
  err: unknown,
  _req: unknown,
  _res: unknown,
  next: (err?: unknown) => void,
): void {
  const parseFailed =
    err instanceof SyntaxError &&
    (err as SyntaxError & { type?: unknown }).type === 'entity.parse.failed';
  next(
    parseFailed
      ? Object.assign(new Error('Malformed JSON request body'), {
          status: 400,
          statusCode: 400,
          expose: true,
          type: 'entity.parse.failed',
        })
      : err,
  );
}
