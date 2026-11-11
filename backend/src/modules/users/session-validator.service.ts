import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import type { SessionCheck, SessionValidator } from '../../common/contracts';
import { User } from './schemas/user.schema';
import { SessionsService } from './sessions.service';

/**
 * SESSION_VALIDATOR (ACC-06, ACC-11): the global AuthGuard calls this on every cookie request. The
 * session check is atomic (SessionsService.touch); the account is then read fresh, so suspension,
 * deactivation, a role change or a new provider assignment applies from the next request.
 */
@Injectable()
export class SessionValidatorService implements SessionValidator {
  constructor(
    private readonly sessions: SessionsService,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async touch(sessionId: string, userId: string): Promise<SessionCheck> {
    if (!(await this.sessions.touch(sessionId, userId)))
      return { valid: false };
    const user = await this.users
      .findById(userId)
      .select('role status assignedProvider')
      .lean();
    if (!user) return { valid: false };
    const authUser: AuthUser = {
      id: userId,
      role: user.role,
      ...(user.assignedProvider
        ? {
            assignedProvider: {
              type: user.assignedProvider.type,
              providerId: user.assignedProvider.providerId.toHexString(),
            },
          }
        : {}),
    };
    return { valid: true, user: authUser, status: user.status };
  }
}
