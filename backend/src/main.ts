import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { SWAGGER_PATH, setupSwagger } from './common/swagger/swagger.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  setupSwagger(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(
    `API on http://localhost:${port}/api, Swagger on /${SWAGGER_PATH}`,
    'Bootstrap',
  );
}

void bootstrap();
