import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SESSION_VALIDATOR } from '../../common/contracts';
import { AdminSeedService } from './admin-seed.service';
import { Session, SessionSchema } from './schemas/session.schema';
import { User, UserSchema } from './schemas/user.schema';
import { SessionsService } from './sessions.service';
import { UsersService } from './users.service';

/**
 * Accounts and sessions (TRVL-137, ACC-18). Both schemas are registered here so their indexes (unique
 * email, unique refresh-token hash, sessions TTL) are built at startup. The auth module (ACC-04 onwards)
 * imports this module for the models.
 * Global so the AuthGuard in common/ can inject SESSION_VALIDATOR (ACC-06) without importing a module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  providers: [
    AdminSeedService,
    UsersService,
    SessionsService,
    { provide: SESSION_VALIDATOR, useExisting: SessionsService },
  ],
  exports: [
    MongooseModule,
    AdminSeedService,
    UsersService,
    SessionsService,
    SESSION_VALIDATOR,
  ],
})
export class UsersModule {}
