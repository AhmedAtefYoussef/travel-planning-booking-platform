import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import {
  SWAGGER_PATH,
  isSwaggerEnabled,
  setupSwagger,
} from './common/swagger/swagger.setup';

async function bootstrap(): Promise<void> {
  // rawBody: the Stripe webhook (PAY-01) verifies the signature against the exact request bytes.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  const config = app.get(ConfigService);
  const swagger = isSwaggerEnabled(
    config.get<string>('NODE_ENV'),
    config.get<boolean>('SWAGGER_ENABLED'),
  );
  if (swagger) setupSwagger(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(
    `API on http://localhost:${port}/api, ` +
      (swagger
        ? `Swagger on /${SWAGGER_PATH}`
        : 'Swagger disabled (SWAGGER_ENABLED)'),
    'Bootstrap',
  );
}

void bootstrap();
