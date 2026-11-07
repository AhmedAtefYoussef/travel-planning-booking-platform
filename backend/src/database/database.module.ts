import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { EnvironmentVariables } from '../config/env.validation';

/**
 * One shared MongoDB Atlas connection for the whole app (brief sections 1.1 and 8.11).
 * Atlas is a replica set, so multi-document transactions are available (HTL-18 all-or-nothing holds).
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        // Indexes (unique emails, unique room nights, ...) are part of the business rules: build them.
        autoIndex: true,
        serverSelectionTimeoutMS: 10_000,
        connectionFactory: (connection: Connection) => {
          connection.on('connected', () =>
            Logger.log(`MongoDB connected (${connection.name})`, 'Database'),
          );
          connection.on('disconnected', () =>
            Logger.warn('MongoDB disconnected', 'Database'),
          );
          return connection;
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
