import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SESSION_VALIDATOR } from '../../common/contracts';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminSeedService } from './admin-seed.service';
import { DeactivationService } from './deactivation.service';
import { ProfileService } from './profile.service';
import { Session, SessionSchema } from './schemas/session.schema';
import { User, UserSchema } from './schemas/user.schema';
import { SessionValidatorService } from './session-validator.service';
import { SessionsService } from './sessions.service';
import { UsersController } from './users.controller';
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
  controllers: [UsersController, AdminAccountsController],
  providers: [
    AdminSeedService,
    ProfileService,
    AdminAccountsService,
    DeactivationService,
    UsersService,
    SessionsService,
    SessionValidatorService,
    { provide: SESSION_VALIDATOR, useExisting: SessionValidatorService },
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
