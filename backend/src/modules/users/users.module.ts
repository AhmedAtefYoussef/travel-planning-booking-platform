import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminSeedService } from './admin-seed.service';
import { Session, SessionSchema } from './schemas/session.schema';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';

/**
 * Accounts and sessions (TRVL-137, ACC-18). Both schemas are registered here so their indexes (unique
 * email, unique refresh-token hash, sessions TTL) are built at startup. The auth module (ACC-04 onwards)
 * imports this module for the models.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  providers: [AdminSeedService, UsersService],
  exports: [MongooseModule, AdminSeedService, UsersService],
})
export class UsersModule {}
