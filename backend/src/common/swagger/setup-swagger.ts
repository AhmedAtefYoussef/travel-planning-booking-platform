import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const DEV_AUTH_HEADERS = [
  'x-dev-user-id',
  'x-dev-role',
  'x-dev-provider',
] as const;

/** False when there is no ConfigModule (e.g. minimal test apps). */
function devAuthEnabled(app: INestApplication): boolean {
  try {
    return (
      app
        .get(ConfigService, { strict: false })
        .get<boolean>('DEV_AUTH_ENABLED') === true
    );
  } catch {
    return false;
  }
}

/** Swagger UI at /api/docs, OpenAPI JSON at /api/docs-json. */
export function setupSwagger(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('Travel Planning and Booking API')
    .setDescription(
      'Every error has the shape {statusCode, error, message, fieldErrors?, path, timestamp}.',
    )
    .setVersion('1.0')
    .addBearerAuth();

  // The dev guard only honours these headers when DEV_AUTH_ENABLED=true, so
  // only then do they appear under "Authorize" (and apply to every route).
  if (devAuthEnabled(app)) {
    for (const name of DEV_AUTH_HEADERS) {
      builder.addApiKey({ type: 'apiKey', in: 'header', name }, name);
    }
    builder.addSecurityRequirements(
      Object.fromEntries(DEV_AUTH_HEADERS.map((n) => [n, []])),
    );
  }

  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
}
