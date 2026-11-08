import {
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthStubGuard } from './auth/auth-stub.guard';
import { RolesGuard } from './auth/roles.guard';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { RejectPageSizeMiddleware } from './pagination/reject-page-size.middleware';
import { createValidationPipe } from './pipes/validation.pipe';
import { PasswordService } from './security/password.service';

/**
 * Registers the global pipe, filter, guards and middleware through DI, so they apply identically in
 * main.ts, e2e tests (Test.createTestingModule) and the OpenAPI generator.
 *
 * Guard order matters: authentication first (sets request.user), then roles. ACC-11 replaces
 * AuthStubGuard with the real cookie/JWT guard in this list; RolesGuard stays.
 */
@Global()
@Module({
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AuthStubGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    PasswordService,
  ],
  exports: [PasswordService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RejectPageSizeMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
