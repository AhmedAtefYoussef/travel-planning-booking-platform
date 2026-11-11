import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { toUserProfile, type UserProfileDto } from './dto/user-profile.dto';
import { AccountStatus, User } from './schemas/user.schema';

export interface NewTraveller {
  name: string;
  email: string;
  passwordHash: string;
  termsAcceptedAt: Date;
}

const DUPLICATE_KEY = 11000;

/** Account persistence for the auth and admin flows. The only writer of `users` besides the admin seed. */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /**
   * ACC-01: a guest becomes an active USER. The role is fixed here, never taken from the request, so
   * nobody can register as an admin or moderator (ACC-18, ACC-13). The unique email index decides
   * duplicates, so two simultaneous sign-ups with one email create one account.
   */
  async createTraveller(input: NewTraveller): Promise<UserProfileDto> {
    try {
      const user = await this.users.create({
        ...input,
        role: Role.User,
        status: AccountStatus.Active,
        mustChangePassword: false,
      });
      return toUserProfile(user);
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.EMAIL_ALREADY_REGISTERED,
          'This email is already registered',
          [{ field: 'email', message: 'email is already registered' }],
        );
      }
      throw error;
    }
  }
}
