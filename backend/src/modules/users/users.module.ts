import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ACCOUNT_ADMIN,
  SESSION_VALIDATOR,
  USER_CONTACTS,
} from '../../common/contracts';
import { AccountAdminService } from './account-admin.service';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminSeedService } from './admin-seed.service';
import { DeactivationService } from './deactivation.service';
import { ModeratorsService } from './moderators.service';
import { ProfileService } from './profile.service';
import { ProviderDirectoryService } from './provider-directory.service';
import { Session, SessionSchema } from './schemas/session.schema';
import { User, UserSchema } from './schemas/user.schema';
import { SessionValidatorService } from './session-validator.service';
import { SessionsService } from './sessions.service';
import { UserContactsService } from './user-contacts.service';
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
    ModeratorsService,
    ProviderDirectoryService,
    DeactivationService,
    UsersService,
    SessionsService,
    SessionValidatorService,
    { provide: SESSION_VALIDATOR, useExisting: SessionValidatorService },
    AccountAdminService,
    { provide: ACCOUNT_ADMIN, useExisting: AccountAdminService },
    UserContactsService,
    { provide: USER_CONTACTS, useExisting: UserContactsService },
  ],
  exports: [
    MongooseModule,
    AdminSeedService,
    UsersService,
    SessionsService,
    SESSION_VALIDATOR,
    ACCOUNT_ADMIN,
    USER_CONTACTS,
  ],
})
export class UsersModule {}
