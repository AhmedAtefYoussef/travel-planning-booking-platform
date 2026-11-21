import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  UPCOMING_BOOKINGS,
  type UpcomingBookings,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PasswordService } from '../../common/security/password.service';
import { AccountStatus, User } from './schemas/user.schema';
import { SessionsService } from './sessions.service';

/**
 * ACC-12: a registered user deactivates their own account. The password is the confirmation. It is
 * refused while the user has upcoming Confirmed bookings (UPCOMING_BOOKINGS, provided by the bookings
 * modules). On success the account is DEACTIVATED and every session is revoked, so the user is logged
 * out everywhere and can no longer log in (ACC-04 answers a deactivated account with the generic 401).
 */
@Injectable()
export class DeactivationService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    // Required, not optional: without it deactivation would silently ignore bookings (fail open).
    @Inject(UPCOMING_BOOKINGS)
    private readonly bookings: UpcomingBookings,
  ) {}

  async deactivate(
    caller: AuthUser,
    password: string,
    now = new Date(),
  ): Promise<void> {
    const user = Types.ObjectId.isValid(caller.id)
      ? await this.users.findById(caller.id).select('+passwordHash').lean()
      : null;
    if (!user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'This account no longer exists; please log in again',
      );
    }
    if (!(await this.passwords.verify(password, user.passwordHash))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        [{ field: 'password', message: 'password is incorrect' }],
      );
    }

    const upcoming = await this.bookings.countUpcomingConfirmed(caller.id, now);
    if (upcoming > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.UPCOMING_BOOKINGS_EXIST,
        `You have ${upcoming} upcoming confirmed booking${upcoming === 1 ? '' : 's'}. ` +
          'Cancel them or wait until your trips are over before deactivating your account.',
      );
    }

    // Only an ACTIVE account can be deactivated; the filter makes the change happen once.
    const res = await this.users.updateOne(
      { _id: new Types.ObjectId(caller.id), status: AccountStatus.Active },
      { $set: { status: AccountStatus.Deactivated } },
    );
    if (res.matchedCount === 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        'Only an active account can be deactivated',
      );
    }
    await this.sessions.revokeAllForUser(caller.id, {}, now);
  }
}
