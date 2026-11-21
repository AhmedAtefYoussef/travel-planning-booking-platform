import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Loads backend/.env (ignored in tests, which set process.env directly) and validates it at startup.
 * Inject typed config with: constructor(private readonly config: ConfigService<EnvironmentVariables, true>)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
