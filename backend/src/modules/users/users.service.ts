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
  /** ACC-05 consecutive failures so far, and the end of an active or past lock. */
  failedLoginCount: number;
  lockedUntil?: Date;
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
      failedLoginCount: user.failedLoginCount ?? 0,
      ...(user.lockedUntil ? { lockedUntil: user.lockedUntil } : {}),
      user: toUserProfile(user),
    };
  }

  /**
   * ACC-05 gate, the first step of every login of an existing account: atomically counts this attempt
   * before the password is checked, but only while the account is not locked and fewer than
   * `maxAttempts` attempts are counted. Parallel requests therefore get at most `maxAttempts`
   * password checks per lock period. Attempts last counted more than `staleMs` ago cannot be in flight
   * any more (a login takes well under a second), so they never keep the gate closed. Returns the
   * attempt number, or null when the gate is closed.
   */
  async claimLoginAttempt(
    id: string,
    maxAttempts: number,
    now = new Date(),
    staleMs = 30_000,
  ): Promise<number | null> {
    const user = await this.users
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          $and: [
            this.notLockedAt(now),
            {
              $or: [
                { failedLoginCount: { $lt: maxAttempts } },
                { failedLoginCount: { $exists: false } },
                {
                  lastLoginAttemptAt: {
                    $lt: new Date(now.getTime() - staleMs),
                  },
                },
                { lastLoginAttemptAt: { $exists: false } },
              ],
            },
          ],
        },
        { $inc: { failedLoginCount: 1 }, $set: { lastLoginAttemptAt: now } },
        { new: true, projection: { failedLoginCount: 1 } },
      )
      .lean();
    return user ? user.failedLoginCount : null;
  }

  /**
   * ACC-05: called only after a password check really failed as attempt number `maxAttempts`. Locks the
   * account for `lockMs` (resetting the counter) if the count still reaches the limit, i.e. no success
   * reset it meanwhile. Returns the lock that applies now, or null when there is none.
   */
  async lockAfterLimit(
    id: string,
    maxAttempts: number,
    lockMs: number,
    now = new Date(),
  ): Promise<Date | null> {
    const lockUntil = new Date(now.getTime() + lockMs);
    const locked = await this.users
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          failedLoginCount: { $gte: maxAttempts },
          ...this.notLockedAt(now),
        },
        { $set: { lockedUntil: lockUntil, failedLoginCount: 0 } },
        { new: true, projection: { lockedUntil: 1 } },
      )
      .lean();
    if (locked?.lockedUntil) return locked.lockedUntil;
    return this.activeLockOf(id, now);
  }

  /** ACC-05: the end of the lock in force, or null when the account is not locked. Never writes. */
  async activeLockOf(id: string, now = new Date()): Promise<Date | null> {
    const user = await this.users.findById(id).select('lockedUntil').lean();
    return user?.lockedUntil && user.lockedUntil > now
      ? user.lockedUntil
      : null;
  }

  /**
   * ACC-05: a successful login resets the counter, but only if no lock is active. A lock set by parallel
   * failures after this attempt started is never cleared. Returns false when such a lock applies.
   */
  async releaseLoginAttempts(id: string, now = new Date()): Promise<boolean> {
    const res = await this.users.updateOne(
      { _id: new Types.ObjectId(id), ...this.notLockedAt(now) },
      { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: 1 } },
    );
    return res.matchedCount === 1;
  }

  private notLockedAt(now: Date) {
    return {
      $or: [
        { lockedUntil: { $exists: false } },
        { lockedUntil: null },
        { lockedUntil: { $lte: now } },
      ],
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

  /** ACC-08: the stored hash of an account, for checking the current password; null when gone. */
  async findPasswordHash(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const user = await this.users.findById(id).select('+passwordHash').lean();
    return user?.passwordHash ?? null;
  }

  /**
   * ACC-08 (and ACC-07a/ACC-13 later): stores a new password hash. `mustChangePassword` is cleared when
   * the owner chose the password, and set when an admin issued a temporary one.
   */
  async setPassword(
    id: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void> {
    await this.users.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { passwordHash, mustChangePassword } },
    );
  }
}
