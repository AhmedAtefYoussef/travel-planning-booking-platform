import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto, FieldErrorDto } from '../errors/error-response.dto';
import { PaginatedResponseDto } from '../pagination/pagination';

export const SWAGGER_PATH = 'api/docs';
export const AUTH_COOKIE = 'access_token';
/** Temporary stub-auth header (TRVL-131); removed together with AuthStubGuard in ACC-11. */
export const DEV_USER_SECURITY = 'dev-user';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Travel Planning & Booking Platform API')
    .setDescription(
      [
        'NestJS REST API (Milestone 1). Every operation summary starts with its requirement ID from the official workbook.',
        '',
        '* Errors always use the `ErrorResponseDto` shape; validation failures list `fieldErrors` (GEN-02).',
        '* Lists are paginated with a fixed page size of 10; pass `page` only (GEN-05).',
        '* Money is in integer minor units of the platform currency (PAY-04); instants are UTC ISO strings.',
        '* Authentication uses the httpOnly `access_token` cookie set by `POST /api/auth/login` (ACC-19).',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addCookieAuth(
      AUTH_COOKIE,
      { type: 'apiKey', in: 'cookie', name: AUTH_COOKIE },
      AUTH_COOKIE,
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-dev-user',
        description:
          'TEMPORARY stub auth (AUTH_STUB=true, non-production, localhost only). Format ROLE, ROLE:userId or ROLE:userId:providerId (24-hex ids), e.g. ADMIN, USER, HOTEL_MODERATOR. Replaced by the access_token cookie in ACC-11.',
      },
      DEV_USER_SECURITY,
    )
    .build();
  return SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponseDto, FieldErrorDto, PaginatedResponseDto],
  });
}

export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      withCredentials: true,
      tagsSorter: 'alpha',
    },
    customSiteTitle: 'Travel Platform API',
  });
  return document;
}
