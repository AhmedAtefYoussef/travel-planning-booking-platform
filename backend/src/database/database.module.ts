import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
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
export class DatabaseModule implements OnApplicationBootstrap {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Unique indexes are business rules (unique email, one room per night, one success per booking).
   * Mongoose builds them in the background, so the app waits for every model's index build before it
   * starts serving; otherwise a request right after startup could slip a duplicate past the index.
   */
  async onApplicationBootstrap(): Promise<void> {
    const names = this.connection.modelNames();
    await Promise.all(names.map((name) => this.connection.model(name).init()));
    Logger.log(`Indexes ready for ${names.length} model(s)`, 'Database');
  }
}
