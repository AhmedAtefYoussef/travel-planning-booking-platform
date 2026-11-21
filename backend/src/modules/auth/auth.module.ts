import { Module } from '@nestjs/common';
import { UsersModule } from '../users';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/** /api/auth/* (ACC-01 now; ACC-04, ACC-05, ACC-06 and ACC-19 add login, lockout, logout and cookies). */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
