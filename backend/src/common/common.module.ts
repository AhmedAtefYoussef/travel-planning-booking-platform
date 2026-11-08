import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { RejectPageSizeMiddleware } from './pagination/reject-page-size.middleware';
import { createValidationPipe } from './pipes/validation.pipe';

/**
 * Registers the global pipe, filter and middleware through DI, so they apply identically in main.ts,
 * e2e tests (Test.createTestingModule) and the OpenAPI generator.
 */
@Module({
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RejectPageSizeMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
