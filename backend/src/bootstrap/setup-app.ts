import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { setupSwagger } from '../common/swagger/setup-swagger';

/** Shared by main.ts and tests so both run the same pipeline. */
export function setupApp(app: INestApplication): INestApplication {
  app.use(cookieParser());
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  setupSwagger(app);
  return app;
}
