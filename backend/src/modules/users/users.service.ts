import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
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

/** What login needs: the account plus its password hash (never selected anywhere else). */
export interface LoginCandidate {
  id: string;
  status: AccountStatus;
  passwordHash: string;
  user: UserProfileDto;
}

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

  /** ACC-04: looks an account up by email (case-insensitive, emails are stored lowercased). */
  async findForLogin(email: string): Promise<LoginCandidate | null> {
    const user = await this.users
      .findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash');
    if (!user) return null;
    return {
      id: user._id.toHexString(),
      status: user.status,
      passwordHash: user.passwordHash,
      user: toUserProfile(user),
    };
  }

  /** ACC-19: the profile behind /auth/me; null when the account no longer exists. */
  async findProfile(id: string): Promise<UserProfileDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const user = await this.users.findById(id);
    return user ? toUserProfile(user) : null;
  }

  /** Upgrades a hash made with an older bcrypt cost after a successful login. */
  async replacePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.users.updateOne({ _id: id }, { $set: { passwordHash } });
  }
}
