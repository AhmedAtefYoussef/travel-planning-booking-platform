import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { createValidationPipe } from './pipes/validation.pipe';

/**
 * Registers the global pipe and filter through DI, so they apply identically in main.ts,
 * e2e tests (Test.createTestingModule) and the OpenAPI generator.
 */
@Module({
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class CommonModule {}
