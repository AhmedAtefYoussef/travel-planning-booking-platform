import {
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/env.validation';
import { AuthGuard } from './auth/auth.guard';
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
 * Guard order matters: authentication first (sets request.user), then roles. AuthGuard reads the
 * access_token cookie (ACC-19) and falls back to AuthStubGuard only when there is no cookie.
 * JwtModule signs and verifies access tokens with JWT_SECRET (HS256) for every module.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }),
        },
      }),
    }),
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    AuthStubGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    PasswordService,
  ],
  exports: [PasswordService, JwtModule],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RejectPageSizeMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
